import { NextResponse } from "next/server";
import {
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase-admin";
import {
  createOpaqueId,
  hmacHex,
  safeEqualHex,
} from "@/core/security/crypto";
import {
  SecurityEnvironmentError,
  loadSecurityEnvironment,
  type SecurityEnvironment,
} from "@/core/security/environment";
import {
  createCorsHeaders,
  isAllowedOrigin,
} from "@/core/security/cors";
import {
  dispatchSmsChallenge,
  type SmsChallengeDispatchResult,
} from "@/core/security/sms-provider";
import type {
  CheckoutSession,
  SecureVerificationSession,
  VerificationDispatchLimit,
} from "@/core/security/contracts";

const CHECKOUT_ID_PATTERN = /^chk_[A-Za-z0-9_-]{32}$/;
const CLIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VERIFICATION_TTL_MS = 5 * 60 * 1000;
const PENDING_DISPATCH_RECOVERY_MS = 30 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MINIMUM_RESEND_INTERVAL_MS = 60 * 1000;
const MAX_DISPATCHES_PER_WINDOW = 5;
const RATE_LIMIT_TTL_MS = 30 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const FORBIDDEN_BROWSER_FIELDS = [
  "phone",
  "phoneNumber",
  "assetKey",
  "assetId",
  "tenantId",
  "price",
] as const;

interface SmsSendRouteDependencies {
  db: Firestore;
  loadEnvironment: () => SecurityEnvironment;
  dispatchChallenge: typeof dispatchSmsChallenge;
  createVerificationId: () => string;
  createDispatchAttemptId: () => string;
  nowMillis: () => number;
  timestampFromMillis: (value: number) => Timestamp;
}

interface SmsSendRequestBody {
  checkoutSessionId?: unknown;
  [key: string]: unknown;
}

type ReservationResult =
  | { kind: "unauthorized" }
  | { kind: "expired" }
  | { kind: "payment_required" }
  | { kind: "conflict" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "pending"; expiresIn: number }
  | { kind: "dispatching"; expiresIn: number }
  | {
      kind: "dispatch";
      verificationSessionId: string;
      dispatchAttemptId: string;
      checkoutSessionId: string;
      phoneE164: string;
      expiresIn: number;
    };

const defaultDependencies: SmsSendRouteDependencies = {
  db: adminDb,
  loadEnvironment: () => loadSecurityEnvironment(),
  dispatchChallenge: dispatchSmsChallenge,
  createVerificationId: () => createOpaqueId("vfy"),
  createDispatchAttemptId: () => createOpaqueId("dsp"),
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => Timestamp.fromMillis(value),
};

export function createSmsSendRouteHandlers(
  dependencies: SmsSendRouteDependencies
) {
  async function OPTIONS(request: Request) {
    const context = resolveRequestSecurityContext(
      request,
      dependencies
    );

    if (context instanceof NextResponse) {
      return context;
    }

    if (!context.originAllowed) {
      return jsonResponse(
        { success: false, error: "Origin is not allowed." },
        403,
        context.headers
      );
    }

    return new NextResponse(null, {
      status: 204,
      headers: context.headers,
    });
  }

  async function POST(request: Request) {
    const context = resolveRequestSecurityContext(
      request,
      dependencies
    );

    if (context instanceof NextResponse) {
      return context;
    }

    if (!context.originAllowed) {
      return jsonResponse(
        { success: false, error: "Origin is not allowed." },
        403,
        context.headers
      );
    }

    if (!dependencies.db) {
      return serviceUnavailable(context.headers);
    }

    let body: SmsSendRequestBody;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Request body must be valid JSON." },
        400,
        context.headers
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      FORBIDDEN_BROWSER_FIELDS.some((field) =>
        Object.prototype.hasOwnProperty.call(body, field)
      )
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "Phone, asset, tenant, and price fields are server-controlled.",
        },
        400,
        context.headers
      );
    }

    const checkoutSessionId = normalizeCheckoutId(
      body.checkoutSessionId
    );
    const checkoutClientSecret = readBearerSecret(request);

    if (!checkoutSessionId || !checkoutClientSecret) {
      return unauthorized(context.headers);
    }

    const submittedSecretDigest = hmacHex(
      context.environment.hmacSecret,
      `checkout-client-secret:v1:${checkoutSessionId}:${checkoutClientSecret}`
    );
    const nowMillis = dependencies.nowMillis();

    let reservation: ReservationResult;

    try {
      reservation = await reserveVerificationDispatch({
        dependencies,
        environment: context.environment,
        checkoutSessionId,
        submittedSecretDigest,
        nowMillis,
      });
    } catch {
      return serviceUnavailable(context.headers);
    }

    if (reservation.kind === "unauthorized") {
      return unauthorized(context.headers);
    }

    if (reservation.kind === "expired") {
      return jsonResponse(
        { success: false, error: "Checkout session has expired." },
        410,
        context.headers
      );
    }

    if (reservation.kind === "payment_required") {
      return jsonResponse(
        { success: false, error: "Payment confirmation is required." },
        402,
        context.headers
      );
    }

    if (reservation.kind === "conflict") {
      return jsonResponse(
        {
          success: false,
          error: "Checkout session cannot accept a verification challenge.",
        },
        409,
        context.headers
      );
    }

    if (reservation.kind === "rate_limited") {
      return jsonResponse(
        {
          success: false,
          error: "Verification dispatch limit reached.",
          retryAfter: reservation.retryAfterSeconds,
        },
        429,
        {
          ...context.headers,
          "Retry-After": String(reservation.retryAfterSeconds),
        }
      );
    }

    if (reservation.kind === "pending") {
      return jsonResponse(
        {
          success: true,
          status: "pending",
          expiresIn: reservation.expiresIn,
        },
        200,
        context.headers
      );
    }

    if (reservation.kind === "dispatching") {
      return jsonResponse(
        {
          success: true,
          status: "dispatching",
          expiresIn: reservation.expiresIn,
        },
        202,
        context.headers
      );
    }

    let dispatchResult: SmsChallengeDispatchResult;

    try {
      dispatchResult = await dependencies.dispatchChallenge({
        environment: context.environment,
        verificationSessionId:
          reservation.verificationSessionId,
        phoneE164: reservation.phoneE164,
      });

      await finalizeSuccessfulDispatch({
        dependencies,
        reservation,
        dispatchResult,
        nowMillis: dependencies.nowMillis(),
      });
    } catch {
      await markDispatchFailure({
        dependencies,
        reservation,
        nowMillis: dependencies.nowMillis(),
      }).catch(() => undefined);

      return jsonResponse(
        {
          success: false,
          error: "Verification message could not be dispatched.",
        },
        502,
        context.headers
      );
    }

    if (
      dispatchResult.developmentCode &&
      context.environment.appEnvironment !== "production"
    ) {
      console.info(
        `[KOBA V2 mock SMS] ${reservation.verificationSessionId}: ${dispatchResult.developmentCode}`
      );
    }

    return jsonResponse(
      {
        success: true,
        status: "pending",
        expiresIn: reservation.expiresIn,
      },
      202,
      context.headers
    );
  }

  return { OPTIONS, POST };
}

