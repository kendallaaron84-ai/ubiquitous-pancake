import { randomUUID } from "node:crypto";

import {
  ReaderAuthError,
  resolveReaderIdentitySession,
} from "./reader-auth.ts";
import {
  acquireReaderFreePublication,
  ReaderFreeAcquisitionError,
  READER_FREE_ACQUISITION_ERROR_CODES,
} from "./reader-free-acquisition.ts";
import { readReaderSessionCookie } from "./reader-session-cookie.ts";
import type { ReaderPlatformDb } from "./services/service-support.ts";

export interface ReaderFreeAcquisitionHttpResult {
  status: number;
  body: Record<string, unknown>;
}

function failure(
  status: number,
  code: string,
  error: string
): ReaderFreeAcquisitionHttpResult {
  return { status, body: { success: false, code, error } };
}

export async function handleReaderFreeAcquisitionRequest(
  db: ReaderPlatformDb,
  request: Request
): Promise<ReaderFreeAcquisitionHttpResult> {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    return failure(
      400,
      READER_FREE_ACQUISITION_ERROR_CODES.requestInvalid,
      "A valid free-publication acquisition request is required."
    );
  }

  const keys = Object.keys(body).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "assetId" ||
    keys[1] !== "tenantId" ||
    typeof body.assetId !== "string" ||
    typeof body.tenantId !== "string"
  ) {
    return failure(
      400,
      READER_FREE_ACQUISITION_ERROR_CODES.requestInvalid,
      "Only the publication asset and author storefront may be requested."
    );
  }

  try {
    const reader = await resolveReaderIdentitySession(
      db,
      readReaderSessionCookie(request.headers.get("cookie"))
    );
    const result = await acquireReaderFreePublication(db, {
      readerUid: reader.readerUid,
      tenantId: body.tenantId,
      assetId: body.assetId,
      correlationId:
        request.headers.get("x-request-id")?.trim() || randomUUID(),
    });
    return {
      status: 200,
      body: {
        success: true,
        assetId: result.assetId,
        entitlementId: result.entitlementId,
        acquired: result.acquired,
        replay: result.replay,
        bookshelfUrl: "/reader/account",
      },
    };
  } catch (error: unknown) {
    if (error instanceof ReaderAuthError) {
      return failure(error.status, error.code, error.message);
    }
    if (error instanceof ReaderFreeAcquisitionError) {
      return failure(error.status, error.code, error.message);
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "READER_EMAIL_NOT_VERIFIED") {
      return failure(
        403,
        "READER_EMAIL_VERIFICATION_REQUIRED",
        "Verify your email address before acquiring this publication."
      );
    }
    if (code === "READER_ACCOUNT_NOT_ACTIVE" || code === "READER_ACCOUNT_DELETED") {
      return failure(
        403,
        "READER_ACCOUNT_NOT_ACTIVE",
        "This reader account is not active."
      );
    }
    throw error;
  }
}
