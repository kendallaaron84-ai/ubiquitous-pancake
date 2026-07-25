import { adminDb } from "@/core/firebase-admin";
import { hmacHex } from "@/core/security/crypto";
import { signReaderToken } from "@/core/security/reader-token";
import { bindReaderEntitlements } from "@/core/security/reader-access";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { decodeJwt } from "jose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ASSET_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,159}$/i;
const CHECKOUT_SESSION_PATTERN = /^cs_(?:test_|live_)?[A-Za-z0-9]{16,}$/;
type CompletionBody = {
  checkoutSessionId?: unknown;
  assetKey?: unknown;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWebOrigin(value: unknown): string | null {
  const candidate = cleanString(value);
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function createCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const normalizedOrigin = normalizeWebOrigin(origin);
  if (normalizedOrigin) {
    headers["Access-Control-Allow-Origin"] = normalizedOrigin;
  }

  return headers;
}

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("STRIPE_CONFIGURATION_MISSING");

  return new Stripe(secretKey);
}

function normalizePhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function resolveClientAddress(request: Request): string {
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
  const forwardedAddress = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return cloudflareAddress || forwardedAddress || request.headers.get("x-real-ip")?.trim() || "";
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  const headers = createCorsHeaders(origin);

  if (origin && !headers["Access-Control-Allow-Origin"]) {
    return NextResponse.json(
      { success: false, error: "Origin is not allowed." },
      { status: 403, headers }
    );
  }

  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = createCorsHeaders(origin);

  if (origin && !headers["Access-Control-Allow-Origin"]) {
    return NextResponse.json(
      { success: false, error: "Origin is not allowed." },
      { status: 403, headers }
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as CompletionBody | null;
    const checkoutSessionId = cleanString(body?.checkoutSessionId);
    const requestedAssetKey = cleanString(body?.assetKey);

    if (!CHECKOUT_SESSION_PATTERN.test(checkoutSessionId) || !ASSET_KEY_PATTERN.test(requestedAssetKey)) {
      return NextResponse.json(
        { success: false, error: "Valid completion parameters are required." },
        { status: 400, headers }
      );
    }

    const checkoutReference = adminDb.collection("listener_checkout_sessions").doc(checkoutSessionId);
    const checkoutSnapshot = await checkoutReference.get();
    if (!checkoutSnapshot.exists) {
      return NextResponse.json(
        { success: false, error: "This checkout was not created by KOBA-I." },
        { status: 403, headers }
      );
    }
    const checkoutRecord = checkoutSnapshot.data() || {};
    const checkoutOrigin = normalizeWebOrigin(checkoutRecord.wordpressOrigin);
    if (!checkoutOrigin || checkoutOrigin !== normalizeWebOrigin(origin)) {
      return NextResponse.json(
        { success: false, error: "This checkout belongs to a different publication website." },
        { status: 403, headers }
      );
    }
    const paymentModel = cleanString(checkoutRecord.paymentModel);
    const connectedAccountId = cleanString(checkoutRecord.stripeConnectAccountId);
    if (
      (paymentModel !== "author_direct" && paymentModel !== "koba_managed") ||
      !/^acct_[A-Za-z0-9]+$/.test(connectedAccountId)
    ) {
      return NextResponse.json(
        { success: false, error: "The checkout payment record is invalid." },
        { status: 409, headers }
      );
    }
    const stripe = getStripeClient();
    const session = paymentModel === "author_direct"
      ? await stripe.checkout.sessions.retrieve(
          checkoutSessionId,
          {},
          { stripeAccount: connectedAccountId }
        )
      : await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const assetKey = cleanString(session.metadata?.assetId || session.metadata?.assetKey);
    const tenantKey = cleanString(session.metadata?.tenantKey);

    if (session.status !== "complete" || session.payment_status !== "paid") {
      return NextResponse.json(
        { success: false, error: "The Stripe payment has not completed." },
        { status: 402, headers }
      );
    }
    if (
      session.metadata?.checkoutType !== "listener_purchase" ||
      assetKey !== requestedAssetKey ||
      !tenantKey ||
      cleanString(checkoutRecord.assetKey) !== assetKey ||
      cleanString(checkoutRecord.tenantKey) !== tenantKey ||
      cleanString(checkoutRecord.checkoutReference) !== cleanString(session.metadata?.checkoutReference) ||
      Number(checkoutRecord.amountTotal) !== Number(session.amount_total)
    ) {
      return NextResponse.json(
        { success: false, error: "Checkout metadata does not match this book." },
        { status: 400, headers }
      );
    }

    const normalizedPhone = normalizePhoneDigits(cleanString(session.customer_details?.phone));
    const customerEmail = cleanString(session.customer_details?.email || session.customer_email).toLowerCase();
    if (normalizedPhone.length !== 10) {
      return NextResponse.json(
        { success: false, error: "Stripe did not return the purchaser's verified phone number." },
        { status: 409, headers }
      );
    }

    const productSnapshot = await adminDb.collection("products").doc(assetKey).get();
    if (!productSnapshot.exists) {
      return NextResponse.json(
        { success: false, error: "The purchased publication no longer exists." },
        { status: 404, headers }
      );
    }

    const productData = productSnapshot.data() || {};
    const productTenantKey = cleanString(productData.studioKey) || cleanString(productData.wpStudioKey);
    if (productTenantKey !== tenantKey) {
      return NextResponse.json(
        { success: false, error: "Publication ownership validation failed." },
        { status: 403, headers }
      );
    }

    const entitlementId = `${tenantKey}_${assetKey}_${normalizedPhone}`;
    const entitlementReference = adminDb.collection("entitlements").doc(entitlementId);
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
    const identityHashSecret = process.env.KOBA_IDENTITY_HASH_SECRET?.trim();
    if (!identityHashSecret) {
      throw new Error("READER_SECURITY_CONFIGURATION_MISSING");
    }
    const clientAddress = resolveClientAddress(request);
    const verifiedNetworkHash = clientAddress
      ? hmacHex(identityHashSecret, `reader-network:v1:${clientAddress}`)
      : null;

    await adminDb.runTransaction(async (transaction: any) => {
      const entitlementSnapshot = await transaction.get(entitlementReference);
      const entitlementPayload: Record<string, unknown> = {
        tenantKey,
        studioKey: tenantKey,
        assetId: assetKey,
        assetKey,
        customerPhone: normalizedPhone,
        phoneNumber: normalizedPhone,
        customerEmail: customerEmail || null,
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        status: "active",
        purchaseType: "stripe_listener_purchase",
        amountTotal: session.amount_total,
        currency: session.currency,
        lastVerifiedNetworkHash: verifiedNetworkHash,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!entitlementSnapshot.exists) {
        entitlementPayload.purchasedAt = FieldValue.serverTimestamp();
      }
      transaction.set(entitlementReference, entitlementPayload, { merge: true });
      transaction.set(checkoutReference, {
        status: "reconciled",
        lastVerifiedNetworkHash: verifiedNetworkHash,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    const principalId = hmacHex(
      identityHashSecret,
      `reader:v1:${tenantKey}:${normalizedPhone}:${customerEmail}`
    );
    const boundEntitlementCount = await bindReaderEntitlements(
      adminDb,
      {
        tenantId: tenantKey,
        principalId,
        normalizedPhone,
      },
      identityHashSecret
    );
    if (boundEntitlementCount < 1) {
      throw new Error("READER_ENTITLEMENT_BINDING_FAILED");
    }
    const readerToken = await signReaderToken({
      principalId,
      tenantId: tenantKey,
    });
    const tokenExpiration = decodeJwt(readerToken).exp;
    if (!tokenExpiration) {
      throw new Error("READER_TOKEN_EXPIRATION_MISSING");
    }

    return NextResponse.json(
      {
        success: true,
        status: "authorized",
        readerToken,
        normalizedPhone,
        tenantId: tenantKey,
        expiresAt: tokenExpiration * 1000,
        playbackProfile: {
          assetKey,
          type: cleanString(session.metadata?.productType) ||
            (assetKey.startsWith("ebk_") ? "ebook" : "audiobook"),
        },
      },
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Unable to reconcile listener checkout session.", error);
    const configurationError =
      error instanceof Error &&
      (error.message === "STRIPE_CONFIGURATION_MISSING" ||
        error.message === "READER_SECURITY_CONFIGURATION_MISSING" ||
        error.message.startsWith("Missing reader security configuration:"));

    return NextResponse.json(
      {
        success: false,
        error: configurationError
          ? "Purchase verification is temporarily unavailable."
          : "Unable to verify this purchase.",
      },
      { status: configurationError ? 503 : 500, headers }
    );
  }
}