async function reserveVerificationDispatch(input: {
  dependencies: SmsSendRouteDependencies;
  environment: SecurityEnvironment;
  checkoutSessionId: string;
  submittedSecretDigest: string;
  nowMillis: number;
}): Promise<ReservationResult> {
  const {
    dependencies,
    environment,
    checkoutSessionId,
    submittedSecretDigest,
    nowMillis,
  } = input;
  const checkoutRef = dependencies.db
    .collection("checkout_sessions")
    .doc(checkoutSessionId);

  return dependencies.db.runTransaction(async (transaction) => {
    const checkoutSnapshot = await transaction.get(checkoutRef);
    const checkout = checkoutSnapshot.exists
      ? (checkoutSnapshot.data() as CheckoutSession)
      : null;
    const expectedDigest = checkout?.checkoutClientSecretDigest ||
      hmacHex(
        environment.hmacSecret,
        "checkout-client-secret:v1:missing-session"
      );
    const secretMatches = safeEqualHex(
      expectedDigest,
      submittedSecretDigest
    );

    if (!checkout || !secretMatches) {
      return { kind: "unauthorized" };
    }

    if (timestampMillis(checkout.expiresAt) <= nowMillis) {
      return { kind: "expired" };
    }

    if (
      checkout.paymentStatus !== "not_required" &&
      checkout.paymentStatus !== "confirmed"
    ) {
      return { kind: "payment_required" };
    }

    if (
      !["created", "awaiting_verification"].includes(
        checkout.checkoutStatus
      ) ||
      checkout.verificationStatus !== "pending" ||
      !checkout.phoneE164 ||
      !checkout.phoneHash
    ) {
      return { kind: "conflict" };
    }

    let activeSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;

    if (checkout.activeVerificationSessionId) {
      activeSnapshot = await transaction.get(
        dependencies.db
          .collection("verification_sessions")
          .doc(checkout.activeVerificationSessionId)
      );

      if (activeSnapshot.exists) {
        const active =
          activeSnapshot.data() as SecureVerificationSession;
        const activeExpiresAt = timestampMillis(active.expiresAt);

        if (active.status === "pending" && activeExpiresAt > nowMillis) {
          return {
            kind: "pending",
            expiresIn: secondsRemaining(activeExpiresAt, nowMillis),
          };
        }

        if (
          active.status === "pending_dispatch" &&
          timestampMillis(active.createdAt) +
            PENDING_DISPATCH_RECOVERY_MS >
            nowMillis
        ) {
          return {
            kind: "dispatching",
            expiresIn: secondsRemaining(activeExpiresAt, nowMillis),
          };
        }
      }
    }

    const rateLimitRef = dependencies.db
      .collection("verification_dispatch_limits")
      .doc(checkout.phoneHash);
    const rateLimitSnapshot = await transaction.get(rateLimitRef);
    const existingLimit = rateLimitSnapshot.exists
      ? (rateLimitSnapshot.data() as VerificationDispatchLimit)
      : null;
    const existingWindowStart = existingLimit
      ? timestampMillis(existingLimit.windowStartedAt)
      : nowMillis;
    const windowExpired =
      !existingLimit ||
      existingWindowStart + RATE_LIMIT_WINDOW_MS <= nowMillis;
    const windowStartedAtMillis = windowExpired
      ? nowMillis
      : existingWindowStart;
    const currentCount = windowExpired
      ? 0
      : existingLimit?.dispatchCount || 0;
    const blockedUntilMillis =
      !windowExpired && existingLimit?.blockedUntil
        ? timestampMillis(existingLimit.blockedUntil)
        : 0;
    const lastDispatchMillis =
      !windowExpired && existingLimit?.lastDispatchedAt
        ? timestampMillis(existingLimit.lastDispatchedAt)
        : 0;

    if (blockedUntilMillis > nowMillis) {
      return {
        kind: "rate_limited",
        retryAfterSeconds: secondsRemaining(
          blockedUntilMillis,
          nowMillis
        ),
      };
    }

    if (
      lastDispatchMillis > 0 &&
      lastDispatchMillis + MINIMUM_RESEND_INTERVAL_MS > nowMillis
    ) {
      return {
        kind: "rate_limited",
        retryAfterSeconds: secondsRemaining(
          lastDispatchMillis + MINIMUM_RESEND_INTERVAL_MS,
          nowMillis
        ),
      };
    }

    if (currentCount >= MAX_DISPATCHES_PER_WINDOW) {
      return {
        kind: "rate_limited",
        retryAfterSeconds: secondsRemaining(
          windowStartedAtMillis + RATE_LIMIT_WINDOW_MS,
          nowMillis
        ),
      };
    }

    const verificationSessionId =
      dependencies.createVerificationId();
    const dispatchAttemptId =
      dependencies.createDispatchAttemptId();
    const createdAt = dependencies.timestampFromMillis(nowMillis);
    const expiresAtMillis = nowMillis + VERIFICATION_TTL_MS;
    const expiresAt = dependencies.timestampFromMillis(
      expiresAtMillis
    );
    const verificationRef = dependencies.db
      .collection("verification_sessions")
      .doc(verificationSessionId);
    const nextCount = currentCount + 1;
    const windowEndMillis =
      windowStartedAtMillis + RATE_LIMIT_WINDOW_MS;
    const rateLimit: VerificationDispatchLimit = {
      id: checkout.phoneHash,
      phoneHash: checkout.phoneHash,
      dispatchCount: nextCount,
      windowStartedAt: dependencies.timestampFromMillis(
        windowStartedAtMillis
      ),
      lastDispatchedAt: createdAt,
      blockedUntil:
        nextCount >= MAX_DISPATCHES_PER_WINDOW
          ? dependencies.timestampFromMillis(windowEndMillis)
          : null,
      expiresAt: dependencies.timestampFromMillis(
        windowStartedAtMillis + RATE_LIMIT_TTL_MS
      ),
      updatedAt: createdAt,
    };
    const verification: SecureVerificationSession = {
      id: verificationSessionId,
      checkoutSessionId,
      tenantId: checkout.tenantId,
      assetKey: checkout.assetKey,
      phoneHash: checkout.phoneHash,
      provider: environment.smsProvider,
      providerVerificationSid: null,
      mockOtpDigest: null,
      dispatchAttemptId,
      status: "pending_dispatch",
      attemptCount: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      activeCheckAttemptId: null,
      checkStartedAt: null,
      createdAt,
      sentAt: null,
      expiresAt,
      verifiedAt: null,
      consumedAt: null,
    };

    if (activeSnapshot?.exists) {
      transaction.update(activeSnapshot.ref, {
        status: "expired",
      });
    }

    transaction.create(verificationRef, verification);
    transaction.set(rateLimitRef, rateLimit);
    transaction.update(checkoutRef, {
      checkoutStatus: "awaiting_verification",
      verificationStatus: "pending",
      activeVerificationSessionId: verificationSessionId,
      updatedAt: createdAt,
    });

    return {
      kind: "dispatch",
      verificationSessionId,
      dispatchAttemptId,
      checkoutSessionId,
      phoneE164: checkout.phoneE164,
      expiresIn: secondsRemaining(expiresAtMillis, nowMillis),
    };
  });
}

