import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";
import {
  listNexusWebsiteConnections,
  updateNexusWebsiteMetadata,
} from "@/core/nexus/website-connections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await requireNexusAuthorContext();
    const websites = await listNexusWebsiteConnections(
      adminDb,
      context.studioKey,
      context.authorId
    );
    return NextResponse.json(
      { success: true, websites },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return nexusErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireNexusAuthorContext();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new NexusRouteError(400, "Website settings are required.");
    const websiteConnectionId = text(body.websiteConnectionId, 80);
    const existing = await listNexusWebsiteConnections(adminDb, context.studioKey, context.authorId);
    if (!existing.some((website) => website.websiteConnectionId === websiteConnectionId)) {
      throw new NexusRouteError(404, "The selected website connection was not found.");
    }
    const contentRole = body.contentRole === "business_brand" || body.contentRole === "story_world" || body.contentRole === "both"
      ? body.contentRole
      : undefined;
    const status = body.status === "active" || body.status === "disabled" ? body.status : undefined;
    await updateNexusWebsiteMetadata(adminDb, {
      studioKey: context.studioKey,
      authorId: context.authorId,
      websiteConnectionId,
      displayName: body.displayName === undefined ? undefined : text(body.displayName, 120),
      contentRole,
      defaultUniverseId: body.defaultUniverseId === undefined ? undefined : text(body.defaultUniverseId, 80) || null,
      status,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return nexusErrorResponse(error);
  }
}
