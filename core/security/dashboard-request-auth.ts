import { cookies } from "next/headers";

import { adminDb, getFirebaseAdminAuth } from "@/core/firebase-admin";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardAccessScope,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
  type DashboardSessionClaims,
} from "@/core/security/dashboard-session";

type RecordData = Record<string, unknown>;

export class DashboardRequestAuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly code: string,
    readonly publicMessage: string
  ) {
    super(publicMessage);
    this.name = "DashboardRequestAuthError";
  }
}

export async function requireDashboardRequestSession(
  request: Request
): Promise<DashboardSessionClaims> {
  const bearer = readBearerToken(request.headers.get("authorization"));
  if (bearer) {
    return resolveBearerDashboardSession(bearer);
  }

  const sessionToken = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
  if (!sessionToken) {
    throw new DashboardRequestAuthError(
      401,
      "DASHBOARD_AUTHENTICATION_REQUIRED",
      "Authentication is required."
    );
  }

  try {
    return await verifyDashboardSession(
      sessionToken,
      resolveDashboardSessionSecret()
    );
  } catch {
    throw new DashboardRequestAuthError(
      401,
      "DASHBOARD_SESSION_INVALID",
      "Your dashboard session is invalid or expired."
    );
  }
}

export function readBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
  if (!match) {
    throw new DashboardRequestAuthError(
      401,
      "DASHBOARD_BEARER_INVALID",
      "Bearer authorization is malformed."
    );
  }
  return match[1];
}

async function resolveBearerDashboardSession(
  idToken: string
): Promise<DashboardSessionClaims> {
  if (!adminDb) {
    throw new DashboardRequestAuthError(
      503,
      "DASHBOARD_AUTH_UNAVAILABLE",
      "Dashboard authentication is temporarily unavailable."
    );
  }

  let claims;
  try {
    claims = await getFirebaseAdminAuth().verifyIdToken(idToken);
  } catch {
    throw new DashboardRequestAuthError(
      401,
      "DASHBOARD_BEARER_INVALID",
      "Bearer authorization is invalid or expired."
    );
  }

  const email = clean(claims.email).toLowerCase();
  const uid = clean(claims.uid);
  if (!email || !uid) {
    throw new DashboardRequestAuthError(
      401,
      "DASHBOARD_BEARER_CLAIMS_INVALID",
      "Bearer authorization is missing verified identity claims."
    );
  }

  const canonical = await adminDb.collection("users").doc(email).get();
  const uidRecord = canonical.exists
    ? null
    : await adminDb.collection("users").doc(uid).get();
  const userData = (canonical.exists ? canonical.data() : uidRecord?.data()) as
    | RecordData
    | undefined;
  const profileEmail = clean(userData?.email).toLowerCase();
  if (profileEmail && profileEmail !== email) {
    throw new DashboardRequestAuthError(
      403,
      "DASHBOARD_PROFILE_OWNERSHIP_MISMATCH",
      "The authenticated identity does not own this dashboard profile."
    );
  }

  return {
    uid,
    email,
    studioKey: clean(userData?.studioKey) || null,
    accessScope: resolveDashboardAccessScope(email),
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
