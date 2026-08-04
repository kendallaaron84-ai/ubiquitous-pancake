import type { FirestoreTime } from "./common";

export interface ReaderAuditEvent {
  id: string;
  eventType: string;
  actorType: "reader" | "system" | "stripe" | "admin";
  actorId: string | null;
  subjectType: "reader" | "purchase" | "purchase_item" | "claim" | "entitlement" | "session" | "migration";
  subjectId: string;
  correlationId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: FirestoreTime;
}
