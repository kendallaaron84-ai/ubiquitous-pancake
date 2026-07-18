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
  verifySmsChallenge,
  type SmsChallengeVerificationResult,
} from "@/core/security/sms-provider";
import type {
  CanonicalEntitlement,
  CheckoutSession,
  EntitlementIdempotencyKey,
  SecureVerificationSession,
} from "@/core/security/contracts";

export const dynamic = "force-dynamic";

const CHECKOUT_ID_PATTERN = /^chk_[A-Za-z0-9_-]{32}$/;
const CLIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^\d{6}$/;
const CHECK_RESERVATION_TTL_MS = 30 * 1000;

const FORBIDDEN_BROWSER_FIELDS = [
  "phone",
  "phoneNumber",
  "assetKey",
  "assetId",
  "tenantId",
  "price",
  "entitlementId",
] as const;

interface SmsVerifyRouteDependencies {
  db: Firestore;
  loadEnvironment: () => SecurityEnvironment;
  verifyChallenge: typeof verifySmsChallenge;
  createCheckAttemptId: () => string;
  createEntitlementId: () => string;
  nowMillis: () => number;
  timestampFromMillis: (value: number) => Timestamp;
}

interface SmsVerifyRequestBody {
  checkoutSessionId?: unknown;
  code?: unknown;
  [key: string]: unknown;
}

type CheckReservation =
  | { kind: "unauthorized" }
  | { kind: "expired" }
  | { kind: "payment_required" }
  | { kind: "conflict" }
  | { kind: "locked" }
  | { kind: "already_verified" }
  | { kind: "checking" }
  | {
      kind: "reserved";
      checkoutSessionId: string;
      verificationSessionId: string;
      checkAttemptId: string;
      providerVerificationSid: string | null;
      mockOtpDigest: string | null;
      submittedCode: string;
    };

const defaultDependencies: SmsVerifyRouteDependencies = {
  db: adminDb,
  loadEnvironment: () => loadSecurityEnvironment(),
  verifyChallenge: verifySmsChallenge,
  createCheckAttemptId: () => createOpaqueId("chkatt"),
  createEntitlementId: () => createOpaqueId("ent"),
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => Timestamp.fromMillis(value),
};

