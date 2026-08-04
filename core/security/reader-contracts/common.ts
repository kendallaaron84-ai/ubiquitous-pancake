import { createHash } from "node:crypto";
import type { Timestamp } from "firebase-admin/firestore";

export type FirestoreTime = Timestamp;
export type ReaderAccountStatus = "active" | "disabled" | "deleted";
export type ReaderEntitlementStatus = "active" | "suspended" | "revoked" | "refunded";
export type ReaderEntitlementSource = "purchase" | "promotion" | "manual_grant" | "legacy_migration";

export function normalizeReaderEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function sha256Id(...parts: Array<string | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("\u001f"))
    .digest("hex");
}

export function requireNonEmpty(value: string, field: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`READER_CONTRACT_INVALID:${field}`);
  return cleaned;
}
