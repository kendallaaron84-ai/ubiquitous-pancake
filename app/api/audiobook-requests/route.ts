import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import {
  DashboardRequestAuthError,
  requireDashboardRequestSession,
} from "@/core/security/dashboard-request-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireDashboardRequestSession(request);
    if (!adminDb) return failure(503, "AUDIOBOOK_REQUEST_UNAVAILABLE", "Narration requests are temporarily unavailable.");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Object.keys(body).some((key) => !["title", "authorName"].includes(key))) {
      return failure(400, "AUDIOBOOK_REQUEST_INVALID", "The narration request is invalid.");
    }
    const title = clean(body.title, 240);
    const authorName = clean(body.authorName, 160);
    if (!title) return failure(400, "AUDIOBOOK_TITLE_REQUIRED", "A manuscript title is required.");

    const reference = await adminDb.collection("audiobook_requests").add({
      title,
      authorName: authorName || null,
      authorEmail: session.email.trim().toLowerCase(),
      authorUid: session.uid,
      studioKey: session.studioKey,
      currentStage: 1,
      queuePosition: 2,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json(
      { success: true, requestId: reference.id },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof DashboardRequestAuthError) {
      return failure(error.status, error.code, error.publicMessage);
    }
    console.error("Audiobook request creation failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return failure(500, "AUDIOBOOK_REQUEST_FAILED", "The narration request could not be submitted.");
  }
}

function clean(value: unknown, maximum: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function failure(status: number, code: string, error: string) {
  return NextResponse.json(
    { success: false, code, error },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}
