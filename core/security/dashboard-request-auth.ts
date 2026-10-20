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

export interface DashboardRequestAuthDependencies {
  readSessionCookie(request: Request): Promise<string | null>;
  verifySession(token: string): Promise<DashboardSessionClaims>;
  verifyIdToken(token: string): Promise<{ uid?: unknown; email?: unknown }>;
  loadUserProfile(email: string, uid: string): Promise<RecordData | null>;
  resolveAccessScope(email: string): DashboardSessionClaims["accessScope"];
}

export class DashboardRequestAuthError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code: string;
  readonly publicMessage: string;

  constructor(
    status: 401 | 403 | 503,
    code: string,
    publicMessage: string
  ) {
    super(publicMessage);
    this.name = "DashboardRequestAuthError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export async function requireDashboardRequestSession(
  request: Request
): Promise<DashboardSessionClaims> {
  return authenticateDashboardRequest(request, {
    async readSessionCookie() {
      return (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value || null;
    },
    verifySession(token) {
      return verifyDashboardSession(token, resolveDashboardSessionSecret());
    },
    async verifyIdToken(token) {
      return getFirebaseAdminAuth().verifyIdToken(token);
    },
    async loadUserProfile(email, uid) {
      if (!adminDb) {
        throw new DashboardRequestAuthError(
          503,
          "DASHBOARD_AUTH_UNAVAILABLE",
          "Dashboard authentication is temporarily unavailable."
        );
      }
      const canonical = await adminDb.collection("users").doc(email).get();
      const uidRecord = canonical.exists
        ? null
        : await adminDb.collection("users").doc(uid).get();
      return (canonical.exists ? canonical.data() : uidRecord?.data()) as RecordData | null;
    },
    resolveAccessScope: resolveDashboardAccessScope,
  });
}

export async function authenticateDashboardRequest(
  request: Request,
  dependencies: DashboardRequestAuthDependencies
): Promise<DashboardSessionClaims> {
  const bearer = readBearerToken(request.headers.get("authorization"));
  if (bearer) {
    return resolveBearerDashboardSession(bearer, dependencies);
  }

  const sessionToken = await dependencies.readSessionCookie(request);
  if (!sessionToken) {
    throw new DashboardRequestAuthError(
      401,
      "DASHBOARD_AUTHENTICATION_REQUIRED",
      "Authentication is required."
    );
  }

  try {
    return await dependencies.verifySession(sessionToken);
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
  idToken: string,
  dependencies: DashboardRequestAuthDependencies
): Promise<DashboardSessionClaims> {
  let claims;
  try {
    claims = await dependencies.verifyIdToken(idToken);
  } catch (error) {
    if (error instanceof DashboardRequestAuthError) throw error;
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

  const userData = await dependencies.loadUserProfile(email, uid);
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
    accessScope: dependencies.resolveAccessScope(email),
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
