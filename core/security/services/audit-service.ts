import type { ReaderAuditEvent } from "../reader-contracts/index.ts";
import { sha256Id } from "../reader-contracts/index.ts";
import { readerPlatformCollections, serverTimestamp, type ReaderPlatformDb, type ReaderPlatformTransaction } from "./service-support.ts";
export type AppendAuditEventInput = Omit<ReaderAuditEvent, "id" | "createdAt"> & { idempotencyKey: string };
export function deterministicAuditEventId(input: Pick<AppendAuditEventInput, "eventType" | "subjectId" | "correlationId" | "idempotencyKey">): string { return sha256Id("reader-audit", input.eventType, input.subjectId, input.correlationId, input.idempotencyKey); }
export async function appendReaderAuditEvent(db: ReaderPlatformDb, input: AppendAuditEventInput, transaction?: ReaderPlatformTransaction): Promise<string> {
  const id = deterministicAuditEventId(input); const reference = db.collection(readerPlatformCollections.audit).doc(id);
  const { idempotencyKey: _ignored, ...event } = input; const payload = { id, ...event, createdAt: serverTimestamp() };
  if (transaction) { transaction.create(reference, payload); }
  else { await reference.create(payload); }
  return id;
}
