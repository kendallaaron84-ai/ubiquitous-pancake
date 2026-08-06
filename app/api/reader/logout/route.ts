import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getFirebaseAdminServices } from "@/core/firebase-admin";
import { revokeReaderSession } from "@/core/security/services/reader-session-service";
import {
  expiredReaderSessionCookieOptions,
  readReaderSessionCookie,
  READER_SESSION_COOKIE,
} from "@/core/security/reader-session-cookie";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookie = readReaderSessionCookie(request.headers.get("cookie"));
  if (cookie) {
    try {
      const services = getFirebaseAdminServices();
      await revokeReaderSession(
        services.db,
        cookie.sessionId,
        "reader_logout",
        request.headers.get("x-request-id")?.trim() || randomUUID()
      );
    } catch (error: unknown) {
      console.error("Reader logout revocation failed.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return NextResponse.json(
        {
          success: false,
          code: "READER_LOGOUT_FAILED",
          error: "KOBA-I could not revoke the reader session.",
        },
        { status: 500 }
      );
    }
  }

  const response = NextResponse.json(
    { success: true },
    { status: 200, headers: { "Cache-Control": "private, no-store" } }
  );
  response.cookies.set(
    READER_SESSION_COOKIE,
    "",
    expiredReaderSessionCookieOptions()
  );
  return response;
}
