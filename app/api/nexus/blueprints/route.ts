import { createHash, randomUUID } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import {
  assertBlogGenerationTaskConfiguration,
  CloudTasksDispatchConfigurationError,
  dispatchBlogGenerationTask,
} from "@/core/cloud-tasks";
import { adminDb, adminStorage, resolveFirebaseStorageBucketName } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { BUSINESS_BRAND_GOALS, isGoalAllowed, STORY_WORLD_GOALS, type NexusContentSource, type NexusGoal, type NexusRequestedGoal } from "@/core/nexus/contracts";
import { getNexusFeatureFlags } from "@/core/nexus/feature-flags";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";
import { retrieveNexusKnowledge } from "@/core/nexus/knowledge-service";
import { selectNexusStrategy } from "@/core/nexus/strategy-library";
import { assertCanonicalReferenceGuide, assertOwnedStoryWorld } from "@/core/nexus/story-world-authoring";
import { resolveNexusWebsiteConnection } from "@/core/nexus/website-connections";
import { resolveStrategySourceVersions } from "@/core/nexus/strategy-source-service";
import { extractNexusSourceText, safeNexusSourceFileName } from "@/core/nexus/source-file";
import { NEXUS_STORY_BRIEF_LIMITS, validateStoryBriefFile, validateStoryBriefText } from "@/core/nexus/story-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request: Request) {
  let blueprintId = "";
  let blueprintPersisted = false;
  let uncommittedStoryBriefPaths: string[] = [];
  try {
    const context = await requireNexusAuthorContext();
    const requestInput = await parseBlueprintRequest(request);
    const body = requestInput.body;
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
    // Reject an unusable task destination before creating a durable blueprint.
    assertBlogGenerationTaskConfiguration();
    blueprintId = `nexus_${randomUUID().replace(/-/g, "")}`;
    const attemptId = randomUUID();
    const guideMetadata = contentSource === "story_world" ? await loadGuideMetadata(universeId, referenceGuideId, context) : null;
    const referenceGuideVersion = guideMetadata?.version ?? null;
    const storyBrief = contentSource === "story_world"
      ? await prepareStoryBrief({
          context,
          universeId,
          blueprintId,
          normalizedText: requestInput.storyBriefText,
          file: requestInput.storyBriefFile,
          publicSafeAcknowledged: body.storyBriefPublicSafeAcknowledged === true,
        })
      : null;
    uncommittedStoryBriefPaths = storyBrief?.storagePaths || [];
    const blueprintSchemaVersion: 1 | 2 = contentSource === "story_world" ? 2 : 1;
    const ref = adminDb.collection("content_blueprints").doc(blueprintId);
    const blueprintData = {
      schemaVersion: blueprintSchemaVersion,
      blueprintId,
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
      storyAuthorityMode: storyBrief ? "canonical_plus_story_brief" : "canonical_only",
      storyBriefId: storyBrief?.storyBriefId || null,
      storyBriefVersion: storyBrief?.version || null,
      storyBriefSha256: storyBrief?.sourceSha256 || null,
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
    };
    if (storyBrief) {
      const batch = adminDb.batch();
      batch.create(storyBrief.headerRef, storyBrief.headerData);
      batch.create(storyBrief.versionRef, storyBrief.versionData);
      batch.create(ref, blueprintData);
      await batch.commit();
    } else {
      await ref.create(blueprintData);
    }
    blueprintPersisted = true;
    uncommittedStoryBriefPaths = [];
    const allKeywords = [seo.primary, seo.secondary, seo.longTail].filter(Boolean);
    const dispatch = await dispatchBlogGenerationTask({ blueprintId, generationAttemptId: attemptId, studioKey: context.studioKey, targetWpOrigin: website.wordpressOrigin, secretCredentialRef: website.secretCredentialRef, seo: { ...seo, allKeywords, framework: "rank_math", readabilityTarget: "grade_5_6" }, schemaVersion: blueprintSchemaVersion, authorId: context.authorId, authorEmail: context.authorEmail, requestedByUid: context.session.uid, websiteConnectionId: website.websiteConnectionId, contentSource, universeId: universeId || null, referenceGuideId: referenceGuideId || null, referenceGuideVersion, storyAuthorityMode: storyBrief ? "canonical_plus_story_brief" : "canonical_only", storyBriefId: storyBrief?.storyBriefId || null, storyBriefVersion: storyBrief?.version || null, storyBriefSha256: storyBrief?.sourceSha256 || null, requestedGoal, strategyGuideSelectionMode: selectionMode, primaryStrategyGuideId: strategy.primaryStrategyGuideId, primaryStrategyGuideVersion, supportingStrategyGuideId: strategy.supportingStrategyGuideId, supportingStrategyGuideVersion, customDirectives: text(body.customDirectives, 5_000) });
    await ref.update({ cloudTaskName: dispatch.taskName, queuedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ success: true, status: "accepted", blueprintId }, { status: 202 });
  } catch (error) {
    if (uncommittedStoryBriefPaths.length && adminStorage) {
      const bucket = adminStorage.bucket(resolveFirebaseStorageBucketName());
      await Promise.all(uncommittedStoryBriefPaths.map((path) => bucket.file(path).delete({ ignoreNotFound: true }).catch(() => undefined)));
    }
    if (blueprintId && blueprintPersisted) await adminDb.collection("content_blueprints").doc(blueprintId).set({ executionState: "failed", errorLog: error instanceof Error ? error.message.slice(0, 500) : "Nexus dispatch failed.", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    if (error instanceof CloudTasksDispatchConfigurationError) {
      return nexusErrorResponse(
        new NexusRouteError(
          error.status,
          "The Content Engine queue is temporarily unavailable.",
          error.code,
          error.message
        )
      );
    }
    return nexusErrorResponse(error);
  }
}

type BlueprintRequestInput = {
  body: Record<string, unknown> | null;
  storyBriefText: string;
  storyBriefFile: File | null;
};

async function parseBlueprintRequest(request: Request): Promise<BlueprintRequestInput> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    return { body, storyBriefText: typeof body?.storyBriefText === "string" ? body.storyBriefText : "", storyBriefFile: null };
  }
  const form = await request.formData();
  const payload = form.get("payload");
  let body: Record<string, unknown> | null = null;
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      throw new NexusRouteError(400, "SEO draft details are invalid.");
    }
  }
  const file = form.get("storyBriefFile");
  return {
    body,
    storyBriefText: typeof form.get("storyBriefText") === "string" ? String(form.get("storyBriefText")) : "",
    storyBriefFile: file instanceof File && file.size > 0 ? file : null,
  };
}