async function finalizeSuccessfulDispatch(input: {
  dependencies: SmsSendRouteDependencies;
  reservation: Extract<ReservationResult, { kind: "dispatch" }>;
  dispatchResult: SmsChallengeDispatchResult;
  nowMillis: number;
}) {
  const { dependencies, reservation, dispatchResult, nowMillis } = input;
  const verificationRef = dependencies.db
    .collection("verification_sessions")
    .doc(reservation.verificationSessionId);

  await dependencies.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(verificationRef);

    if (!snapshot.exists) {
      throw new Error("Reserved verification session disappeared.");
    }

    const verification =
      snapshot.data() as SecureVerificationSession;

    if (
      verification.status !== "pending_dispatch" ||
      verification.dispatchAttemptId !== reservation.dispatchAttemptId
    ) {
      throw new Error("Verification dispatch reservation changed.");
    }

    transaction.update(verificationRef, {
      status: "pending",
      providerVerificationSid:
        dispatchResult.providerVerificationSid,
      mockOtpDigest: dispatchResult.mockOtpDigest,
      sentAt: dependencies.timestampFromMillis(nowMillis),
    });
  });
}

async function markDispatchFailure(input: {
  dependencies: SmsSendRouteDependencies;
  reservation: Extract<ReservationResult, { kind: "dispatch" }>;
  nowMillis: number;
}) {
  const { dependencies, reservation, nowMillis } = input;
  const verificationRef = dependencies.db
    .collection("verification_sessions")
    .doc(reservation.verificationSessionId);
  const checkoutRef = dependencies.db
    .collection("checkout_sessions")
    .doc(reservation.checkoutSessionId);

  await dependencies.db.runTransaction(async (transaction) => {
    const [verificationSnapshot, checkoutSnapshot] =
      await Promise.all([
        transaction.get(verificationRef),
        transaction.get(checkoutRef),
      ]);
    const updatedAt = dependencies.timestampFromMillis(nowMillis);

    if (verificationSnapshot.exists) {
      const verification =
        verificationSnapshot.data() as SecureVerificationSession;

      if (
        verification.status === "pending_dispatch" &&
        verification.dispatchAttemptId === reservation.dispatchAttemptId
      ) {
        transaction.update(verificationRef, {
          status: "delivery_failed",
        });
      }
    }

    if (checkoutSnapshot.exists) {
      const checkout = checkoutSnapshot.data() as CheckoutSession;

      if (
        checkout.activeVerificationSessionId ===
        reservation.verificationSessionId
      ) {
        transaction.update(checkoutRef, {
          checkoutStatus: "created",
          activeVerificationSessionId: null,
          updatedAt,
        });
      }
    }
  });
}