export function createSmsVerifyRouteHandlers(
  dependencies: SmsVerifyRouteDependencies
) {
  async function OPTIONS(request: Request) {
    const context = resolveRequestSecurityContext(request, dependencies);

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
    const context = resolveRequestSecurityContext(request, dependencies);

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

    let body: SmsVerifyRequestBody;

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
          error: "Identity and publication fields are server-controlled.",
        },
        400,
        context.headers
      );
    }

    const checkoutSessionId = normalizeCheckoutId(
      body.checkoutSessionId
    );
    const submittedCode = normalizeCode(body.code);
    const checkoutClientSecret = readBearerSecret(request);

    if (
      !checkoutSessionId ||
      !submittedCode ||
      !checkoutClientSecret
    ) {
      return unauthorized(context.headers);
    }

    const submittedSecretDigest = hmacHex(
      context.environment.hmacSecret,
      `checkout-client-secret:v1:${checkoutSessionId}:${checkoutClientSecret}`
    );
    const nowMillis = dependencies.nowMillis();

    let reservation: CheckReservation;

    try {
      reservation = await reserveVerificationCheck({
        dependencies,
        environment: context.environment,
        checkoutSessionId,
        submittedSecretDigest,
        submittedCode,
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
        { success: false, error: "Verification session has expired." },
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

    if (reservation.kind === "locked") {
      return jsonResponse(
        { success: false, error: "Verification session is locked." },
        423,
        context.headers
      );
    }

    if (reservation.kind === "conflict") {
      return jsonResponse(
        { success: false, error: "Verification state is invalid." },
        409,
        context.headers
      );
    }

    if (reservation.kind === "already_verified") {
      return jsonResponse(
        { success: true, status: "verified" },
        200,
        context.headers
      );
    }

    if (reservation.kind === "checking") {
      return jsonResponse(
        { success: true, status: "checking" },
        202,
        context.headers
      );
    }

    let providerResult: SmsChallengeVerificationResult;

    try {
      providerResult = await dependencies.verifyChallenge({
        environment: context.environment,
        verificationSessionId: reservation.verificationSessionId,
        providerVerificationSid:
          reservation.providerVerificationSid,
        mockOtpDigest: reservation.mockOtpDigest,
        submittedCode: reservation.submittedCode,
      });
    } catch {
      await releaseVerificationCheck({
        dependencies,
        reservation,
      }).catch(() => undefined);

      return jsonResponse(
        {
          success: false,
          error: "Verification provider is temporarily unavailable.",
        },
        502,
        context.headers
      );
    }

    if (!providerResult.approved) {
      let locked = providerResult.terminal;

      try {
        locked = await recordRejectedCheck({
          dependencies,
          reservation,
          forceLock: providerResult.terminal,
          nowMillis: dependencies.nowMillis(),
        });
      } catch {
        return serviceUnavailable(context.headers);
      }

      return jsonResponse(
        {
          success: false,
          error: locked
            ? "Verification session is locked."
            : "Verification code is invalid.",
        },
        locked ? 423 : 401,
        context.headers
      );
    }

    try {
      await consumeVerificationAndBindEntitlement({
        dependencies,
        environment: context.environment,
        reservation,
        nowMillis: dependencies.nowMillis(),
      });
    } catch {
      return serviceUnavailable(context.headers);
    }

    return jsonResponse(
      { success: true, status: "verified" },
      200,
      context.headers
    );
  }

  return { OPTIONS, POST };
}

async function reserveVerificationCheck(input: {
  dependencies: SmsVerifyRouteDependencies;
  environment: SecurityEnvironment;
  checkoutSessionId: string;
  submittedSecretDigest: string;
  submittedCode: string;
  nowMillis: number;
}): Promise<CheckReservation> {
  const {
    dependencies,
    environment,
    checkoutSessionId,
    submittedSecretDigest,
    submittedCode,
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

    if (
      checkout.checkoutStatus === "ready" &&
      checkout.verificationStatus === "verified" &&
      checkout.principalId
    ) {
      return { kind: "already_verified" };
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
      checkout.checkoutStatus !== "awaiting_verification" ||
      checkout.verificationStatus !== "pending" ||
      !checkout.activeVerificationSessionId ||
      !checkout.phoneHash
    ) {
      return { kind: "conflict" };
    }

    const verificationRef = dependencies.db
      .collection("verification_sessions")
      .doc(checkout.activeVerificationSessionId);
    const verificationSnapshot = await transaction.get(verificationRef);

    if (!verificationSnapshot.exists) {
      return { kind: "conflict" };
    }

    const verification =
      verificationSnapshot.data() as SecureVerificationSession;

    if (
      verification.checkoutSessionId !== checkoutSessionId ||
      verification.tenantId !== checkout.tenantId ||
      verification.assetKey !== checkout.assetKey ||
      verification.phoneHash !== checkout.phoneHash ||
      verification.provider !== environment.smsProvider
    ) {
      return { kind: "conflict" };
    }

    if (
      verification.status === "locked" ||
      verification.attemptCount >= verification.maxAttempts
    ) {
      transaction.update(checkoutRef, {
        verificationStatus: "locked",
      });
      transaction.update(verificationRef, {
        status: "locked",
        activeCheckAttemptId: null,
        checkStartedAt: null,
      });
      return { kind: "locked" };
    }

    if (timestampMillis(verification.expiresAt) <= nowMillis) {
      transaction.update(checkoutRef, {
        verificationStatus: "expired",
      });
      transaction.update(verificationRef, {
        status: "expired",
        activeCheckAttemptId: null,
        checkStartedAt: null,
      });
      return { kind: "expired" };
    }

    if (
      verification.status === "checking" &&
      verification.checkStartedAt &&
      timestampMillis(verification.checkStartedAt) +
        CHECK_RESERVATION_TTL_MS >
        nowMillis
    ) {
      return { kind: "checking" };
    }

    if (
      verification.status !== "pending" &&
      verification.status !== "checking"
    ) {
      return { kind: "conflict" };
    }

    const checkAttemptId = dependencies.createCheckAttemptId();
    transaction.update(verificationRef, {
      status: "checking",
      activeCheckAttemptId: checkAttemptId,
      checkStartedAt: dependencies.timestampFromMillis(nowMillis),
    });

    return {
      kind: "reserved",
      checkoutSessionId,
      verificationSessionId: verification.id,
      checkAttemptId,
      providerVerificationSid:
        verification.providerVerificationSid,
      mockOtpDigest: verification.mockOtpDigest,
      submittedCode,
    };
  });
}

