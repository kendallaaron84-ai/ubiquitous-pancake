import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb, adminStorage } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { getNexusFeatureFlags } from "@/core/nexus/feature-flags";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";
import { createTraceabilityChunks, estimateTokens, NEXUS_REFERENCE_GUIDE_LIMITS, validateReferenceGuideFile, validateReferenceGuideText } from "@/core/nexus/reference-guide";

export const runtime = "nodejs";
export const maxDuration = 60;

const nodeRequire = createRequire(import.meta.url);

export async function POST(request: Request) {
  let guideRef: FirebaseFirestore.DocumentReference | null = null;
  let replacingExisting = false;
  try {
    const context = await requireNexusAuthorContext();
    if (!getNexusFeatureFlags().referenceGuide) throw new NexusRouteError(404, "Reference Guides are not enabled.");
    if (!adminStorage) throw new NexusRouteError(503, "Reference Guide storage is unavailable.");
    const form = await request.formData();
    const file = form.get("file");
    const universeId = text(form.get("universeId"), 80);
    const requestedGuideId = text(form.get("referenceGuideId"), 80);
    if (!(file instanceof File) || !universeId) throw new NexusRouteError(400, "A Story World and Reference Guide file are required.");
    if (form.get("publicSafeAcknowledged") !== "true") throw new NexusRouteError(400, "Confirm that this Reference Guide contains only public-facing information the engine may discuss.");
    validateReferenceGuideFile(file);
    const worldRef = adminDb.collection("nexus_story_worlds").doc(universeId);
    const world = await worldRef.get();
    const worldData = world.data() || {};
    if (!world.exists || worldData.studioKey !== context.studioKey || worldData.authorId !== context.authorId || worldData.status !== "active") throw new NexusRouteError(404, "The selected Story World was not found.");

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
      if (data.sourceSha256 === digest && data.publicSafeAcknowledged === true && data.contentPolicyVersion === 1) return NextResponse.json({ success: true, referenceGuideId: requestedGuideId, version: data.version, deduplicated: true });
    }
    const duplicate = await worldRef.collection("reference_guides").where("sourceSha256", "==", digest).where("status", "==", "ready").limit(1).get();
    const duplicateData = duplicate.empty ? null : duplicate.docs[0].data();
    if (duplicateData?.publicSafeAcknowledged === true && duplicateData.contentPolicyVersion === 1) {
      if (replacingExisting) throw new NexusRouteError(409, "This file is already active as another Reference Guide in this Story World.");
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
    return NextResponse.json({ success: true, referenceGuideId, version, wordCount, characterCount, chunkCount: chunks.length, replaced: replacingExisting }, { status: replacingExisting ? 200 : 201 });
  } catch (error) {
    if (guideRef) await guideRef.set(replacingExisting ? { replacementStatus: "failed", pendingVersion: FieldValue.delete(), replacementErrorMessage: error instanceof Error ? error.message.slice(0, 500) : "Reference Guide replacement failed.", updatedAt: FieldValue.serverTimestamp() } : { status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Reference Guide ingestion failed.", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    return nexusErrorResponse(error);
  }
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
