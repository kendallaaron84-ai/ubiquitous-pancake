import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb, adminStorage } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { getNexusFeatureFlags } from "@/core/nexus/feature-flags";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";
import { createTraceabilityChunks, estimateTokens, NEXUS_REFERENCE_GUIDE_LIMITS, validateReferenceGuideFile, validateReferenceGuideText } from "@/core/nexus/reference-guide";
import {
  assertGuideCanBeArchived,
  assertGuideCanBecomeActive,
  assertGuideCanBeDeleted,
  normalizeReferenceGuideStatus,
  ReferenceGuideLifecycleError,
} from "@/core/nexus/reference-guide-lifecycle";

export const runtime = "nodejs";
export const maxDuration = 60;

const nodeRequire = createRequire(import.meta.url);

export async function POST(request: Request) {
  let guideRef: FirebaseFirestore.DocumentReference | null = null;
  let uploadRequestRef: FirebaseFirestore.DocumentReference | null = null;
  let replacingExisting = false;
  try {
    const context = await requireNexusAuthorContext();
    if (!getNexusFeatureFlags().referenceGuide) throw new NexusRouteError(404, "Reference Guides are not enabled.");
    if (!adminStorage) throw new NexusRouteError(503, "Reference Guide storage is unavailable.");
    const form = await request.formData();
    const file = form.get("file");
    const universeId = text(form.get("universeId"), 80);
    const requestedGuideId = text(form.get("referenceGuideId"), 80);
    const clientRequestId = text(form.get("clientRequestId"), 120);
    if (!(file instanceof File) || !universeId) throw new NexusRouteError(400, "A Story World and Reference Guide file are required.");
    if (!clientRequestId || !/^[A-Za-z0-9_-]{8,120}$/.test(clientRequestId)) throw new NexusRouteError(400, "A valid upload request ID is required.");
    if (form.get("publicSafeAcknowledged") !== "true") throw new NexusRouteError(400, "Confirm that this Reference Guide contains only public-facing information the engine may discuss.");
    validateReferenceGuideFile(file);
    const worldRef = adminDb.collection("nexus_story_worlds").doc(universeId);
    const world = await worldRef.get();
    const worldData = world.data() || {};
    if (!world.exists || worldData.studioKey !== context.studioKey || worldData.authorId !== context.authorId || worldData.status !== "active") throw new NexusRouteError(404, "The selected Story World was not found.");

    uploadRequestRef = worldRef.collection("reference_guide_upload_requests").doc(clientRequestId);
    try {
      await uploadRequestRef.create({ status: "processing", requestedGuideId: requestedGuideId || null, requestedByUid: context.session.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    } catch {
      const existingRequest = await uploadRequestRef.get();
      const existingData = existingRequest.data() || {};
      if (existingData.status === "completed") return NextResponse.json({ success: true, referenceGuideId: existingData.referenceGuideId, version: existingData.version, deduplicated: true });
      throw new ReferenceGuideLifecycleError("REFERENCE_GUIDE_DUPLICATE_REQUEST", 409, "This Reference Guide upload is already processing. Wait for its status to update before trying again.");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    let referenceGuideId = requestedGuideId;
    let version = 1;
    let existingGuide: Record<string, unknown> | null = null;
    if (requestedGuideId) {
      const existingRef = worldRef.collection("reference_guides").doc(requestedGuideId);
      const existingSnapshot = await existingRef.get();
      const data = existingSnapshot.data() || {};
      if (!existingSnapshot.exists || data.studioKey !== context.studioKey || data.authorId !== context.authorId || data.universeId !== universeId || data.status !== "ready") throw new NexusRouteError(404, "The Reference Guide selected for replacement was not found.");
      guideRef = existingRef;
      replacingExisting = true;
      existingGuide = data;
      version = Number(data.version || 0) + 1;
      if (data.sourceSha256 === digest && data.publicSafeAcknowledged === true && data.contentPolicyVersion === 1) {
        await uploadRequestRef.set({ status: "completed", referenceGuideId: requestedGuideId, version: data.version, deduplicated: true, updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() }, { merge: true });
        return NextResponse.json({ success: true, referenceGuideId: requestedGuideId, version: data.version, deduplicated: true });
      }
    }
    const duplicate = await worldRef.collection("reference_guides").where("sourceSha256", "==", digest).limit(1).get();
    const duplicateData = duplicate.empty ? null : duplicate.docs[0].data();
    if (duplicateData && normalizeReferenceGuideStatus(duplicateData) === "processing") {
      throw new ReferenceGuideLifecycleError("REFERENCE_GUIDE_DUPLICATE_REQUEST", 409, "This Reference Guide file is already processing. Wait for its status to update before trying again.");
    }
    if (duplicateData?.publicSafeAcknowledged === true && duplicateData.contentPolicyVersion === 1) {
      if (replacingExisting) throw new NexusRouteError(409, "This file is already active as another Reference Guide in this Story World.");
      await uploadRequestRef.set({ status: "completed", referenceGuideId: duplicate.docs[0].id, version: duplicate.docs[0].data().version, deduplicated: true, updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ success: true, referenceGuideId: duplicate.docs[0].id, version: duplicate.docs[0].data().version, deduplicated: true });
    }

    referenceGuideId ||= `guide_${randomUUID().replace(/-/g, "")}`;
    const createdGuideRef = worldRef.collection("reference_guides").doc(referenceGuideId);
    guideRef = createdGuideRef;
    const spoilerPolicy = { defaultLevel: normalizeSpoilerLevel(form.get("spoilerLevel")), thingsSafeToDiscuss: text(form.get("thingsSafeToDiscuss"), 4_000), thingsNeverToReveal: text(form.get("thingsNeverToReveal"), 4_000) };
    if (replacingExisting) {
      await createdGuideRef.set({ replacementStatus: "extracting", pendingVersion: version, replacementStartedAt: FieldValue.serverTimestamp(), replacementErrorMessage: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      await createdGuideRef.create({ schemaVersion: 1, referenceGuideId, universeId, studioKey: context.studioKey, authorId: context.authorId, displayName: text(form.get("displayName"), 200) || file.name, originalFileName: file.name.slice(0, 240), mimeType: file.type, fileSizeBytes: file.size, sourceSha256: digest, version, status: "extracting", spoilerPolicy, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), readyAt: null, errorMessage: null });
    }

    let extracted: string;
    let wordCount: number;
    let characterCount: number;
    try {
      const validated = validateReferenceGuideText(await extractText(bytes, file.name, file.type));
      extracted = validated.normalizedText;
      wordCount = validated.wordCount;
      characterCount = validated.characterCount;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const messages: Record<string, [number, string]> = {
        REFERENCE_GUIDE_TEXT_EMPTY: [422, "No readable text could be extracted from this Reference Guide."],
        REFERENCE_GUIDE_TOO_SHORT: [422, `Reference Guides must contain at least ${NEXUS_REFERENCE_GUIDE_LIMITS.minimumWords.toLocaleString()} normalized words.`],
        REFERENCE_GUIDE_WORD_LIMIT_EXCEEDED: [413, `Reference Guides may contain no more than ${NEXUS_REFERENCE_GUIDE_LIMITS.maximumWords.toLocaleString()} normalized words. The file was not truncated or uploaded.`],
        REFERENCE_GUIDE_CHARACTER_LIMIT_EXCEEDED: [413, `Reference Guides may contain no more than ${NEXUS_REFERENCE_GUIDE_LIMITS.maximumCharacters.toLocaleString()} normalized characters. The file was not truncated or uploaded.`],
      };
      const mapped = messages[error.message];
      if (mapped) throw new NexusRouteError(mapped[0], mapped[1]);
      throw error;
    }
    const chunks = createTraceabilityChunks(extracted);
    if (!chunks.length || chunks.length > NEXUS_REFERENCE_GUIDE_LIMITS.maxChunksPerGuide) throw new NexusRouteError(422, "The Reference Guide could not be divided into supported knowledge chunks.");

    const basePath = `nexus/${context.studioKey}/story-worlds/${universeId}/reference-guides/${referenceGuideId}/v${version}`;
    const bucket = adminStorage.bucket();
    await Promise.all([
      bucket.file(`${basePath}/source/${safeFileName(file.name)}`).save(bytes, { resumable: false, contentType: file.type || "application/octet-stream", metadata: { cacheControl: "private, no-store" } }),
      bucket.file(`${basePath}/extracted.txt`).save(Buffer.from(extracted, "utf8"), { resumable: false, contentType: "text/plain; charset=utf-8", metadata: { cacheControl: "private, no-store" } }),
    ]);

    await createdGuideRef.set(replacingExisting ? { replacementStatus: "indexing", updatedAt: FieldValue.serverTimestamp() } : { status: "indexing", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const versionRef = createdGuideRef.collection("versions").doc(String(version));
    const acknowledgement = { contentPolicyVersion: 1, publicSafeAcknowledged: true, publicSafeAcknowledgedAt: FieldValue.serverTimestamp(), publicSafeAcknowledgedByUid: context.session.uid };
    await versionRef.set({ version, sourceSha256: digest, status: "ready", sourceStoragePath: `${basePath}/source/${safeFileName(file.name)}`, extractedTextStoragePath: `${basePath}/extracted.txt`, extractedCharacterCount: characterCount, wordCount, estimatedTokenCount: estimateTokens(extracted), chunkCount: chunks.length, ...acknowledgement, createdAt: FieldValue.serverTimestamp() });
    for (let offset = 0; offset < chunks.length; offset += 400) {
      const batch = adminDb.batch();
      chunks.slice(offset, offset + 400).forEach((chunk, index) => {
        const chunkIndex = offset + index;
        const chunkId = `chunk_${String(chunkIndex).padStart(4, "0")}`;
        batch.set(versionRef.collection("chunks").doc(chunkId), { schemaVersion: 1, chunkId, referenceGuideId, referenceGuideVersion: version, universeId, studioKey: context.studioKey, authorId: context.authorId, chunkIndex, text: chunk, sectionTitle: null, sourcePage: null, spoilerLevel: normalizeSpoilerLevel(form.get("spoilerLevel")) === "limited_spoilers" ? "limited_spoilers" : "public_safe", chunkPurpose: "traceability", chunkingModel: "traceability-v1", embeddingModel: "none", embeddingVersion: 0, createdAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
    await createdGuideRef.set({ displayName: text(form.get("displayName"), 200) || (typeof existingGuide?.displayName === "string" ? existingGuide.displayName : file.name), originalFileName: file.name.slice(0, 240), mimeType: file.type, fileSizeBytes: file.size, sourceSha256: digest, version, status: "ready", spoilerPolicy, sourceStoragePath: `${basePath}/source/${safeFileName(file.name)}`, extractedTextStoragePath: `${basePath}/extracted.txt`, extractedCharacterCount: characterCount, wordCount, estimatedTokenCount: estimateTokens(extracted), chunkCount: chunks.length, ...acknowledgement, replacementStatus: FieldValue.delete(), pendingVersion: FieldValue.delete(), replacementErrorMessage: FieldValue.delete(), readyAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await worldRef.set({ defaultReferenceGuideId: referenceGuideId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await uploadRequestRef.set({ status: "completed", referenceGuideId, version, updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ success: true, referenceGuideId, version, wordCount, characterCount, chunkCount: chunks.length, replaced: replacingExisting }, { status: replacingExisting ? 200 : 201 });
  } catch (error) {
    if (uploadRequestRef) await uploadRequestRef.set({ status: "failed", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    if (guideRef) await guideRef.set(replacingExisting ? { replacementStatus: "failed", pendingVersion: FieldValue.delete(), replacementErrorMessage: error instanceof Error ? error.message.slice(0, 500) : "Reference Guide replacement failed.", updatedAt: FieldValue.serverTimestamp() } : { status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Reference Guide ingestion failed.", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    return lifecycleErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireNexusAuthorContext();
    const body = await request.json() as Record<string, unknown>;
    const universeId = text(body.universeId, 80);
    const referenceGuideId = text(body.referenceGuideId, 80);
    const action = text(body.action, 40);
    const worldRef = adminDb.collection("nexus_story_worlds").doc(universeId);
    const world = await worldRef.get();
    const worldData = world.data() || {};
    if (!world.exists || worldData.studioKey !== context.studioKey || worldData.authorId !== context.authorId) throw new NexusRouteError(404, "The selected Story World was not found.");
    if (action === "clear_active") {
      await worldRef.set({ defaultReferenceGuideId: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await writeReferenceGuideAudit(worldRef, context, "active_cleared", referenceGuideId || null);
      return NextResponse.json({ success: true, activeReferenceGuideId: null });
    }
    const guideRef = worldRef.collection("reference_guides").doc(referenceGuideId);
    const guide = await guideRef.get();
    const guideData = guide.data() || {};
    if (!guide.exists || guideData.studioKey !== context.studioKey || guideData.authorId !== context.authorId) throw new NexusRouteError(404, "The selected Reference Guide was not found.");
    if (action === "set_active") {
      assertGuideCanBecomeActive(normalizeReferenceGuideStatus(guideData));
      await worldRef.set({ defaultReferenceGuideId: referenceGuideId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await writeReferenceGuideAudit(worldRef, context, "active_set", referenceGuideId);
      return NextResponse.json({ success: true, activeReferenceGuideId: referenceGuideId });
    }
    if (action === "archive") {
      assertGuideCanBeArchived({ isActive: worldData.defaultReferenceGuideId === referenceGuideId });
      await guideRef.set({ status: "archived", archivedAt: FieldValue.serverTimestamp(), archivedByUid: context.session.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await writeReferenceGuideAudit(worldRef, context, "archived", referenceGuideId);
      return NextResponse.json({ success: true, status: "archived" });
    }
    if (action === "delete_incomplete") {
      const reference = await adminDb.collection("content_blueprints").where("referenceGuideId", "==", referenceGuideId).limit(1).get();
      assertGuideCanBeDeleted({
        status: normalizeReferenceGuideStatus(guideData),
        isActive: worldData.defaultReferenceGuideId === referenceGuideId,
        historicallyReferenced: !reference.empty,
      });
      if (adminStorage) {
        const safePrefix = `nexus/${context.studioKey}/story-worlds/${universeId}/reference-guides/${referenceGuideId}/`;
        const paths = [guideData.sourceStoragePath, guideData.extractedTextStoragePath]
          .filter((value): value is string => typeof value === "string" && value.startsWith(safePrefix));
        await Promise.all(paths.map((path) => adminStorage.bucket().file(path).delete({ ignoreNotFound: true })));
      }
      await writeReferenceGuideAudit(worldRef, context, "incomplete_deleted", referenceGuideId);
      await adminDb.recursiveDelete(guideRef);
      return NextResponse.json({ success: true, status: "deleted" });
    }
    throw new NexusRouteError(400, "The Reference Guide action is invalid.");
  } catch (error) {
    return lifecycleErrorResponse(error);
  }
}

async function writeReferenceGuideAudit(
  worldRef: FirebaseFirestore.DocumentReference,
  context: Awaited<ReturnType<typeof requireNexusAuthorContext>>,
  action: "active_cleared" | "active_set" | "archived" | "incomplete_deleted",
  referenceGuideId: string | null
) {
  await worldRef.collection("reference_guide_audit_events").doc(randomUUID()).create({
    schemaVersion: 1,
    action,
    referenceGuideId,
    universeId: worldRef.id,
    studioKey: context.studioKey,
    authorId: context.authorId,
    actorUid: context.session.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function lifecycleErrorResponse(error: unknown) {
  if (error instanceof ReferenceGuideLifecycleError) return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: error.status });
  return nexusErrorResponse(error);
}

async function extractText(bytes: Buffer, name: string, mimeType: string): Promise<string> {
  const extension = name.toLowerCase().split(".").pop();
  if (mimeType.startsWith("text/") || extension === "txt" || extension === "md" || extension === "markdown") return bytes.toString("utf8");
  if (mimeType.includes("wordprocessingml") || extension === "docx") {
    const mammoth = nodeRequire("mammoth") as { extractRawText(input: { buffer: Buffer }): Promise<{ value: string }> };
    return (await mammoth.extractRawText({ buffer: bytes })).value;
  }
  if (mimeType === "application/pdf" || extension === "pdf") {
    const pdfParse = nodeRequire("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;
    return (await pdfParse(bytes)).text;
  }
  throw new NexusRouteError(415, "This Reference Guide file type is not supported.");
}

function normalizeSpoilerLevel(value: FormDataEntryValue | null): "public_safe" | "limited_spoilers" | "author_directed" { return value === "limited_spoilers" || value === "author_directed" ? value : "public_safe"; }
function safeFileName(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || "guide"; }