async function releaseVerificationCheck(input: {
  dependencies: SmsVerifyRouteDependencies;
  reservation: Extract<CheckReservation, { kind: "reserved" }>;
}) {
  const { dependencies, reservation } = input;
  const verificationRef = dependencies.db
    .collection("verification_sessions")
    .doc(reservation.verificationSessionId);

  await dependencies.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(verificationRef);

    if (!snapshot.exists) {
      return;
    }

    const verification =
      snapshot.data() as SecureVerificationSession;

    if (
      verification.status === "checking" &&
      verification.activeCheckAttemptId === reservation.checkAttemptId
    ) {
      transaction.update(verificationRef, {
        status: "pending",
        activeCheckAttemptId: null,
        checkStartedAt: null,
      });
    }
  });
}

async function recordRejectedCheck(input: {
  dependencies: SmsVerifyRouteDependencies;
  reservation: Extract<CheckReservation, { kind: "reserved" }>;
  forceLock: boolean;
  nowMillis: number;
}): Promise<boolean> {
  const { dependencies, reservation, forceLock, nowMillis } = input;
  const verificationRef = dependencies.db
    .collection("verification_sessions")
    .doc(reservation.verificationSessionId);
  const checkoutRef = dependencies.db
    .collection("checkout_sessions")
    .doc(reservation.checkoutSessionId);

  return dependencies.db.runTransaction(async (transaction) => {
    const [verificationSnapshot, checkoutSnapshot] =
      await Promise.all([
        transaction.get(verificationRef),
        transaction.get(checkoutRef),
      ]);

    if (!verificationSnapshot.exists || !checkoutSnapshot.exists) {
      throw new Error("Verification state disappeared.");
    }

    const verification =
      verificationSnapshot.data() as SecureVerificationSession;

    if (
      verification.status !== "checking" ||
      verification.activeCheckAttemptId !== reservation.checkAttemptId
    ) {
      throw new Error("Verification check reservation changed.");
    }

    const attemptCount = verification.attemptCount + 1;
    const locked =
      forceLock || attemptCount >= verification.maxAttempts;
    const updatedAt = dependencies.timestampFromMillis(nowMillis);

    transaction.update(verificationRef, {
      status: locked ? "locked" : "pending",
      attemptCount,
      activeCheckAttemptId: null,
      checkStartedAt: null,
    });
    transaction.update(checkoutRef, {
      verificationStatus: locked ? "locked" : "pending",
      updatedAt,
    });

    return locked;
  });
}

