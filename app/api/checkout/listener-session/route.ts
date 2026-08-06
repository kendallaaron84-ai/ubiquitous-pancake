import { adminDb } from "@/core/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  requireActiveTenantPaymentProfile,
  resolvePlatformFeeAmount,
  StripeConnectConfigurationError,
} from "@/core/security/stripe-connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ASSET_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,159}$/i;
type ListenerCheckoutBody = { assetKey?: unknown };

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

function resolveWordPressOrigin(
  requestOrigin: string | null,
  productData: Record<string, unknown>,
  licenseData: Record<string, unknown>
): string | null {
  const normalizedRequestOrigin = normalizeWebOrigin(requestOrigin);
  if (!normalizedRequestOrigin) return null;

  const registeredOrigins = [
    cleanString(productData.associatedWebsite),
    cleanString(productData.wordpressUrl),
    cleanString(productData.website),
    cleanString(licenseData.associatedWebsite),
    cleanString(licenseData.wordpressUrl),
    cleanString(licenseData.website),
  ]
    .map(normalizeWebOrigin)
    .filter((origin): origin is string => Boolean(origin));

  return registeredOrigins.includes(normalizedRequestOrigin)
    ? normalizedRequestOrigin
    : null;
}

function optionalStripeImage(productData: Record<string, unknown>): string[] {
  const candidate = cleanString(productData.coverArtUrl || productData.coverUrl);
  if (!candidate) return [];

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? [parsed.toString()] : [];
  } catch {
    return [];
  }
}

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("STRIPE_CONFIGURATION_MISSING");

  return new Stripe(secretKey);
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
    const body = (await request.json().catch(() => null)) as ListenerCheckoutBody | null;
    const assetKey = cleanString(body?.assetKey);

    if (!ASSET_KEY_PATTERN.test(assetKey)) {
      return NextResponse.json(
        { success: false, error: "A valid assetKey is required." },
        { status: 400, headers }
      );
    }

    const productSnapshot = await adminDb.collection("products").doc(assetKey).get();
    if (!productSnapshot.exists) {
      return NextResponse.json(
        { success: false, error: "Publication asset not found." },
        { status: 404, headers }
      );
    }

    const productData = productSnapshot.data() || {};
    const tenantKey = cleanString(productData.studioKey) || cleanString(productData.wpStudioKey);
    const productStatus = cleanString(productData.status).toLowerCase();
    const isPublished = productData.isPublished === true || ["active", "publish", "published"].includes(productStatus);
    const unitAmount = Number(productData.price ?? productData.unitPrice ?? 0);

    if (!tenantKey) {
      return NextResponse.json(
        { success: false, error: "This publication is missing its author account mapping." },
        { status: 422, headers }
      );
    }
    if (!isPublished) {
      return NextResponse.json(
        { success: false, error: "This publication is unavailable." },
        { status: 403, headers }
      );
    }
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
      return NextResponse.json(
        { success: false, error: "Free publications do not require Stripe Checkout." },
        { status: 400, headers }
      );
    }
    const licenseSnapshot = await adminDb.collection("plugin_licenses").doc(tenantKey).get();
    if (!licenseSnapshot.exists) {
      return NextResponse.json(
        { success: false, error: "The author's payment service is not configured." },
        { status: 422, headers }
      );
    }
    const licenseData = licenseSnapshot.data() || {};
    const paymentProfile = requireActiveTenantPaymentProfile(licenseData);

    const wordpressOrigin = resolveWordPressOrigin(origin, productData, licenseData);
    if (!wordpressOrigin) {
      return NextResponse.json(
        { success: false, error: "The publication website is not an approved checkout origin." },
        { status: 403, headers }
      );
    }

    const dashboardOrigin = normalizeWebOrigin(
      process.env.KOBA_DASHBOARD_URL || process.env.NEXT_PUBLIC_API_URL
    );
    if (!dashboardOrigin) throw new Error("READER_CLAIM_ORIGIN_MISSING");

    const productType = cleanString(productData.type || productData.mediaType) ||
      (assetKey.startsWith("ebk_") ? "ebook" : "audiobook");
    const metadata = {
      checkoutType: "listener_purchase",
      assetId: assetKey,
      assetKey,
      tenantKey,
      originDomain: new URL(wordpressOrigin).hostname,
      productType,
      paymentModel: paymentProfile.paymentModel,
      checkoutReference: randomUUID(),
    };
    const stripe = getStripeClient();
    const amountInCents = Math.round(unitAmount * 100);
    const applicationFeeAmount = resolvePlatformFeeAmount(
      amountInCents,
      paymentProfile.paymentModel
    );
    const paymentIntentData = {
      metadata,
      ...(applicationFeeAmount > 0
        ? { application_fee_amount: applicationFeeAmount }
        : {}),
      ...(paymentProfile.paymentModel === "koba_managed"
        ? { transfer_data: { destination: paymentProfile.stripeConnectAccountId } }
        : {}),
    };
    const sessionParameters: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      phone_number_collection: { enabled: true },
      line_items: [{
        price_data: {
          currency: cleanString(productData.currency).toLowerCase() || "usd",
          product_data: {
            name: cleanString(productData.title) || "KOBA-I Publication",
            images: optionalStripeImage(productData),
            metadata: { tenantId: tenantKey, assetId: assetKey },
          },
          unit_amount: amountInCents,
        },
        quantity: 1,
      }],
      payment_intent_data: paymentIntentData,
      metadata,
      success_url: `${dashboardOrigin}/reader/claim?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${wordpressOrigin}/koba_publication/${encodeURIComponent(assetKey)}/?status=cancelled`,
    };
    const requestOptions = paymentProfile.paymentModel === "author_direct"
      ? { stripeAccount: paymentProfile.stripeConnectAccountId }
      : undefined;
    const session = await stripe.checkout.sessions.create(
      sessionParameters,
      requestOptions
    );

    if (!session.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");

    await adminDb.collection("listener_checkout_sessions").doc(session.id).set({
      stripeSessionId: session.id,
      checkoutReference: metadata.checkoutReference,
      assetKey,
      tenantKey,
      paymentModel: paymentProfile.paymentModel,
      stripeConnectAccountId: paymentProfile.stripeConnectAccountId,
      amountTotal: amountInCents,
      currency: cleanString(productData.currency).toLowerCase() || "usd",
      wordpressOrigin,
      status: "created",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
    });

    return NextResponse.json(
      { success: true, checkoutUrl: session.url },
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Unable to create listener checkout session.", error);
    const configurationError =
      error instanceof Error &&
      ["STRIPE_CONFIGURATION_MISSING", "READER_CLAIM_ORIGIN_MISSING"].includes(
        error.message
      );
    if (error instanceof StripeConnectConfigurationError) {
      return NextResponse.json(
        { success: false, code: error.code, error: error.publicMessage },
        { status: error.status, headers }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: configurationError
          ? "Book checkout is temporarily unavailable."
          : "Unable to start book checkout.",
      },
      { status: configurationError ? 503 : 500, headers }
    );
  }
}
