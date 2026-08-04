import type Stripe from "stripe";
import { adminDb } from "@/core/firebase-admin";
import { recordPaidStripePurchase } from "./services/purchase-service";

function clean(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function stripeId(value: string | { id: string } | null): string | null { return typeof value === "string" ? value : value?.id || null; }

export async function processCanonicalReaderPurchase(event: Stripe.Event, session: Stripe.Checkout.Session, stripe: Stripe): Promise<{ purchaseId: string; claimId: string; replay: boolean }> {
  if (session.status !== "complete" || session.payment_status !== "paid") throw new Error("CANONICAL_PURCHASE_NOT_PAID");
  const tenantFallback = clean(session.metadata?.tenantKey); const assetFallback = clean(session.metadata?.assetKey || session.metadata?.assetId); const accountId = clean(event.account) || null;
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ["data.price.product"] }, accountId ? { stripeAccount: accountId } : undefined);
  const canonicalLines = lineItems.data.map((line, index) => { const price = line.price; const product = price?.product; const productMetadata = product && typeof product === "object" && "metadata" in product ? product.metadata : {}; const tenantId = clean(price?.metadata?.tenantId || price?.metadata?.tenantKey || productMetadata?.tenantId || productMetadata?.tenantKey || tenantFallback); const assetId = clean(price?.metadata?.assetId || price?.metadata?.assetKey || productMetadata?.assetId || productMetadata?.assetKey || (lineItems.data.length === 1 ? assetFallback : "")); if (!tenantId || !assetId) throw new Error("CANONICAL_PURCHASE_LINE_MAPPING_MISSING"); return { stripeLineItemId: clean(line.id) || `${session.id}:${index}`, stripePriceId: clean(price?.id) || null, stripeProductId: typeof product === "string" ? product : clean(product?.id) || null, tenantId, assetId, quantity: line.quantity || 1, currency: clean(line.currency || session.currency) || "usd", amountTotalMinor: Number(line.amount_total || 0) }; });
  const purchaseEmail = clean(session.customer_details?.email || session.customer_email).toLowerCase();
  return recordPaidStripePurchase(adminDb, { stripeAccountId: accountId, stripeCheckoutSessionId: session.id, stripePaymentIntentId: stripeId(session.payment_intent), stripeCustomerId: stripeId(session.customer), stripeEventId: event.id, stripeEventCreated: event.created, purchaseEmail, currency: clean(session.currency) || "usd", amountTotalMinor: Number(session.amount_total || canonicalLines.reduce((sum, line) => sum + line.amountTotalMinor, 0)), lineItems: canonicalLines, correlationId: event.id });
}
