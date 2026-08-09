import { cookies } from "next/headers";
import { getFirebaseAdminServices } from "@/core/firebase-admin";
import { listAuthorOnboardingQueue } from "@/core/security/author-onboarding-queue";
import { DASHBOARD_SESSION_COOKIE, resolveDashboardSessionSecret, verifyDashboardSession } from "@/core/security/dashboard-session";
import { createAuthorQueueHandlers } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createAuthorQueueHandlers({
  readSessionToken: async () => (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value || null,
  verifySession: (token) => verifyDashboardSession(token, resolveDashboardSessionSecret()),
  ownerEmails: (process.env.KOBA_OWNER_EMAILS || "").split(",").map((value) => value.trim()).filter(Boolean),
  loadQueue: () => listAuthorOnboardingQueue(getFirebaseAdminServices().db),
});

export const GET = handlers.GET;