function resolveRequestSecurityContext(
  request: Request,
  dependencies: SmsSendRouteDependencies
):
  | {
      environment: SecurityEnvironment;
      headers: Record<string, string>;
      originAllowed: boolean;
    }
  | NextResponse {
  let environment: SecurityEnvironment;

  try {
    environment = dependencies.loadEnvironment();
  } catch (error) {
    const message =
      error instanceof SecurityEnvironmentError
        ? "SMS security configuration is unavailable."
        : "SMS service is temporarily unavailable.";

    return jsonResponse(
      { success: false, error: message },
      503,
      { Vary: "Origin", "Cache-Control": "no-store" }
    );
  }

  const origin = request.headers.get("origin");
  const headers = {
    ...createCorsHeaders(origin, environment.allowedOrigins, {
      methods: ["POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAgeSeconds: 600,
    }),
    "Cache-Control": "no-store",
  };

  return {
    environment,
    headers,
    originAllowed:
      origin === null ||
      isAllowedOrigin(origin, environment.allowedOrigins),
  };
}

function normalizeCheckoutId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return CHECKOUT_ID_PATTERN.test(normalized)
    ? normalized
    : null;
}

function readBearerSecret(request: Request): string | null {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);

  if (!match || !CLIENT_SECRET_PATTERN.test(match[1])) {
    return null;
  }

  return match[1];
}

function timestampMillis(value: Timestamp): number {
  return value.toMillis();
}

function secondsRemaining(targetMillis: number, nowMillis: number): number {
  return Math.max(1, Math.ceil((targetMillis - nowMillis) / 1000));
}

function unauthorized(headers: Record<string, string>): NextResponse {
  return jsonResponse(
    { success: false, error: "Checkout authorization failed." },
    401,
    headers
  );
}

function serviceUnavailable(
  headers: Record<string, string>
): NextResponse {
  return jsonResponse(
    { success: false, error: "SMS service is temporarily unavailable." },
    503,
    headers
  );
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string>
): NextResponse {
  return NextResponse.json(body, { status, headers });
}

const routeHandlers = createSmsSendRouteHandlers(
  defaultDependencies
);

export const OPTIONS = routeHandlers.OPTIONS;
export const POST = routeHandlers.POST;
