import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminServices,
} from "@/core/firebase-admin";
import {
  ReaderAuthError,
  resolveReaderIdentitySession,
} from "@/core/security/reader-auth";
import {
  ReaderPurchaseRecoveryError,
  recoverReaderPurchaseForAsset,
} from "@/core/security/reader-purchase-recovery";
import { readReaderSessionCookie } from "@/core/security/reader-session-cookie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(status: number, code: string, error: string) {
  return NextResponse.json(
    { success: false, code, error },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: Request) {
  let body: { assetId?: unknown };
  try {
    body = (await request.json()) as { assetId?: unknown };
  } catch {
    return failure(
      400,
      "READER_PURCHASE_RECOVERY_REQUEST_INVALID",
      "A valid publication is required."
    );
  }

  try {
    const services = getFirebaseAdminServices();
    const reader = await resolveReaderIdentitySession(
      services.db,
      readReaderSessionCookie(request.headers.get("cookie"))
    );
    const result = await recoverReaderPurchaseForAsset(services.db, {
      readerUid: reader.readerUid,
      assetId: typeof body.assetId === "string" ? body.assetId : "",
      correlationId: request.headers.get("x-request-id")?.trim() || randomUUID(),
    });
    return NextResponse.json(
      {
        success: true,
        status: result.status,
        entitlementCount: result.entitlementIds.length,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: unknown) {
    if (error instanceof FirebaseAdminConfigurationError) {
      return failure(
        500,
        "FIREBASE_ADMIN_NOT_CONFIGURED",
        "Reader purchase recovery is not configured on this server."
      );
    }
    if (error instanceof ReaderAuthError) {
      return failure(error.status, error.code, error.message);
    }
    if (error instanceof ReaderPurchaseRecoveryError) {
      return failure(error.status, error.code, error.message);
    }
    console.error("Reader purchase recovery failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof Error ? error.message : "UNKNOWN",
    });
    return failure(
      500,
      "READER_PURCHASE_RECOVERY_FAILED",
      "KOBA-I could not recover this purchase."
    );
  }
}
