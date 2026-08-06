import { NextResponse } from "next/server";
import Stripe from "stripe";

import { provisionAuthorPlugin } from "@/core/security/author-provisioning";
import { processListenerPurchaseEntitlement } from "@/core/security/listener-entitlement";
import { processAuthorTranscriptionPayment } from "@/core/security/transcription-payment";
import { processAuthorSubscriptionPayment } from "@/core/security/author-subscription";
import { syncConnectedAccountFromWebhook } from "@/core/security/stripe-connect-server";
import { processCanonicalReaderPurchase } from "@/core/security/reader-platform-stripe";
import { processReaderPurchaseWebhook } from "@/core/security/reader-purchase-webhook";
import { processCanonicalReaderFinancialEvent } from "@/core/security/reader-platform-financial-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown webhook failure.";
}

export async function POST(request: Request) {
  const body = await request.text();
  if (!body.trim()) {
    return NextResponse.json(
      { error: "Webhook request body is required." },
      { status: 400 }
    );
  }

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!endpointSecret) {
    console.error("Stripe webhook signing configuration is missing.");
    return NextResponse.json(
      { error: "Webhook configuration unavailable." },
      { status: 503 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Stripe signature is required." },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      endpointSecret
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed.");
    return NextResponse.json(
      { error: "Webhook signature verification failed." },
      { status: 400 }
    );
  }

  if (event.type === "account.updated") {
    try {
      const account = event.data.object as Stripe.Account;
      await syncConnectedAccountFromWebhook(account);
      return NextResponse.json(
        { success: true, connectStatusSynchronized: true, stripeAccountId: account.id },
        { status: 200 }
      );
    } catch (error) {
      console.error("Stripe Connect account synchronization failed:", errorMessage(error));
      return NextResponse.json(
        { error: "Stripe Connect account synchronization failed." },
        { status: 500 }
      );
    }
  }

  if (["charge.refunded", "charge.dispute.created", "charge.dispute.closed"].includes(event.type)) {
    try {
      const financialResult = await processCanonicalReaderFinancialEvent(event);
      return NextResponse.json({ success: true, readerPlatformFinancialEvent: financialResult }, { status: 200 });
    } catch (error) {
      console.error("Canonical reader financial event failed:", errorMessage(error));
      return NextResponse.json({ error: "Reader purchase financial reconciliation failed." }, { status: 500 });
    }
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json(
      { ignoredEvent: event.type },
      { status: 200 }
    );
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const isListenerPurchase =
    session.metadata?.checkoutType === "listener_purchase";
  const isAuthorTranscription =
    session.metadata?.checkoutType === "author_transcription";
  const isAuthorSubscription =
    session.metadata?.checkoutType === "author_subscription";

  if (isAuthorSubscription) {
    if (event.type === "checkout.session.async_payment_succeeded") {
      return NextResponse.json({ ignoredEvent: event.type }, { status: 200 });
    }
    try {
      const result = await processAuthorSubscriptionPayment(event, session);
      return NextResponse.json(
        { success: true, subscriptionMode: true, ...result },
        { status: 200 }
      );
    } catch (error) {
      console.error("Author subscription fulfillment failed:", errorMessage(error));
      return NextResponse.json(
        { error: "Author subscription fulfillment failed." },
        { status: 500 }
      );
    }
  }

  if (isAuthorTranscription) {
    try {
      const result = await processAuthorTranscriptionPayment(event, session);
      return NextResponse.json({ success: true, transcriptionMode: true, ...result }, { status: 200 });
    } catch (error) {
      console.error("Author transcription fulfillment failed:", errorMessage(error));
      return NextResponse.json({ error: "Author transcription fulfillment failed." }, { status: 500 });
    }
  }

  if (isListenerPurchase) {
    try {
      const result = await processReaderPurchaseWebhook(event, session, {
        recordCanonicalPurchase: (stripeEvent, checkoutSession) =>
          processCanonicalReaderPurchase(stripeEvent, checkoutSession, stripe),
        fulfillLegacyPurchase: processListenerPurchaseEntitlement,
      });
      if (!result.legacy.success) {
        console.warn(
          "Legacy listener fulfillment failed after canonical purchase recording.",
          { status: result.legacy.status }
        );
      }
      return NextResponse.json(
        {
          success: true,
          listenerMode: true,
          legacyStatus: result.legacy.status,
          readerPlatformPurchaseId: result.canonical.purchaseId,
          readerPlatformClaimId: result.canonical.claimId,
          readerPlatformReplay: result.canonical.replay,
          stripeSessionId: session.id,
        },
        { status: 200 }
      );
    } catch (error) {
      console.error(
        "Canonical reader purchase processing failed:",
        errorMessage(error)
      );
      return NextResponse.json(
        { error: "Canonical reader purchase processing failed." },
        { status: 500 }
      );
    }
  }
  // Delayed-payment events are only used for listener purchases. The existing
  // author-software fulfillment remains bound to checkout completion so an
  // asynchronous event cannot mint a second StudioKey.
  if (event.type === "checkout.session.async_payment_succeeded") {
    return NextResponse.json(
      { ignoredEvent: event.type },
      { status: 200 }
    );
  }

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    const itemAnalysis: Array<Record<string, unknown>> = [];
    let hasAudiobookPlayer = false;
    let hasEreader = false;
    let matchedProductId = "";
    let matchedProductName = "";

    for (const item of lineItems.data) {
      const productNameRaw = item.description || "";
      const productName = productNameRaw.toLowerCase();
      const product = item.price?.product;
      const productId =
        typeof product === "string"
          ? product
          : product && typeof product === "object"
            ? product.id
            : "";
      const isAudioPlugin =
        productId === "prod_UpYvZLShITzyej" ||
        productName.includes("koba-i audio plugin") ||
        productName.includes("koba-i audio player") ||
        productName.includes("audio player");
      const isEReader =
        productName.includes("jubilee works digital e-reader") ||
        productName.includes("digital e-reader") ||
        productName.includes("e-reader");

      itemAnalysis.push({
        incomingDescription: productNameRaw,
        incomingProductId: productId,
        evaluatedAsAudioPlugin: isAudioPlugin,
        evaluatedAsEReader: isEReader,
      });

      if (isAudioPlugin || isEReader) {
        hasAudiobookPlayer ||= isAudioPlugin;
        hasEreader ||= isEReader;
        matchedProductId ||= productId;
        matchedProductName ||= productNameRaw;
      }
    }

    const metadataPluginType = session.metadata?.pluginType?.trim();
    if (session.metadata?.checkoutType === "plugin_purchase") {
      hasAudiobookPlayer ||= metadataPluginType !== "ereader_plugin";
      hasEreader ||= metadataPluginType === "ereader_plugin" || metadataPluginType === "koba_i_plugin_suite";
    }

    if (!hasAudiobookPlayer && !hasEreader) {
      return NextResponse.json(
        {
          processed: true,
          matchedAndMinted: false,
          receivedSessionId: session.id,
          analysisLogs: itemAnalysis,
        },
        { status: 200 }
      );
    }

    if (session.status !== "complete" || session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Plugin access requires a completed, paid Stripe session." },
        { status: 409 }
      );
    }

    const customerEmail = (
      session.customer_details?.email || session.customer_email || ""
    ).trim().toLowerCase();
    const customerName = (
      session.customer_details?.name || session.metadata?.authorName || ""
    ).trim();
    if (!customerEmail || !customerName) {
      return NextResponse.json(
        { error: "Stripe customer name and email are required for plugin fulfillment." },
        { status: 422 }
      );
    }

    const result = await provisionAuthorPlugin({
      authorName: customerName,
      authorEmail: customerEmail,
      source: "stripe_plugin_purchase",
      idempotencyKey: session.id,
      hasAudiobookPlayer,
      hasEreader,
      stripeSessionId: session.id,
      stripeEventId: event.id,
      stripeCustomerId: stripeObjectId(session.customer),
      productId: matchedProductId || null,
      productName: matchedProductName || null,
    });

    return NextResponse.json(
      {
        processed: true,
        matchedAndMinted: true,
        receivedSessionId: session.id,
        studioKey: result.studioKey,
        created: result.created,
        welcomeEmailSent: result.welcomeEmailSent,
        analysisLogs: itemAnalysis,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Author checkout processing failed:", errorMessage(error));
    return NextResponse.json(
      { error: "Author checkout processing failed." },
      { status: 500 }
    );
  }
}

function stripeObjectId(value: string | { id: string } | null): string | null {
  if (typeof value === "string") return value;
  return value && typeof value.id === "string" ? value.id : null;
}
