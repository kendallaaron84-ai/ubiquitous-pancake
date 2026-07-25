import { NextResponse } from "next/server";
import {
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase-admin";
import {
  createClientSecret,
  createOpaqueId,
  hmacHex,
  normalizePhoneE164,
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
  ProductPolicyError,
  resolveProductPolicy,
} from "@/core/security/product-policy";
import type { CheckoutSession } from "@/core/security/contracts";

const CHECKOUT_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_COUNTRY_CALLING_CODE = "1";
const ASSET_KEY_PATTERN = /^(?:abk|aud|ebk)_[a-z0-9][a-z0-9_-]{1,119}$/;

interface CheckoutRouteDependencies {
  db: Firestore;
  loadEnvironment: () => SecurityEnvironment;
  createCheckoutId: () => string;
  createCheckoutClientSecret: () => string;
  nowMillis: () => number;
  timestampFromMillis: (value: number) => Timestamp;
}

interface CheckoutRequestBody {
  assetKey?: unknown;
  phoneNumber?: unknown;
}

const defaultDependencies: CheckoutRouteDependencies = {
  db: adminDb,
  loadEnvironment: () => loadSecurityEnvironment(),
  createCheckoutId: () => createOpaqueId("chk"),
  createCheckoutClientSecret: () => createClientSecret(),
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => Timestamp.fromMillis(value),
};

export function createCheckoutRouteHandlers(
  dependencies: CheckoutRouteDependencies
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
      return jsonResponse(
        {
          success: false,
          error: "Checkout service is temporarily unavailable.",
        },
        503,
        context.headers
      );
    }

    let body: CheckoutRequestBody;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { success: false, error: "Request body must be valid JSON." },
        400,
        context.headers
      );
    }

    const assetKey = normalizeAssetKey(body.assetKey);

    if (!assetKey) {
      return jsonResponse(
        { success: false, error: "A valid assetKey is required." },
        400,
        context.headers
      );
    }

    let phoneE164: string;

    try {
      if (typeof body.phoneNumber !== "string") {
        throw new TypeError("Phone number is required.");
      }

      phoneE164 = normalizePhoneE164(
        body.phoneNumber,
        DEFAULT_COUNTRY_CALLING_CODE
      );
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "A valid phoneNumber is required.",
        },
        400,
        context.headers
      );
    }

    try {
      const productDocument = await dependencies.db
        .collection("products")
        .doc(assetKey)
        .get();

      if (!productDocument.exists) {
        return jsonResponse(
          {
            success: false,
            error: "Publication is not available for checkout.",
          },
          404,
          context.headers
        );
      }

      const productData = productDocument.data() || {};
      const tenantId = normalizeServerString(
        productData.tenantId ||
          productData.studioKey ||
          productData.wpStudioKey
      );

      const productPolicy = resolveProductPolicy({
        ...productData,
        assetKey: productData.assetKey || productDocument.id,
        tenantId,
      });

      if (productPolicy.assetKey !== assetKey) {
        return jsonResponse(
          {
            success: false,
            error: "Publication checkout mapping is inconsistent.",
          },
          409,
          context.headers
        );
      }

      const checkoutSessionId =
        dependencies.createCheckoutId();
      const checkoutClientSecret =
        dependencies.createCheckoutClientSecret();
      const checkoutClientSecretDigest = hmacHex(
        context.environment.hmacSecret,
        `checkout-client-secret:v1:${checkoutSessionId}:${checkoutClientSecret}`
      );
      const phoneHash = hmacHex(
        context.environment.identityHashSecret,
        `phone:v${context.environment.identityHashVersion}:${phoneE164}`
      );
      const createdAtMillis = dependencies.nowMillis();
      const createdAt = dependencies.timestampFromMillis(
        createdAtMillis
      );
      const expiresAt = dependencies.timestampFromMillis(
        createdAtMillis + CHECKOUT_SESSION_TTL_MS
      );

      const checkoutSession: CheckoutSession = {
        id: checkoutSessionId,
        checkoutClientSecretDigest,
        tenantId: productPolicy.tenantId,
        assetKey: productPolicy.assetKey,
        principalId: null,
        principalType: null,
        phoneE164,
        phoneHash,
        identityHashVersion:
          context.environment.identityHashVersion,
        checkoutStatus: "created",
        paymentStatus: productPolicy.requiresPayment
          ? "pending"
          : "not_required",
        verificationStatus: "pending",
        paymentProvider: productPolicy.requiresPayment
          ? "stripe"
          : "none",
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
        lastStripeEventId: null,
        productPriceId: productPolicy.productPriceId,
        productVersion: productPolicy.productVersion,
        unitAmountMinor: productPolicy.unitAmountMinor,
        currency: productPolicy.currency,
        activeVerificationSessionId: null,
        createdAt,
        updatedAt: createdAt,
        expiresAt,
      };

      await dependencies.db
        .collection("checkout_sessions")
        .doc(checkoutSessionId)
        .create(checkoutSession);

      return jsonResponse(
        {
          success: true,
          checkoutSessionId,
          checkoutClientSecret,
          status: "created",
          requiresPayment: productPolicy.requiresPayment,
          requiresVerification: true,
          maskedPhone: maskPhone(phoneE164),
          payment: {
            unitAmountMinor: productPolicy.unitAmountMinor,
            currency: productPolicy.currency,
          },
          expiresIn: CHECKOUT_SESSION_TTL_MS / 1000,
        },
        201,
        context.headers
      );
    } catch (error) {
      if (error instanceof ProductPolicyError) {
        return jsonResponse(
          {
            success: false,
            error: "Publication is not available for checkout.",
          },
          403,
          context.headers
        );
      }

      return jsonResponse(
        {
          success: false,
          error: "Checkout service is temporarily unavailable.",
        },
        500,
        context.headers
      );
    }
  }

  return { OPTIONS, POST };
}

function resolveRequestSecurityContext(
  request: Request,
  dependencies: CheckoutRouteDependencies
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
        ? "Checkout security configuration is unavailable."
        : "Checkout service is temporarily unavailable.";

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
      allowedHeaders: ["Content-Type"],
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

function normalizeAssetKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return ASSET_KEY_PATTERN.test(normalized)
    ? normalized
    : null;
}

function normalizeServerString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function maskPhone(phoneE164: string): string {
  return `***-***-${phoneE164.slice(-4)}`;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string>
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers,
  });
}

const routeHandlers = createCheckoutRouteHandlers(
  defaultDependencies
);

export const OPTIONS = routeHandlers.OPTIONS;
export const POST = routeHandlers.POST;
