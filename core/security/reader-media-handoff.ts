import { decodeJwt } from "jose";

import { ReaderAuthError, resolveReaderIdentitySession } from "./reader-auth.ts";
import { authorizeReaderMedia, ReaderMediaAuthorizationError } from "./reader-media-authorization.ts";
import { readReaderSessionCookie } from "./reader-session-cookie.ts";
import { consumeAuthorSiteReaderSession, createReaderSession } from "./services/reader-session-service.ts";
import type { ReaderPlatformDb } from "./services/service-support.ts";

const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;
const HANDOFF_PATTERN = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{32,128})$/;
const HANDOFF_TTL_MS = 5 * 60 * 1000;

export const READER_HANDOFF_ERROR_CODES = {
  requestInvalid: "READER_HANDOFF_REQUEST_INVALID",
  invalid: "READER_HANDOFF_INVALID",
  originRequired: "READER_HANDOFF_ORIGIN_REQUIRED",
} as const;

export interface ReaderMediaHandoffDependencies {
  db: ReaderPlatformDb;
  issueToken(input: { principalId: string; tenantId: string; principalType: "firebase_uid" }): Promise<string>;
}

function safeAssetBody(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.assetId !== "string") return null;
  const assetId = body.assetId.trim();
  return ASSET_ID_PATTERN.test(assetId) ? assetId : null;
}

function exactHttpsOrigin(value: string | null): string | null {
  try {
    const parsed = new URL(value || "");
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

async function authoritativeTenant(db: ReaderPlatformDb, assetId: string): Promise<string> {
  const snapshot = await db.collection("products").doc(assetId).get();
  const data = snapshot.data() || {};
  const tenantId = String(data.studioKey || data.wpStudioKey || "").trim();
  return snapshot.exists ? tenantId : "";
}

function publicFailure(error: unknown): Response {
  if (error instanceof ReaderAuthError || error instanceof ReaderMediaAuthorizationError) {
    return Response.json({ success: false, code: error.code, error: error.message }, { status: error.status });
  }
  return Response.json({ success: false, code: READER_HANDOFF_ERROR_CODES.invalid, error: "The reader handoff is invalid or expired." }, { status: 401 });
}

export function createReaderMediaHandoffHandler(dependencies: ReaderMediaHandoffDependencies) {
  return async (request: Request): Promise<Response> => {
    const assetId = safeAssetBody(await request.json().catch(() => null));
    if (!assetId) return Response.json({ success: false, code: READER_HANDOFF_ERROR_CODES.requestInvalid, error: "A valid publication asset is required." }, { status: 400 });
    try {
      const reader = await resolveReaderIdentitySession(dependencies.db, readReaderSessionCookie(request.headers.get("cookie")));
      const tenantId = await authoritativeTenant(dependencies.db, assetId);
      const authorized = await authorizeReaderMedia(dependencies.db, { readerUid: reader.readerUid, tenantId, assetId });
      const publicationOrigin = exactHttpsOrigin(authorized.publicationUrl);
      if (!publicationOrigin || !authorized.publicationUrl) throw new Error("READER_HANDOFF_DESTINATION_INVALID");
      const handoff = await createReaderSession(dependencies.db, { readerUid: reader.readerUid, siteId: publicationOrigin, resourceId: assetId, scope: "author_site", ttlMs: HANDOFF_TTL_MS, correlationId: crypto.randomUUID() });
      const launchUrl = new URL(authorized.publicationUrl);
      launchUrl.hash = `koba_reader_handoff=${encodeURIComponent(`${handoff.sessionId}.${handoff.token}`)}`;
      return Response.json({ success: true, assetId, launchUrl: launchUrl.toString(), expiresAt: handoff.expiresAt.toISOString() });
    } catch (error: unknown) {
      return publicFailure(error);
    }
  };
}

export function createReaderMediaHandoffExchangeHandler(dependencies: ReaderMediaHandoffDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = exactHttpsOrigin(request.headers.get("origin"));
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const assetId = body && Object.keys(body).every((key) => key === "assetId" || key === "handoff") ? String(body.assetId || "").trim() : "";
    const match = body && typeof body.handoff === "string" ? HANDOFF_PATTERN.exec(body.handoff.trim()) : null;
    if (!origin) return Response.json({ success: false, code: READER_HANDOFF_ERROR_CODES.originRequired, error: "An HTTPS author-site origin is required." }, { status: 403 });
    if (!match || !ASSET_ID_PATTERN.test(assetId)) return Response.json({ success: false, code: READER_HANDOFF_ERROR_CODES.requestInvalid, error: "A valid reader handoff is required." }, { status: 400 });
    try {
      const consumed = await consumeAuthorSiteReaderSession(dependencies.db, { sessionId: match[1], token: match[2], siteOrigin: origin, resourceId: assetId, correlationId: crypto.randomUUID() });
      const tenantId = await authoritativeTenant(dependencies.db, assetId);
      const authorized = await authorizeReaderMedia(dependencies.db, { readerUid: consumed.readerUid, tenantId, assetId, requestOrigin: origin });
      const readerToken = await dependencies.issueToken({ principalId: consumed.readerUid, tenantId: authorized.tenantId, principalType: "firebase_uid" });
      const expiration = decodeJwt(readerToken).exp;
      if (!expiration) throw new Error("READER_MEDIA_TOKEN_EXPIRATION_MISSING");
      return Response.json({ success: true, assetId, tenantId: authorized.tenantId, principalType: "firebase_uid", readerToken, expiresAt: expiration * 1000 });
    } catch (error: unknown) {
      return publicFailure(error);
    }
  };
}
