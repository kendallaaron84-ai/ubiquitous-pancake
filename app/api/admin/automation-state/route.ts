import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import { AUTOMATION_STEP_TEMPLATES } from "@/core/automation-step-templates";
import {
  DashboardRequestAuthError,
  requireDashboardRequestSession,
} from "@/core/security/dashboard-request-auth";
import {
  PlatformOwnerAuthorizationError,
  requirePlatformOwner,
  requireSameOrigin,
} from "@/core/security/platform-owner";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requirePlatformOwner(await requireDashboardRequestSession(request));
    if (!adminDb) return failure(503, "AUTOMATION_STATE_UNAVAILABLE", "Automation state is unavailable.");
    const snapshot = await adminDb.collection("steps").get();
    const steps = Object.fromEntries(snapshot.docs.map((document) => [document.id, document.data()]));
    return NextResponse.json({ success: true, steps }, { headers: noStore() });
  } catch (error) {
    return handledFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = requirePlatformOwner(await requireDashboardRequestSession(request));
    if (!adminDb) return failure(503, "AUTOMATION_STATE_UNAVAILABLE", "Automation state is unavailable.");
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
    if (body?.action === "seed_steps") {
      const batch = adminDb.batch();
      for (const step of AUTOMATION_STEP_TEMPLATES) {
        batch.set(adminDb.collection("steps").doc(step.id), {
          step_name: step.name,
          status: "idle",
          category: step.category,
          asset_key: `asset_${step.id}`,
          expected_visibility: "Active",
          expected_price: "49.99",
          expected_stripe_account: "acct_12345",
          execution_history: [],
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: session.email.toLowerCase(),
        }, { merge: true });
      }
      await batch.commit();
      return NextResponse.json({ success: true, seeded: AUTOMATION_STEP_TEMPLATES.length }, { headers: noStore() });
    }
    if (body?.action === "save_snapshot") {
      const snapshot = await adminDb.collection("steps").get();
      const current = new Map(snapshot.docs.map((document) => [document.id, document.data()]));
      const states = AUTOMATION_STEP_TEMPLATES.map((step) => {
        const live = current.get(step.id) || {};
        const history = Array.isArray(live.execution_history) ? live.execution_history : [];
        return {
          id: step.id,
          name: step.name,
          category: step.category,
          status: typeof live.status === "string" ? live.status : "idle",
          latest_log: history.length ? history[history.length - 1] : null,
        };
      });
      const successCount = states.filter((step) => step.status === "success").length;
      const failedCount = states.filter((step) => step.status === "failed").length;
      const reference = await adminDb.collection("saved_test_runs").add({
        timestamp: FieldValue.serverTimestamp(),
        totalSteps: AUTOMATION_STEP_TEMPLATES.length,
        successCount,
        failedCount,
        states,
        complianceVerified: failedCount === 0 && successCount > 0,
        auditedBy: session.email.toLowerCase(),
      });
      return NextResponse.json({ success: true, runId: reference.id, successCount, failedCount }, { status: 201, headers: noStore() });
    }
    return failure(400, "AUTOMATION_ACTION_INVALID", "Choose a supported automation action.");
  } catch (error) {
    return handledFailure(error);
  }
}

function handledFailure(error: unknown) {
  if (error instanceof DashboardRequestAuthError || error instanceof PlatformOwnerAuthorizationError) {
    return failure(error.status, error.code, error.publicMessage);
  }
  console.error("Automation state request failed.", { name: error instanceof Error ? error.name : "UnknownError" });
  return failure(500, "AUTOMATION_STATE_FAILED", "The automation state request failed.");
}

function noStore() {
  return { "Cache-Control": "private, no-store" };
}

function failure(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status, headers: noStore() });
}
