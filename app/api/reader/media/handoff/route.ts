import { NextResponse } from "next/server";
import { getFirebaseAdminServices, FirebaseAdminConfigurationError } from "@/core/firebase-admin";
import { createReaderMediaHandoffHandler } from "@/core/security/reader-media-handoff";
import { signReaderToken } from "@/core/security/reader-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const handler = createReaderMediaHandoffHandler({ db: getFirebaseAdminServices().db, issueToken: signReaderToken });
    return handler(request);
  } catch (error: unknown) {
    const configured = error instanceof FirebaseAdminConfigurationError;
    return NextResponse.json({ success: false, code: configured ? "FIREBASE_ADMIN_NOT_CONFIGURED" : "READER_HANDOFF_UNAVAILABLE", error: configured ? "Reader access is not configured on this server." : "The reader handoff is unavailable." }, { status: 500 });
  }
}
