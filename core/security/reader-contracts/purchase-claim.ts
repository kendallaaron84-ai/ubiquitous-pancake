import type { FirestoreTime } from "./common";

export type PendingPurchaseClaimStatus = "unclaimed" | "claimed" | "blocked";

export interface PendingPurchaseClaim {
  id: string;
  purchaseId: string;
  purchaseEmailHash: string;
  status: PendingPurchaseClaimStatus;
  claimedUid: string | null;
  claimedAt: FirestoreTime | null;
  entitlementIds: string[];
  manualReviewRequired: boolean;
  blockedReason: string | null;
  createdAt: FirestoreTime;
  updatedAt: FirestoreTime;
}