async function prepareStoryBrief(input: {
  context: Awaited<ReturnType<typeof requireNexusAuthorContext>>;
  universeId: string;
  blueprintId: string;
  normalizedText: string;
  file: File | null;
  publicSafeAcknowledged: boolean;
}) {
  if (!input.normalizedText.trim() && !input.file) return null;
  if (input.normalizedText.trim() && input.file) throw new NexusRouteError(400, "Use either Story Brief text or one Story Brief file, not both.");
  if (!input.publicSafeAcknowledged) throw new NexusRouteError(400, "Confirm that the Story Brief contains facts approved for this public-facing story.");
  if (!adminStorage) throw new NexusRouteError(503, "Story Brief storage is unavailable.");

  let sourceBytes: Buffer | null = null;
  let sourceFileName: string | null = null;
  let extracted = input.normalizedText;
  if (input.file) {
    try {
      validateStoryBriefFile(input.file);
      sourceBytes = Buffer.from(await input.file.arrayBuffer());
      sourceFileName = safeNexusSourceFileName(input.file.name);
      extracted = await extractNexusSourceText(sourceBytes, input.file.name, input.file.type);
    } catch (error) {
      const messages: Record<string, [number, string]> = {
        STORY_BRIEF_EMPTY: [400, "The selected Story Brief file is empty."],
        STORY_BRIEF_TOO_LARGE: [413, `Story Brief files may be no larger than ${NEXUS_STORY_BRIEF_LIMITS.maxFileSizeBytes / 1024 / 1024} MB.`],
        STORY_BRIEF_TYPE_UNSUPPORTED: [415, "Upload a PDF, DOCX, TXT, or Markdown Story Brief."],
        NEXUS_SOURCE_FILE_TYPE_UNSUPPORTED: [415, "Upload a PDF, DOCX, TXT, or Markdown Story Brief."],
      };
      const mapped = error instanceof Error ? messages[error.message] : undefined;
      if (mapped) throw new NexusRouteError(mapped[0], mapped[1]);
      throw error;
    }
  }

  let validated: ReturnType<typeof validateStoryBriefText>;
  try {
    validated = validateStoryBriefText(extracted);
  } catch (error) {
    const messages: Record<string, [number, string]> = {
      STORY_BRIEF_TEXT_EMPTY: [422, "The Story Brief does not contain readable text."],
      STORY_BRIEF_WORD_LIMIT_EXCEEDED: [413, `Story Briefs may contain no more than ${NEXUS_STORY_BRIEF_LIMITS.maximumWords.toLocaleString()} words. The text was not truncated.`],
      STORY_BRIEF_CHARACTER_LIMIT_EXCEEDED: [413, `Story Briefs may contain no more than ${NEXUS_STORY_BRIEF_LIMITS.maximumCharacters.toLocaleString()} characters. The text was not truncated.`],
    };
    const mapped = error instanceof Error ? messages[error.message] : undefined;
    if (mapped) throw new NexusRouteError(mapped[0], mapped[1]);
    throw error;
  }

  const sourceSha256 = createHash("sha256").update(validated.normalizedText, "utf8").digest("hex");
  const storyBriefId = `brief_${randomUUID().replace(/-/g, "")}`;
  const version = 1;
  const basePath = `nexus/${input.context.studioKey}/story-worlds/${input.universeId}/story-briefs/${storyBriefId}/v${version}`;
  const extractedTextStoragePath = `${basePath}/extracted.txt`;
  const sourceStoragePath = sourceBytes && sourceFileName ? `${basePath}/source/${sourceFileName}` : null;
  const bucket = adminStorage.bucket(resolveFirebaseStorageBucketName());
  const saves = [bucket.file(extractedTextStoragePath).save(Buffer.from(validated.normalizedText, "utf8"), { resumable: false, contentType: "text/plain; charset=utf-8", metadata: { cacheControl: "private, no-store" } })];
  if (sourceBytes && sourceStoragePath) saves.push(bucket.file(sourceStoragePath).save(sourceBytes, { resumable: false, contentType: input.file?.type || "application/octet-stream", metadata: { cacheControl: "private, no-store" } }));
  try {
    await Promise.all(saves);
  } catch {
    throw new NexusRouteError(503, "Story Brief storage is temporarily unavailable. No draft was queued.");
  }

  const worldRef = adminDb.collection("nexus_story_worlds").doc(input.universeId);
  const headerRef = worldRef.collection("story_briefs").doc(storyBriefId);
  const versionRef = headerRef.collection("versions").doc(String(version));
  return {
    storyBriefId,
    version,
    sourceSha256,
    storagePaths: [extractedTextStoragePath, ...(sourceStoragePath ? [sourceStoragePath] : [])],
    headerRef,
    versionRef,
    headerData: {
      schemaVersion: 1, storyBriefId, universeId: input.universeId, studioKey: input.context.studioKey,
      authorId: input.context.authorId, boundBlueprintId: input.blueprintId, activeVersion: version,
      sourceSha256, status: "ready", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    },
    versionData: {
      schemaVersion: 1, version, sourceSha256, status: "ready", sourceStoragePath,
      extractedTextStoragePath, wordCount: validated.wordCount, characterCount: validated.characterCount,
      publicSafeAcknowledged: true, createdByUid: input.context.session.uid, createdAt: FieldValue.serverTimestamp(),
    },
  };
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
