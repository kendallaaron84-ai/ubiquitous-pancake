import type { FirestoreTime } from "./common";

export type ReaderPurchaseItemStatus = "paid" | "suspended" | "revoked" | "refunded";

export interface CanonicalReaderPurchaseLineItem {
  id: string;
  purchaseId: string;
  stripeLineItemId: string;
  stripePriceId: string | null;
  stripeProductId: string | null;
  tenantId: string;
  assetId: string;
  quantity: number;
  currency: string;
  amountTotalMinor: number;
  amountRefundedMinor: number;
  status: ReaderPurchaseItemStatus;
  createdAt: FirestoreTime;
  updatedAt: FirestoreTime;
}
