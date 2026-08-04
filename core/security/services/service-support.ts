import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
export type ReaderPlatformDb = Pick<Firestore, "collection" | "runTransaction">;
export type ReaderPlatformTransaction = Transaction;
export const readerPlatformCollections = { profiles: "reader_profiles", purchases: "reader_purchases", purchaseItems: "reader_purchase_items", claims: "pending_purchase_claims", entitlements: "reader_entitlements", sessions: "reader_sessions", migrations: "legacy_reader_migrations", audit: "reader_audit_events" } as const;
export const serverTimestamp = (): FieldValue => FieldValue.serverTimestamp();
export const timestampFromDate = (value: Date): Timestamp => Timestamp.fromDate(value);
