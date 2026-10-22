import { createHash, randomBytes } from "node:crypto";

import { appendReaderAuditEvent } from "./services/audit-service.ts";
import {
  serverTimestamp,
  timestampFromDate,
  type ReaderPlatformDb,
} from "./services/service-support.ts";

const COLLECTION = "reader_free_handoffs";
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const CREDENTIAL_PATTERN = /^free\.([a-f0-9]{64})\.([A-Za-z0-9_-]{32,128})$/;

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAnonymousFreeHandoff(
  db: ReaderPlatformDb,
  input: {
    assetId: string;
    tenantId: string;
    origin: string;
    correlationId: string;
    now?: Date;
  }
): Promise<{ credential: string; expiresAt: Date }> {
  const id = randomBytes(32).toString("hex");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date((input.now || new Date()).getTime() + HANDOFF_TTL_MS);
  const reference = db.collection(COLLECTION).doc(id);
  await db.runTransaction(async (transaction) => {
    transaction.create(reference, {
      id,
      tokenDigest: digest(token),
      assetId: input.assetId,
      tenantId: input.tenantId,
      origin: input.origin,
      status: "active",
      createdAt: serverTimestamp(),
      expiresAt: timestampFromDate(expiresAt),
      consumedAt: null,
    });
    await appendReaderAuditEvent(db, {
      eventType: "anonymous_free_handoff.created",
      actorType: "system",
      actorId: null,
      subjectType: "session",
      subjectId: id,
      correlationId: input.correlationId,
      idempotencyKey: `anonymous-free-created:${id}`,
      metadata: { assetId: input.assetId, tenantId: input.tenantId, origin: input.origin },
    }, transaction);
  });
  return { credential: `free.${id}.${token}`, expiresAt };
}

export async function consumeAnonymousFreeHandoff(
  db: ReaderPlatformDb,
  input: {
    credential: string;
    assetId: string;
    origin: string;
    correlationId: string;
    now?: Date;
  }
): Promise<{ tenantId: string }> {
  const match = CREDENTIAL_PATTERN.exec(input.credential.trim());
  if (!match) throw new Error("READER_HANDOFF_INVALID");
  const reference = db.collection(COLLECTION).doc(match[1]);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() || {};
    const expiresAt = data.expiresAt?.toDate?.();
    const now = input.now || new Date();
    if (
      !snapshot.exists ||
      data.status !== "active" ||
      data.assetId !== input.assetId ||
      data.origin !== input.origin ||
      !(expiresAt instanceof Date) ||
      expiresAt <= now ||
      data.tokenDigest !== digest(match[2])
    ) {
      throw new Error("READER_HANDOFF_INVALID");
    }
    transaction.update(reference, {
      status: "consumed",
      consumedAt: serverTimestamp(),
    });
    await appendReaderAuditEvent(
      db,
      {
        eventType: "anonymous_free_handoff.consumed",
        actorType: "system",
        actorId: null,
        subjectType: "session",
        subjectId: match[1],
        correlationId: input.correlationId,
        idempotencyKey: `anonymous-free-consumed:${match[1]}`,
        metadata: { assetId: input.assetId, origin: input.origin },
      },
      transaction
    );
    return { tenantId: String(data.tenantId) };
  });
}

export function isAnonymousFreeHandoff(value: string): boolean {
  return CREDENTIAL_PATTERN.test(value.trim());
}
