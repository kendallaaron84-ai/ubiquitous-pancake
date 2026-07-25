import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import { loadContentEngineAccess } from "@/core/security/content-engine-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { authenticated: false, isOwner: false, connectionStatus: "not_connected" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const session = await verifyDashboardSession(
      token,
      resolveDashboardSessionSecret()
    );
    const ownerEmails = new Set(
      (process.env.KOBA_OWNER_EMAILS || "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    );
    const isOwner = ownerEmails.has(session.email.trim().toLowerCase());

    const { hasContentEngineAccess } = await loadContentEngineAccess(
      adminDb,
      session
    );

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
  } catch {
    return NextResponse.json(
      { authenticated: false, isOwner: false, connectionStatus: "not_connected" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
}
