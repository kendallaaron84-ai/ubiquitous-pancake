import { cookies } from "next/headers";

import { adminDb } from "@/core/firebase-admin";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
  type DashboardSessionClaims,
} from "@/core/security/dashboard-session";
import { loadContentEngineAccess } from "@/core/security/content-engine-access";

export interface NexusAuthorContext {
  session: DashboardSessionClaims;
  studioKey: string;
  authorId: string;
  authorEmail: string;
  userData: Record<string, unknown>;
  licenseData: Record<string, unknown>;
}

export class NexusAuthorContextError extends Error {
  constructor(readonly status: number, readonly publicMessage: string) {
    super(publicMessage);
  }
}

export async function requireNexusAuthorContext(): Promise<NexusAuthorContext> {
  if (!adminDb) {
    throw new NexusAuthorContextError(503, "The Nexus SEO Engine is temporarily unavailable.");
  }

  const sessionToken = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
  if (!sessionToken) {
    throw new NexusAuthorContextError(401, "Authentication is required.");
  }

  let session: DashboardSessionClaims;
  try {
    session = await verifyDashboardSession(sessionToken, resolveDashboardSessionSecret());
  } catch {
    throw new NexusAuthorContextError(401, "Your dashboard session is invalid or expired.");
  }

  const studioKey = clean(session.studioKey);
  if (!studioKey) {
    throw new NexusAuthorContextError(403, "A verified author workspace is required.");
  }

  const access = await loadContentEngineAccess(adminDb, session);
  if (!access.hasContentEngineAccess) {
    throw new NexusAuthorContextError(403, "An active Nexus SEO Engine plan is required.");
  }

  const authorEmail = session.email.trim().toLowerCase();
  return {
    session,
    studioKey,
    authorEmail,
    authorId: clean(access.licenseData.authorId) || authorEmail,
    userData: access.userData,
    licenseData: access.licenseData,
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