async function consumeVerificationAndBindEntitlement(input: {
  dependencies: SmsVerifyRouteDependencies;
  environment: SecurityEnvironment;
  reservation: Extract<CheckReservation, { kind: "reserved" }>;
  nowMillis: number;
}) {
  const { dependencies, environment, reservation, nowMillis } = input;
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

    if (!verificationSnapshot.exists || !checkoutSnapshot.exists) {
      throw new Error("Verification state disappeared.");
    }

    const verification =
      verificationSnapshot.data() as SecureVerificationSession;
    const checkout = checkoutSnapshot.data() as CheckoutSession;

    if (
      verification.status !== "checking" ||
      verification.activeCheckAttemptId !== reservation.checkAttemptId ||
      checkout.activeVerificationSessionId !== verification.id ||
      checkout.checkoutStatus !== "awaiting_verification" ||
      checkout.verificationStatus !== "pending" ||
      (checkout.paymentStatus !== "not_required" &&
        checkout.paymentStatus !== "confirmed") ||
      !checkout.phoneHash
    ) {
      throw new Error("Verification state is no longer eligible.");
    }

    const principalId = `phn_v${environment.identityHashVersion}_${hmacHex(
      environment.identityHashSecret,
      `principal:v${environment.identityHashVersion}:${checkout.phoneHash}`
    )}`;
    const idempotencyId = hmacHex(
      environment.hmacSecret,
      `entitlement-key:v1:${checkout.tenantId}:${principalId}:${checkout.assetKey}`
    );
    const keyRef = dependencies.db
      .collection("entitlement_keys")
      .doc(idempotencyId);
    const keySnapshot = await transaction.get(keyRef);
    let entitlementId: string;
    let entitlementSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;

    if (keySnapshot.exists) {
      const key = keySnapshot.data() as EntitlementIdempotencyKey;
      entitlementId = key.currentEntitlementId;
      entitlementSnapshot = await transaction.get(
        dependencies.db
          .collection("entitlements")
          .doc(entitlementId)
      );

      if (
        !entitlementSnapshot.exists ||
        (entitlementSnapshot.data() as CanonicalEntitlement).status !==
          "active"
      ) {
        throw new Error("Existing entitlement is not active.");
      }
    } else {
      entitlementId = dependencies.createEntitlementId();
    }

    const updatedAt = dependencies.timestampFromMillis(nowMillis);

    if (!keySnapshot.exists) {
      const entitlement: CanonicalEntitlement = {
        id: entitlementId,
        tenantId: checkout.tenantId,
        assetKey: checkout.assetKey,
        principalId,
        principalType: "verified_phone",
        phoneHash: checkout.phoneHash,
        userEmailHash: null,
        identityHashVersion: environment.identityHashVersion,
        status: "active",
        source:
          checkout.paymentStatus === "confirmed"
            ? "purchase"
            : "grant",
        checkoutSessionId: checkout.id,
        stripePaymentIntentId: checkout.stripePaymentIntentId,
        createdAt: updatedAt,
        updatedAt,
      };
      const entitlementKey: EntitlementIdempotencyKey = {
        id: idempotencyId,
        tenantId: checkout.tenantId,
        principalId,
        assetKey: checkout.assetKey,
        currentEntitlementId: entitlementId,
        version: 1,
        createdAt: updatedAt,
        updatedAt,
      };

      transaction.create(
        dependencies.db.collection("entitlements").doc(entitlementId),
        entitlement
      );
      transaction.create(keyRef, entitlementKey);
    }

    transaction.update(verificationRef, {
      status: "consumed",
      activeCheckAttemptId: null,
      checkStartedAt: null,
      verifiedAt: updatedAt,
      consumedAt: updatedAt,
    });
    transaction.update(checkoutRef, {
      principalId,
      principalType: "verified_phone",
      checkoutStatus: "ready",
      verificationStatus: "verified",
      updatedAt,
    });
  });
}

function resolveRequestSecurityContext(
  request: Request,
  dependencies: SmsVerifyRouteDependencies
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
        ? "Verification security configuration is unavailable."
        : "Verification service is temporarily unavailable.";

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
  return CHECKOUT_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return CODE_PATTERN.test(normalized) ? normalized : null;
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
    {
      success: false,
      error: "Verification service is temporarily unavailable.",
    },
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

const routeHandlers = createSmsVerifyRouteHandlers(defaultDependencies);

export const OPTIONS = routeHandlers.OPTIONS;
export const POST = routeHandlers.POST;
