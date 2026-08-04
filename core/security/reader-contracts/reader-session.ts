import type { FirestoreTime } from "./common";

export type ReaderSessionStatus = "active" | "revoked" | "expired";
export interface CanonicalReaderSession {
  id: string;
  readerUid: string;
  siteId: string | null;
  scope: "central" | "author_site";
  status: ReaderSessionStatus;
  tokenDigest: string;
  createdAt: FirestoreTime;
  expiresAt: FirestoreTime;
  lastValidatedAt: FirestoreTime;
  revokedAt: FirestoreTime | null;
  revocationReason: string | null;
}
