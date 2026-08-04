import type Stripe from "stripe";
import { adminDb } from "@/core/firebase-admin";
import { applyPurchaseItemFinancialTransition } from "./services/purchase-service";
import { readerPlatformCollections } from "./services/service-support";

function objectId(value: string | { id: string } | null): string { return typeof value === "string" ? value : value?.id || ""; }

export async function processCanonicalReaderFinancialEvent(event: Stripe.Event): Promise<{ processed: boolean; reason?: string }> {
  let paymentIntentId = ""; let transition: "full_refund" | "partial_refund" | "dispute_opened" | "dispute_won" | "dispute_lost" | null = null; let amountRefundedMinor: number | undefined;
  if (event.type === "charge.refunded") { const charge = event.data.object as Stripe.Charge; paymentIntentId = objectId(charge.payment_intent); amountRefundedMinor = charge.amount_refunded; transition = charge.refunded || charge.amount_refunded >= charge.amount ? "full_refund" : "partial_refund"; }
  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") { const dispute = event.data.object as Stripe.Dispute; paymentIntentId = objectId(dispute.payment_intent); transition = event.type === "charge.dispute.created" ? "dispute_opened" : dispute.status === "won" ? "dispute_won" : dispute.status === "lost" ? "dispute_lost" : null; }
  if (!paymentIntentId || !transition) return { processed: false, reason: "unsupported_or_unresolved_event" };
  const purchases = await adminDb.collection(readerPlatformCollections.purchases).where("stripePaymentIntentId", "==", paymentIntentId).limit(2).get(); if (purchases.size !== 1) return { processed: false, reason: "purchase_not_unique" }; const purchase = purchases.docs[0]; const items = await adminDb.collection(readerPlatformCollections.purchaseItems).where("purchaseId", "==", purchase.id).get();
  if (items.size !== 1) return { processed: false, reason: "line_item_allocation_requires_manual_review" };
  await applyPurchaseItemFinancialTransition(adminDb, { purchaseId: purchase.id, purchaseLineItemId: items.docs[0].id, transition, amountRefundedMinor, stripeEventId: event.id, correlationId: event.id }); return { processed: true };
}
