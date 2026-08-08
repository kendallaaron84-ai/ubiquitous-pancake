import { createHash } from "node:crypto";

import { cookies } from "next/headers";
import { provisionAuthorPlugin } from "@/core/security/author-provisioning";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import { createProvisionAuthorHandlers } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const handlers = createProvisionAuthorHandlers({
  readSessionToken: async () => (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value || null,
  verifySession: (token) => verifyDashboardSession(token, resolveDashboardSessionSecret()),
  ownerEmails: splitCsv(process.env.KOBA_OWNER_EMAILS),
  allowedOrigins: splitCsv(process.env.KOBA_ALLOWED_ORIGINS),
  provisionAuthor: provisionAuthorPlugin,
  createIdempotencyKey: (authorEmail) => createHash("sha256")
    .update(`manual-owner:${authorEmail}`)
    .digest("hex"),
});

export const POST = handlers.POST;

function splitCsv(value: string | undefined): string[] {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
