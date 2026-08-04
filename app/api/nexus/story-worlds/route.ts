import { randomUUID } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { getNexusFeatureFlags } from "@/core/nexus/feature-flags";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireNexusAuthorContext();
    if (!getNexusFeatureFlags().storyWorld) throw new NexusRouteError(404, "Story Worlds are not enabled.");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const title = text(body?.title, 200);
    const genre = text(body?.genre, 120);
    const description = text(body?.description, 3_000);
    if (!title || !genre || !description) throw new NexusRouteError(400, "Title, genre, and description are required.");
    const universeId = `world_${randomUUID().replace(/-/g, "")}`;
    await adminDb.collection("nexus_story_worlds").doc(universeId).create({ schemaVersion: 1, universeId, studioKey: context.studioKey, authorId: context.authorId, title, genre, description, defaultReferenceGuideId: null, defaultWebsiteConnectionId: text(body?.defaultWebsiteConnectionId, 80) || null, status: "active", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ success: true, universeId }, { status: 201 });
  } catch (error) {
    return nexusErrorResponse(error);
  }
}
