import type { FirestoreTime } from "./common";

export type ReaderPurchaseStatus = "pending" | "paid" | "partially_refunded" | "refunded" | "failed";
export type ReaderDisputeStatus = "none" | "open" | "won" | "lost";

export interface CanonicalReaderPurchase {
  id: string;
  stripeAccountId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  stripeCustomerId: string | null;
  stripeEventId: string;
  purchaseEmailNormalized: string;
  purchaseEmailHash: string;
  currency: string;
  amountTotalMinor: number;
  amountRefundedMinor: number;
  lineItemCount: number;
  paymentStatus: ReaderPurchaseStatus;
  disputeStatus: ReaderDisputeStatus;
  idempotencyKey: string;
  lastStripeEventCreated: number;
  createdAt: FirestoreTime;
  updatedAt: FirestoreTime;
}
