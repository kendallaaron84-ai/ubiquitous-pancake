import { NextResponse } from "next/server";
import { decodeJwt } from "jose";
import { adminDb } from "@/core/firebase-admin";
import type {
  CanonicalEntitlement,
  CheckoutSession,
  EntitlementIdempotencyKey,
} from "@/core/security/contracts";
import { createCorsHeaders, isAllowedOrigin } from "@/core/security/cors";
import { hmacHex, safeEqualHex } from "@/core/security/crypto";
import {
  loadSecurityEnvironment,
  SecurityEnvironmentError,
  type SecurityEnvironment,
} from "@/core/security/environment";
import { signReaderToken } from "@/core/security/reader-token";

const CHECKOUT_ID_PATTERN = /^chk_[A-Za-z0-9_-]{16,160}$/;

interface AuthorizedReaderSession {
  principalId: string;
  tenantId: string;
}

export interface MediaTokenRouteDependencies {
  db: FirebaseFirestore.Firestore | null;
  loadEnvironment: () => SecurityEnvironment;
  nowMillis: () => number;
  authorizeSession: (input: {
    db: FirebaseFirestore.Firestore;
    checkoutSessionId: string;
    submittedSecretDigest: string;
    environment: SecurityEnvironment;
    nowMillis: number;
  }) => Promise<AuthorizedReaderSession | null>;
  issueReaderToken: (input: AuthorizedReaderSession) => Promise<{
    readerToken: string;
    expiresAt: number;
  }>;
}

const defaultDependencies: MediaTokenRouteDependencies = {
  db: adminDb,
  loadEnvironment: () => loadSecurityEnvironment(),
  nowMillis: () => Date.now(),
  authorizeSession: authorizeVerifiedCheckout,
  issueReaderToken: async ({ principalId, tenantId }) => {
    const readerToken = await signReaderToken({ principalId, tenantId });
    const expiration = decodeJwt(readerToken).exp;
    if (!expiration) throw new Error("Reader token expiration is missing.");
    return { readerToken, expiresAt: expiration * 1000 };
  },
};

