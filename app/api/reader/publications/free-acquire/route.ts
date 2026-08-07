import { NextResponse } from "next/server";

import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminServices,
} from "@/core/firebase-admin";
import { handleReaderFreeAcquisitionRequest } from "@/core/security/reader-free-acquisition-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let services;
  try {
    services = getFirebaseAdminServices();
  } catch (error: unknown) {
    console.error("Reader free acquisition configuration failed.", {
      code: "FIREBASE_ADMIN_NOT_CONFIGURED",
      missingVariables:
        error instanceof FirebaseAdminConfigurationError
          ? error.missingVariables
          : [],
    });
    return NextResponse.json(
      {
        success: false,
        code: "FIREBASE_ADMIN_NOT_CONFIGURED",
        error: "Reader publication acquisition is not configured on this server.",
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    const result = await handleReaderFreeAcquisitionRequest(
      services.db,
      request
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: unknown) {
    console.error("Reader free acquisition failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof Error ? error.message : "UNKNOWN",
    });
    return NextResponse.json(
      {
        success: false,
        code: "FREE_PUBLICATION_ACQUISITION_FAILED",
        error: "KOBA-I could not acquire this publication.",
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
