import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import {
  DashboardRequestAuthError,
  requireDashboardRequestSession,
} from "@/core/security/dashboard-request-auth";
import { loadContentEngineAccess } from "@/core/security/content-engine-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await requireDashboardRequestSession(request);
    const ownerEmails = new Set(
      (process.env.KOBA_OWNER_EMAILS || "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    );
    const isOwner = ownerEmails.has(session.email.trim().toLowerCase());

    const { hasContentEngineAccess, hasOwnedActiveLicense } = await loadContentEngineAccess(
      adminDb,
      session
    );
    if (session.studioKey && !hasOwnedActiveLicense) {
      return NextResponse.json(
        {
          authenticated: false,
          isOwner: false,
          connectionStatus: "not_connected",
          code: "STUDIO_KEY_OWNERSHIP_MISMATCH",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    let connectionStatus: "connected" | "not_connected" = "not_connected";
    let targetWpOrigin = "";
    if (session.studioKey) {
      const connection = await adminDb
        .collection("connections")
        .doc(session.studioKey)
        .get();
      const data = connection.data() || {};
      if (
        connection.exists &&
        data.status === "active" &&
        data.verificationStatus === "verified"
      ) {
        connectionStatus = "connected";
        targetWpOrigin =
          typeof data.targetWpOrigin === "string"
            ? data.targetWpOrigin.trim()
            : "";
      }
    }

    return NextResponse.json(
      {
        authenticated: true,
        isOwner,
        hasContentEngineAccess,
        connectionStatus,
        studioKey: session.studioKey,
        targetWpOrigin,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const authError = error instanceof DashboardRequestAuthError ? error : null;
    return NextResponse.json(
      {
        authenticated: false,
        isOwner: false,
        connectionStatus: "not_connected",
        ...(authError ? { code: authError.code } : {}),
      },
      { status: authError?.status || 401, headers: { "Cache-Control": "no-store" } }
    );
  }
}
