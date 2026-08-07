import { NextResponse } from "next/server";

import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminServices,
} from "@/core/firebase-admin";
import { createAnonymousFreeMediaHandoffHandler } from "@/core/security/reader-media-handoff";
import { signReaderToken } from "@/core/security/reader-token";
import { verifyFreePublicationHuman } from "@/core/security/turnstile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return createAnonymousFreeMediaHandoffHandler({
      db: getFirebaseAdminServices().db,
      issueToken: signReaderToken,
      verifyHuman: ({ token, assetId }) =>
        verifyFreePublicationHuman({ token, assetId }),
    })(request);
  } catch (error: unknown) {
    const configurationFailure = error instanceof FirebaseAdminConfigurationError;
    return NextResponse.json(
      {
        success: false,
        code: configurationFailure
          ? "FIREBASE_ADMIN_NOT_CONFIGURED"
          : "READER_HANDOFF_UNAVAILABLE",
        error: configurationFailure
          ? "Reader access is not configured on this server."
          : "The free-publication handoff is unavailable.",
      },
      { status: 500 }
    );
  }
}
