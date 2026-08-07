import { decodeJwt } from "jose";

import { ReaderAuthError, resolveReaderIdentitySession } from "./reader-auth.ts";
import {
  authorizeReaderMedia,
  ReaderMediaAuthorizationError,
} from "./reader-media-authorization.ts";
import { readReaderSessionCookie } from "./reader-session-cookie.ts";
import type { ReaderPlatformDb } from "./services/service-support.ts";

const AUTHORITY_FIELDS = new Set([
  "readerUid",
  "uid",
  "status",
  "source",
  "entitlementId",
  "principalId",
]);

export interface ReaderMediaTokenHandlerDependencies {
  db: ReaderPlatformDb;
  issueToken(input: {
    principalId: string;
    tenantId: string;
    principalType: "firebase_uid";
  }): Promise<string>;
}

function safeBody(value: unknown): { assetId: string; tenantId: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => AUTHORITY_FIELDS.has(key))) return null;
  if (Object.keys(body).some((key) => key !== "assetId" && key !== "tenantId")) return null;
  if (typeof body.assetId !== "string" || typeof body.tenantId !== "string") return null;
  return { assetId: body.assetId.trim(), tenantId: body.tenantId.trim() };
}

export function createReaderMediaTokenHandler(
  dependencies: ReaderMediaTokenHandlerDependencies
) {
  return async function handle(request: Request): Promise<Response> {
    const body = safeBody(await request.json().catch(() => null));
    if (!body) {
      return Response.json(
        {
          success: false,
          code: "READER_MEDIA_REQUEST_INVALID",
          error: "A valid publication request is required.",
        },
        { status: 400 }
      );
    }
    try {
      const session = await resolveReaderIdentitySession(
        dependencies.db,
        readReaderSessionCookie(request.headers.get("cookie"))
      );
      const authorized = await authorizeReaderMedia(dependencies.db, {
        readerUid: session.readerUid,
        tenantId: body.tenantId,
        assetId: body.assetId,
      });
      const readerToken = await dependencies.issueToken({
        principalId: session.readerUid,
        tenantId: authorized.tenantId,
        principalType: "firebase_uid",
      });
      const expiration = decodeJwt(readerToken).exp;
      if (!expiration) throw new Error("READER_MEDIA_TOKEN_EXPIRATION_MISSING");
      return Response.json(
        {
          success: true,
          status: "authorized",
          assetId: authorized.assetId,
          tenantId: authorized.tenantId,
          readerToken,
          expiresAt: expiration * 1_000,
          publicationUrl: authorized.publicationUrl,
        },
        { status: 200 }
      );
    } catch (error: unknown) {
      if (error instanceof ReaderAuthError || error instanceof ReaderMediaAuthorizationError) {
        return Response.json(
          { success: false, code: error.code, error: error.message },
          { status: error.status }
        );
      }
      const code = error instanceof Error ? error.message : "";
      if (code === "READER_EMAIL_NOT_VERIFIED" || code === "READER_ACCOUNT_NOT_ACTIVE") {
        return Response.json(
          {
            success: false,
            code,
            error: "This reader account cannot authorize media access.",
          },
          { status: 403 }
        );
      }
      return Response.json(
        {
          success: false,
          code: "READER_MEDIA_AUTHORIZATION_FAILED",
          error: "KOBA-I could not authorize this publication.",
        },
        { status: 500 }
      );
    }
  };
}
