import { adminDb } from "@/core/firebase-admin";
import { requireDashboardRequestSession } from "@/core/security/dashboard-request-auth";
import { loadContentEngineAccess } from "@/core/security/content-engine-access";
import { createSessionStatusHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createSessionStatusHandler({
  authenticate: requireDashboardRequestSession,
  loadAccess: (session) => loadContentEngineAccess(adminDb, session),
  async loadConnection(studioKey) {
    const snapshot = await adminDb.collection("connections").doc(studioKey).get();
    return { exists: snapshot.exists, data: snapshot.data() || {} };
  },
  ownerEmails: (process.env.KOBA_OWNER_EMAILS || "").split(",").filter(Boolean),
});
