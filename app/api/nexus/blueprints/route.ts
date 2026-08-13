import { randomUUID } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { dispatchBlogGenerationTask } from "@/core/cloud-tasks";
import { adminDb } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { BUSINESS_BRAND_GOALS, isGoalAllowed, STORY_WORLD_GOALS, type NexusContentSource, type NexusGoal, type NexusRequestedGoal } from "@/core/nexus/contracts";
import { getNexusFeatureFlags } from "@/core/nexus/feature-flags";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";
import { retrieveNexusKnowledge } from "@/core/nexus/knowledge-service";
import { selectNexusStrategy } from "@/core/nexus/strategy-library";
import { assertCanonicalReferenceGuide, assertOwnedStoryWorld } from "@/core/nexus/story-world-authoring";
import { resolveNexusWebsiteConnection } from "@/core/nexus/website-connections";
import { resolveStrategySourceVersions } from "@/core/nexus/strategy-source-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request: Request) {
  let blueprintId = "";
  try {
    const context = await requireNexusAuthorContext();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new NexusRouteError(400, "SEO draft details are required.");
    const flags = getNexusFeatureFlags();
    const contentSource = normalizeContentSource(body.contentSource);
    if (contentSource === "story_world" && !flags.storyWorld) throw new NexusRouteError(404, "Story World generation is not enabled.");
    const topicTitle = text(body.topicTitle, 240);
    const targetAudience = text(body.targetAudience, 500);
    if (!topicTitle || !targetAudience) throw new NexusRouteError(400, "Topic and target audience are required.");
    const universeId = contentSource === "story_world" ? text(body.universeId, 80) : "";
    const referenceGuideId = contentSource === "story_world" ? text(body.referenceGuideId, 80) : "";
    if (contentSource === "story_world" && (!universeId || !referenceGuideId)) throw new NexusRouteError(400, "A Story World and ready Reference Guide are required.");
    const requestedGoal = normalizeGoal(body.requestedGoal);
    const resolvedGoal = requestedGoal === "automatic" ? (contentSource === "business_brand" ? "educate" : "create_intrigue") : requestedGoal;
    if (!isGoalAllowed(contentSource, resolvedGoal)) throw new NexusRouteError(400, "The selected goal is not available for this content source.");
    const website = await resolveNexusWebsiteConnection(adminDb, { studioKey: context.studioKey, authorId: context.authorId, websiteConnectionId: text(body.websiteConnectionId, 80) || "primary", contentSource });
    const seo = { primary: text((body.seoKeywords as Record<string, unknown> | undefined)?.primary, 160), secondary: text((body.seoKeywords as Record<string, unknown> | undefined)?.secondary, 160), longTail: text((body.seoKeywords as Record<string, unknown> | undefined)?.longTail, 200) };
    const knowledge = await retrieveNexusKnowledge(adminDb, { studioKey: context.studioKey, authorId: context.authorId, authorEmail: context.authorEmail, contentSource, universeId: universeId || null, referenceGuideId: referenceGuideId || null, topic: topicTitle, targetAudience, seoKeywords: seo, goal: resolvedGoal, maxChunks: 10 });
    const selectionMode = body.strategyGuideSelectionMode === "manual" ? "manual" : "automatic";
    const strategy = selectNexusStrategy({ goal: resolvedGoal, mode: selectionMode, primaryId: text(body.primaryStrategyGuideId, 100) || null, supportingId: text(body.supportingStrategyGuideId, 100) || null });
    const strategyVersions = await resolveStrategySourceVersions(adminDb, [strategy.primaryStrategyGuideId, strategy.supportingStrategyGuideId]);
    const primaryStrategyGuideVersion = strategyVersions[strategy.primaryStrategyGuideId] || 0;
    const supportingStrategyGuideVersion = strategy.supportingStrategyGuideId ? strategyVersions[strategy.supportingStrategyGuideId] || 0 : null;
    blueprintId = `nexus_${randomUUID().replace(/-/g, "")}`;
    const attemptId = randomUUID();
    const guideMetadata = contentSource === "story_world" ? await loadGuideMetadata(universeId, referenceGuideId, context) : null;
    const referenceGuideVersion = guideMetadata?.version ?? null;
    const ref = adminDb.collection("content_blueprints").doc(blueprintId);
    await ref.create({
      schemaVersion: 1,
      authorEmail: context.authorEmail,
      authorId: context.authorId,
      requestedByUid: context.session.uid,
      studioKey: context.studioKey,
      topicTitle,
      title: topicTitle,
      targetAudience,
      synopsis: text(body.customDirectives, 5_000),
      customDirectives: text(body.customDirectives, 5_000),
      contentSource,
      brandAllocation: contentSource,
      websiteConnectionId: website.websiteConnectionId,
      targetWpOrigin: website.wordpressOrigin,
      secretCredentialRef: website.secretCredentialRef,
      universeId: universeId || null,
      referenceGuideId: referenceGuideId || null,
      referenceGuideVersion,
      seoKeywords: seo,
      seoKeywordsList: [seo.primary, seo.secondary, seo.longTail].filter(Boolean),
      requestedGoal,
      resolvedGoal,
      strategySelectionMode: strategy.selectionMode,
      primaryStrategyGuideId: strategy.primaryStrategyGuideId,
      primaryStrategyGuideVersion,
      supportingStrategyGuideId: strategy.supportingStrategyGuideId,
      supportingStrategyGuideVersion,
      strategySelectionReason: strategy.selectionReason,
      strategySelectorVersion: strategy.selectorVersion,
      knowledgeChunkIds: knowledge.chunks.map((chunk) => chunk.chunkId),
      knowledgeSourceIds: knowledge.sourceIds,
      knowledgeRetrievalVersion: knowledge.retrievalVersion,
      knowledgeMode: knowledge.knowledgeMode,
      referenceGuideWordCount: knowledge.referenceGuideWordCount,
      referenceGuideCharacterCount: knowledge.referenceGuideCharacterCount,
      topicGroundingAssessment: null,
      fullContextValidation: null,
      groundingStatus: "pending",
      groundingWarnings: [],
      canonValidationStatus: contentSource === "story_world" ? "warning" : "not_applicable",
      spoilerValidationStatus: contentSource === "story_world" ? "warning" : "not_applicable",
      wordpressPostId: null,
      liveDraftUrl: null,
      executionState: "queued",
      generationAttemptId: attemptId,
      connectionBoundAt: FieldValue.serverTimestamp(),
      queueRequestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const allKeywords = [seo.primary, seo.secondary, seo.longTail].filter(Boolean);
    const dispatch = await dispatchBlogGenerationTask({ blueprintId, generationAttemptId: attemptId, studioKey: context.studioKey, targetWpOrigin: website.wordpressOrigin, secretCredentialRef: website.secretCredentialRef, seo: { ...seo, allKeywords, framework: "rank_math", readabilityTarget: "grade_5_6" }, schemaVersion: 1, authorId: context.authorId, authorEmail: context.authorEmail, requestedByUid: context.session.uid, websiteConnectionId: website.websiteConnectionId, contentSource, universeId: universeId || null, referenceGuideId: referenceGuideId || null, requestedGoal, strategyGuideSelectionMode: selectionMode, primaryStrategyGuideId: strategy.primaryStrategyGuideId, primaryStrategyGuideVersion, supportingStrategyGuideId: strategy.supportingStrategyGuideId, supportingStrategyGuideVersion, customDirectives: text(body.customDirectives, 5_000) });
    await ref.update({ cloudTaskName: dispatch.taskName, queuedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ success: true, status: "accepted", blueprintId }, { status: 202 });
  } catch (error) {
    if (blueprintId) await adminDb.collection("content_blueprints").doc(blueprintId).set({ executionState: "failed", errorLog: error instanceof Error ? error.message.slice(0, 500) : "Nexus dispatch failed.", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    return nexusErrorResponse(error);
  }
}

async function loadGuideMetadata(universeId: string, guideId: string, context: Awaited<ReturnType<typeof requireNexusAuthorContext>>): Promise<{ version: number }> {
  const worldRef = adminDb.collection("nexus_story_worlds").doc(universeId);
  const guideRef = worldRef.collection("reference_guides").doc(guideId);
  const [worldSnapshot, snapshot] = await Promise.all([worldRef.get(), guideRef.get()]);
  const worldData = worldSnapshot.data() || {};
  const data = snapshot.data() || {};
  assertOwnedStoryWorld(worldSnapshot.exists, worldData, context, { requireActive: true });
  assertCanonicalReferenceGuide(worldData, snapshot.exists, data, {
    studioKey: context.studioKey,
    authorId: context.authorId,
    universeId,
    referenceGuideId: guideId,
  });
  if (typeof data.version !== "number" || data.publicSafeAcknowledged !== true || data.contentPolicyVersion !== 1) throw new NexusRouteError(400, "The active Canonical Guide is not ready and acknowledged for public-facing use.");
  return { version: data.version };
}

function normalizeContentSource(value: unknown): NexusContentSource {
  if (value === "business_brand" || value === "story_world") return value;
  throw new NexusRouteError(400, "Content Source must be Business Brand or Story World.");
}

function normalizeGoal(value: unknown): NexusRequestedGoal {
  if (value === "automatic" || BUSINESS_BRAND_GOALS.includes(value as NexusGoal) || STORY_WORLD_GOALS.includes(value as NexusGoal)) return value as NexusRequestedGoal;
  throw new NexusRouteError(400, "The requested goal is invalid.");
}
