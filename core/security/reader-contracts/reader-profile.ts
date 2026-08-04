import type { FirestoreTime, ReaderAccountStatus } from "./common";

export interface CanonicalReaderProfile {
  uid: string;
  email: string;
  emailNormalized: string;
  emailVerified: boolean;
  displayName: string | null;
  accountStatus: ReaderAccountStatus;
  authProvider: "password" | "google" | "mixed";
  createdAt: FirestoreTime;
  updatedAt: FirestoreTime;
  deletedAt: FirestoreTime | null;
}
