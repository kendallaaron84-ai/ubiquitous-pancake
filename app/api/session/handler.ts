import { NextResponse } from "next/server";

import type { DashboardSessionClaims } from "@/core/security/dashboard-session";
import { DashboardRequestAuthError } from "@/core/security/dashboard-request-auth";
import type { ContentEngineAccessResult } from "@/core/security/content-engine-access";

type RecordData = Record<string, unknown>;

export interface SessionStatusDependencies {
  authenticate(request: Request): Promise<DashboardSessionClaims>;
  loadAccess(session: DashboardSessionClaims): Promise<ContentEngineAccessResult>;
  loadConnection(studioKey: string): Promise<{ exists: boolean; data: RecordData }>;
  ownerEmails: readonly string[];
}

export function createSessionStatusHandler(dependencies: SessionStatusDependencies) {
  return async function GET(request: Request) {
    try {
      const session = await dependencies.authenticate(request);
      const owners = new Set(dependencies.ownerEmails.map((email) => email.trim().toLowerCase()));
      const isOwner = owners.has(session.email.trim().toLowerCase());
      const { hasContentEngineAccess, hasOwnedActiveLicense } = await dependencies.loadAccess(session);
      if (session.studioKey && !hasOwnedActiveLicense) {
        return NextResponse.json({
          authenticated: false,
          isOwner: false,
          connectionStatus: "not_connected",
          code: "STUDIO_KEY_OWNERSHIP_MISMATCH",
        }, { status: 403, headers: noStore() });
      }

      let connectionStatus: "connected" | "not_connected" = "not_connected";
      let targetWpOrigin = "";
      if (session.studioKey) {
        const connection = await dependencies.loadConnection(session.studioKey);
        if (
          connection.exists &&
          connection.data.status === "active" &&
          connection.data.verificationStatus === "verified"
        ) {
          connectionStatus = "connected";
          targetWpOrigin = typeof connection.data.targetWpOrigin === "string"
            ? connection.data.targetWpOrigin.trim()
            : "";
        }
      }

      return NextResponse.json({
        authenticated: true,
        isOwner,
        hasContentEngineAccess,
        connectionStatus,
        studioKey: session.studioKey,
        targetWpOrigin,
      }, { headers: noStore(true) });
    } catch (error) {
      const authError = error instanceof DashboardRequestAuthError ? error : null;
      return NextResponse.json({
        authenticated: false,
        isOwner: false,
        connectionStatus: "not_connected",
        ...(authError ? { code: authError.code } : {}),
      }, { status: authError?.status || 401, headers: noStore() });
    }
  };
}

function noStore(privateResponse = false) {
  return { "Cache-Control": privateResponse ? "private, no-store" : "no-store" };
}
