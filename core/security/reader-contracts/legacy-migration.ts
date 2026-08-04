import type { FirestoreTime } from "./common";

export type LegacyMigrationStatus = "pending" | "eligible" | "claimed" | "rejected" | "rolled_back";
export interface LegacyReaderMigration {
  id: string;
  legacyEntitlementId: string;
  normalizedPhonePrincipal: string | null;
  readerAccessKey: string | null;
  readerJwtSubject: string | null;
  lastVerifiedNetworkHash: string | null;
  status: LegacyMigrationStatus;
  claimedFirebaseUid: string | null;
  reason: string | null;
  createdAt: FirestoreTime;
  updatedAt: FirestoreTime;
  claimedAt: FirestoreTime | null;
  rolledBackAt: FirestoreTime | null;
}
