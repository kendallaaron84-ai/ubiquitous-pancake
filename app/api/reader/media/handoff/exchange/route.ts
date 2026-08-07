import { NextResponse } from "next/server";
import { getFirebaseAdminServices, FirebaseAdminConfigurationError } from "@/core/firebase-admin";
import { createReaderMediaHandoffExchangeHandler } from "@/core/security/reader-media-handoff";
import { signReaderToken } from "@/core/security/reader-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cors(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Cache-Control": "private, no-store" };
  if (origin) Object.assign(headers, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" });
  return headers;
}
export async function OPTIONS(request: Request) { return new NextResponse(null, { status: 204, headers: cors(request.headers.get("origin")) }); }
export async function POST(request: Request) {
  try {
    const handler = createReaderMediaHandoffExchangeHandler({ db: getFirebaseAdminServices().db, issueToken: signReaderToken });
    const response = await handler(request);
    return new NextResponse(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors(request.headers.get("origin")) } });
  } catch (error: unknown) {
    const configured = error instanceof FirebaseAdminConfigurationError;
    return NextResponse.json({ success: false, code: configured ? "FIREBASE_ADMIN_NOT_CONFIGURED" : "READER_HANDOFF_UNAVAILABLE", error: configured ? "Reader access is not configured on this server." : "The reader handoff is unavailable." }, { status: 500, headers: cors(request.headers.get("origin")) });
  }
}
