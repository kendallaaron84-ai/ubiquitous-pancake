import { NextResponse } from "next/server";

import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminServices,
} from "@/core/firebase-admin";
import { createReaderMediaTokenHandler } from "@/core/security/reader-media-token-handler";
import { signReaderToken } from "@/core/security/reader-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const services = getFirebaseAdminServices();
    const handler = createReaderMediaTokenHandler({
      db: services.db,
      issueToken: signReaderToken,
    });
    const response = await handler(request);
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error: unknown) {
    const configured = error instanceof FirebaseAdminConfigurationError;
    return NextResponse.json(
      {
        success: false,
        code: configured
          ? "FIREBASE_ADMIN_NOT_CONFIGURED"
          : "READER_MEDIA_AUTHORIZATION_FAILED",
        error: configured
          ? "Reader access is not configured on this server."
          : "KOBA-I could not authorize this publication.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    );
  }
}
