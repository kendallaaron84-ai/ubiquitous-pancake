import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const context = await requireNexusAuthorContext();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new NexusRouteError(400, "A Business Profile is required.");
    const businessName = text(body.businessName, 160);
    const coreValues = text(body.coreValues, 2_000);
    const toneOfVoice = text(body.toneOfVoice, 1_000);
    const targetAudience = text(body.targetAudience, 1_000);
    const approvedWritingSamples = writingSampleList(body.approvedWritingSamples);
    const writingSamplesApproved = body.writingSamplesApproved === true;
    if (!businessName || !coreValues || !toneOfVoice || !targetAudience) throw new NexusRouteError(400, "Business name, core values, tone of voice, and target audience are required.");
    if (approvedWritingSamples.length > 0 && !writingSamplesApproved) throw new NexusRouteError(400, "Confirm that every writing sample is approved for Brand Voice use.");
    const ref = adminDb.collection("users").doc(context.authorEmail).collection("profile").doc("brand_voice");
    const existing = await ref.get();
    await ref.set({
      schemaVersion: 1,
      authorId: context.authorId,
      studioKey: context.studioKey,
      businessName,
      brandSummary: text(body.brandSummary, 3_000),
      coreValues,
      brandValues: text(body.brandValues, 2_000),
      toneOfVoice,
      targetAudience,
      approvedWritingSamples,
      writingSamplesApproved: approvedWritingSamples.length > 0 && writingSamplesApproved,
      approvedTerminology: stringList(body.approvedTerminology),
      prohibitedClaims: stringList(body.prohibitedClaims),
      defaultWebsiteConnectionId: text(body.defaultWebsiteConnectionId, 80) || null,
      createdAt: existing.exists ? existing.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return NextResponse.json({ success: true });
  } catch (error) {
    return nexusErrorResponse(error);
  }
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return values.map((item) => text(item, 160)).filter(Boolean).slice(0, 30);
}

function writingSampleList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n\s*---\s*\n/) : [];
  const samples = values
    .map((item) => text(item, 4_000))
    .filter(Boolean)
    .slice(0, 5);
  let retained = 0;
  return samples.filter((sample) => {
    if (retained + sample.length > 12_000) return false;
    retained += sample.length;
    return true;
  });
}
