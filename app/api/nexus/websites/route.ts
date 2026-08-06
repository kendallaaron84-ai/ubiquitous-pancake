import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";
import { listNexusWebsiteConnections } from "@/core/nexus/website-connections";
import { PluginSiteAuthorizationError } from "@/core/security/plugin-site-authorization";
import { persistPluginWebsiteMetadata } from "@/core/security/plugin-site-grant-persistence";

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
  const requestId = request.headers.get("x-vercel-id") ||
    request.headers.get("x-invocation-id") || `local-${randomUUID()}`;
  try {
    const context = await requireNexusAuthorContext();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new NexusRouteError(400, "Website settings are required.");
    const websiteConnectionId = text(body.websiteConnectionId, 80);
    const expectedOrigin = text(body.expectedOrigin, 500);
    const contentRole = body.contentRole === "business_brand" || body.contentRole === "story_world" || body.contentRole === "both"
      ? body.contentRole
      : undefined;
    const status = body.status === "active" || body.status === "disabled" ? body.status : undefined;
    try {
      const persisted = await persistPluginWebsiteMetadata(adminDb, {
        studioKey: context.studioKey,
        authorId: context.authorId,
        actorEmail: context.authorEmail,
        firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || "",
        websiteConnectionId,
        expectedOrigin,
        displayName: body.displayName === undefined ? undefined : text(body.displayName, 120),
        contentRole,
        defaultUniverseId: body.defaultUniverseId === undefined ? undefined : text(body.defaultUniverseId, 80) || null,
        status,
      });
      console.info("[Nexus Websites] Website metadata persisted.", {
        requestId,
        studioKey: context.studioKey,
        websiteConnectionId,
        resolvedOrigin: persisted.grant?.origin || expectedOrigin || null,
        reconciledLegacyConnection: persisted.reconciledLegacyConnection,
      });
      return NextResponse.json({
        success: true,
        requestId,
        grant: persisted.grant,
        reconciledLegacyConnection: persisted.reconciledLegacyConnection,
      });
    } catch (error) {
      if (error instanceof PluginSiteAuthorizationError) {
        throw new NexusRouteError(error.status, error.publicMessage, error.code);
      }
      throw error;
    }
  } catch (error) {
    const response = nexusErrorResponse(error);
    response.headers.set("X-KOBA-Request-ID", requestId);
    return response;
  }
}
