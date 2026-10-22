import { adminDb } from "@/core/firebase-admin";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { processCanonicalReaderPurchase } from "@/core/security/reader-platform-stripe";

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

    const canonical = await processCanonicalReaderPurchase(
      {
        id: `reconcile:${session.id}`,
        object: "event",
        api_version: null,
        created: session.created,
        data: { object: session },
        livemode: session.livemode,
        pending_webhooks: 0,
        request: null,
        type: "checkout.session.completed",
        account: paymentModel === "author_direct" ? connectedAccountId : undefined,
      } as unknown as Stripe.Event,
      session,
      stripe
    );

    return NextResponse.json(
      {
        success: true,
        status: "claim_required",
        code: "READER_PURCHASE_CLAIM_REQUIRED",
        readerPlatformPurchaseId: canonical.purchaseId,
        readerPlatformClaimId: canonical.claimId,
        claimUrl: new URL(
          `/reader/claim?session_id=${encodeURIComponent(session.id)}`,
          request.url
        ).toString(),
      },
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Unable to reconcile listener checkout session.", error);
    const configurationError =
      error instanceof Error &&
      (error.message === "STRIPE_CONFIGURATION_MISSING" ||
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
