import type { FirestoreTime, ReaderEntitlementSource, ReaderEntitlementStatus } from "./common";

export interface CanonicalReaderEntitlement {
  id: string;
  readerUid: string;
  tenantId: string;
  assetId: string;
  purchaseId: string | null;
  purchaseLineItemId: string | null;
  status: ReaderEntitlementStatus;
  source: ReaderEntitlementSource;
  lastValidatedAt: FirestoreTime | null;
  suspendedAt: FirestoreTime | null;
  revokedAt: FirestoreTime | null;
  refundedAt: FirestoreTime | null;
  legacyEntitlementId: string | null;
  legacyReaderAccessKey: string | null;
  createdAt: FirestoreTime;
  updatedAt: FirestoreTime;
}
