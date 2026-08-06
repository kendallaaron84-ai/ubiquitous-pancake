import type Stripe from "stripe";

export interface ReaderPurchaseWebhookDependencies {
  recordCanonicalPurchase: (
    event: Stripe.Event,
    session: Stripe.Checkout.Session
  ) => Promise<{ purchaseId: string; claimId: string; replay: boolean }>;
  fulfillLegacyPurchase: (
    event: Stripe.Event,
    session: Stripe.Checkout.Session
  ) => Promise<{ success: boolean; status?: string }>;
}

export async function processReaderPurchaseWebhook(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  dependencies: ReaderPurchaseWebhookDependencies
) {
  const canonical = await dependencies.recordCanonicalPurchase(event, session);
  try {
    const legacy = await dependencies.fulfillLegacyPurchase(event, session);
    return {
      canonical,
      legacy: {
        success: legacy.success,
        status: legacy.status || (legacy.success ? "fulfilled" : "failed"),
      },
    };
  } catch {
    return {
      canonical,
      legacy: { success: false, status: "failed_nonblocking" },
    };
  }
}
