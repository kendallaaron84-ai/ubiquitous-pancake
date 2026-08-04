import { NextResponse } from "next/server";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { getNexusFeatureFlags } from "@/core/nexus/feature-flags";
import { nexusErrorResponse } from "@/core/nexus/http";
import { NEXUS_STRATEGY_CATALOG } from "@/core/nexus/strategy-library";
import { listNexusWebsiteConnections } from "@/core/nexus/website-connections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await requireNexusAuthorContext();
    const [websites, businessProfile, worlds] = await Promise.all([
      listNexusWebsiteConnections(adminDb, context.studioKey, context.authorId),
      adminDb.collection("users").doc(context.authorEmail).collection("profile").doc("brand_voice").get(),
      adminDb.collection("nexus_story_worlds").where("studioKey", "==", context.studioKey).where("authorId", "==", context.authorId).get(),
    ]);
    const storyWorlds = await Promise.all(worlds.docs.map(async (world: QueryDocumentSnapshot) => {
      const guides = await world.ref.collection("reference_guides").where("status", "==", "ready").get();
      return { id: world.id, ...publicData(world.data()), referenceGuides: guides.docs.map((guide: QueryDocumentSnapshot) => ({ id: guide.id, ...publicGuide(guide.data()) })) };
    }));
    return NextResponse.json({ success: true, flags: getNexusFeatureFlags(), websites, businessProfile: businessProfile.exists ? publicData(businessProfile.data() || {}) : null, storyWorlds, strategies: NEXUS_STRATEGY_CATALOG.map((strategy) => ({ ...strategy })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return nexusErrorResponse(error);
  }
}

function publicGuide(value: Record<string, unknown>) {
  const { sourceStoragePath: _source, extractedTextStoragePath: _text, ...safe } = value;
  return publicData(safe);
}

function publicData(value: Record<string, unknown>): Record<string, unknown> {
  const { secretCredentialRef: _secret, wordpressUsername: _username, wpUsername: _legacyUser, ...safe } = value;
  return safe;
}