export function createMediaTokenRouteHandlers(
  dependencies: MediaTokenRouteDependencies
) {
  function resolveContext(request: Request):
    | { environment: SecurityEnvironment; headers: Record<string, string> }
    | NextResponse {
    let environment: SecurityEnvironment;
    try {
      environment = dependencies.loadEnvironment();
    } catch (error) {
      const message = error instanceof SecurityEnvironmentError
        ? "Reader security configuration is unavailable."
        : "Reader token service is temporarily unavailable.";
      return NextResponse.json({ success: false, error: message }, { status: 503 });
    }

    const origin = request.headers.get("origin");
    const headers = createCorsHeaders(origin, environment.allowedOrigins, {
      methods: ["POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAgeSeconds: 600,
    });
    if (!isAllowedOrigin(origin, environment.allowedOrigins)) {
      return NextResponse.json(
        { success: false, error: "Request origin is not authorized." },
        { status: 403, headers }
      );
    }
    return { environment, headers };
  }

  async function OPTIONS(request: Request) {
    const context = resolveContext(request);
    if (context instanceof NextResponse) return context;
    return new NextResponse(null, { status: 204, headers: context.headers });
  }

  async function POST(request: Request) {
    const context = resolveContext(request);
    if (context instanceof NextResponse) return context;
    if (!dependencies.db) {
      return NextResponse.json(
        { success: false, error: "Reader token service is unavailable." },
        { status: 503, headers: context.headers }
      );
    }

    const body = await request.json().catch(() => ({}));
    const checkoutSessionId = normalizeCheckoutId(body.checkoutSessionId);
    const checkoutClientSecret = readBearerSecret(request);
    if (!checkoutSessionId || !checkoutClientSecret) {
      return unauthorized(context.headers);
    }

    const submittedSecretDigest = hmacHex(
      context.environment.hmacSecret,
      `checkout-client-secret:v1:${checkoutSessionId}:${checkoutClientSecret}`
    );

    let authorized: AuthorizedReaderSession | null;
    try {
      authorized = await dependencies.authorizeSession({
        db: dependencies.db,
        checkoutSessionId,
        submittedSecretDigest,
        environment: context.environment,
        nowMillis: dependencies.nowMillis(),
      });
    } catch {
      return NextResponse.json(
        { success: false, error: "Reader token service is temporarily unavailable." },
        { status: 503, headers: context.headers }
      );
    }
    if (!authorized) return unauthorized(context.headers);

    try {
      const issued = await dependencies.issueReaderToken(authorized);
      return NextResponse.json(
        {
          success: true,
          status: "authorized",
          readerToken: issued.readerToken,
          tenantId: authorized.tenantId,
          expiresAt: issued.expiresAt,
        },
        { status: 200, headers: context.headers }
      );
    } catch {
      return NextResponse.json(
        { success: false, error: "Reader token service is temporarily unavailable." },
        { status: 503, headers: context.headers }
      );
    }
  }

  return { OPTIONS, POST };
}

async function authorizeVerifiedCheckout(input: {
  db: FirebaseFirestore.Firestore;
  checkoutSessionId: string;
  submittedSecretDigest: string;
  environment: SecurityEnvironment;
  nowMillis: number;
}): Promise<AuthorizedReaderSession | null> {
  const { db, checkoutSessionId, submittedSecretDigest, environment, nowMillis } = input;
  return db.runTransaction(async (transaction) => {
    const checkoutRef = db.collection("checkout_sessions").doc(checkoutSessionId);
    const checkoutSnapshot = await transaction.get(checkoutRef);
    if (!checkoutSnapshot.exists) return null;
    const checkout = checkoutSnapshot.data() as CheckoutSession;
    if (!safeEqualHex(checkout.checkoutClientSecretDigest, submittedSecretDigest)) return null;
    if (
      checkout.checkoutStatus !== "ready" ||
      checkout.verificationStatus !== "verified" ||
      (checkout.paymentStatus !== "confirmed" && checkout.paymentStatus !== "not_required") ||
      !checkout.principalId ||
      checkout.expiresAt.toMillis() <= nowMillis
    ) return null;

    const entitlementKeyId = hmacHex(
      environment.hmacSecret,
      `entitlement-key:v1:${checkout.tenantId}:${checkout.principalId}:${checkout.assetKey}`
    );
    const keySnapshot = await transaction.get(
      db.collection("entitlement_keys").doc(entitlementKeyId)
    );
    if (!keySnapshot.exists) return null;
    const entitlementKey = keySnapshot.data() as EntitlementIdempotencyKey;
    const entitlementSnapshot = await transaction.get(
      db.collection("entitlements").doc(entitlementKey.currentEntitlementId)
    );
    if (!entitlementSnapshot.exists) return null;
    const entitlement = entitlementSnapshot.data() as CanonicalEntitlement;
    if (
      entitlement.status !== "active" ||
      entitlement.tenantId !== checkout.tenantId ||
      entitlement.assetKey !== checkout.assetKey ||
      entitlement.principalId !== checkout.principalId
    ) return null;

    return { principalId: checkout.principalId, tenantId: checkout.tenantId };
  });
}

function normalizeCheckoutId(value: unknown): string {
  return typeof value === "string" && CHECKOUT_ID_PATTERN.test(value.trim())
    ? value.trim()
    : "";
}

function readBearerSecret(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : "";
}

function unauthorized(headers: Record<string, string>): NextResponse {
  return NextResponse.json(
    { success: false, error: "Reader authorization is invalid or expired." },
    { status: 401, headers }
  );
}

const routeHandlers = createMediaTokenRouteHandlers(defaultDependencies);
export const OPTIONS = routeHandlers.OPTIONS;
export const POST = routeHandlers.POST;
