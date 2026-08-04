import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { adminDb, adminStorage } from "@/core/firebase-admin";
import { requireNexusAuthorContext } from "@/core/nexus/author-context";
import { getNexusFeatureFlags } from "@/core/nexus/feature-flags";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";
import { createSemanticChunks, estimateTokens, NEXUS_REFERENCE_GUIDE_LIMITS, validateReferenceGuideFile } from "@/core/nexus/reference-guide";

export const runtime = "nodejs";
export const maxDuration = 60;

const nodeRequire = createRequire(import.meta.url);

export async function POST(request: Request) {
  let guideRef: FirebaseFirestore.DocumentReference | null = null;
  try {
    const context = await requireNexusAuthorContext();
    if (!getNexusFeatureFlags().referenceGuide) throw new NexusRouteError(404, "Reference Guides are not enabled.");
    if (!adminStorage) throw new NexusRouteError(503, "Reference Guide storage is unavailable.");
    const form = await request.formData();
    const file = form.get("file");
    const universeId = text(form.get("universeId"), 80);
    if (!(file instanceof File) || !universeId) throw new NexusRouteError(400, "A Story World and Reference Guide file are required.");
    validateReferenceGuideFile(file);
    const worldRef = adminDb.collection("nexus_story_worlds").doc(universeId);
    const world = await worldRef.get();
    const worldData = world.data() || {};
    if (!world.exists || worldData.studioKey !== context.studioKey || worldData.authorId !== context.authorId || worldData.status !== "active") throw new NexusRouteError(404, "The selected Story World was not found.");

    const bytes = Buffer.from(await file.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await worldRef.collection("reference_guides").where("sourceSha256", "==", digest).where("status", "==", "ready").limit(1).get();
    if (!duplicate.empty) return NextResponse.json({ success: true, referenceGuideId: duplicate.docs[0].id, deduplicated: true });

    const referenceGuideId = `guide_${randomUUID().replace(/-/g, "")}`;
    const createdGuideRef = worldRef.collection("reference_guides").doc(referenceGuideId);
    guideRef = createdGuideRef;
    await createdGuideRef.create({ schemaVersion: 1, referenceGuideId, universeId, studioKey: context.studioKey, authorId: context.authorId, displayName: text(form.get("displayName"), 200) || file.name, originalFileName: file.name.slice(0, 240), mimeType: file.type, fileSizeBytes: file.size, sourceSha256: digest, version: 1, status: "extracting", spoilerPolicy: { defaultLevel: normalizeSpoilerLevel(form.get("spoilerLevel")), thingsSafeToDiscuss: text(form.get("thingsSafeToDiscuss"), 4_000), thingsNeverToReveal: text(form.get("thingsNeverToReveal"), 4_000) }, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), readyAt: null, errorMessage: null });

    const extracted = normalizeExtractedText(await extractText(bytes, file.name, file.type));
    if (!extracted) throw new NexusRouteError(422, "No readable text could be extracted from this Reference Guide.");
    if (extracted.length > NEXUS_REFERENCE_GUIDE_LIMITS.maxExtractedCharacters || estimateTokens(extracted) > NEXUS_REFERENCE_GUIDE_LIMITS.maxEstimatedTokens) throw new NexusRouteError(413, "The extracted Reference Guide exceeds the supported content limit.");
    const chunks = createSemanticChunks(extracted);
    if (!chunks.length || chunks.length > NEXUS_REFERENCE_GUIDE_LIMITS.maxChunksPerGuide) throw new NexusRouteError(422, "The Reference Guide could not be divided into supported knowledge chunks.");

    const basePath = `nexus/${context.studioKey}/story-worlds/${universeId}/reference-guides/${referenceGuideId}/v1`;
    const bucket = adminStorage.bucket();
    await Promise.all([
      bucket.file(`${basePath}/source/${safeFileName(file.name)}`).save(bytes, { resumable: false, contentType: file.type || "application/octet-stream", metadata: { cacheControl: "private, no-store" } }),
      bucket.file(`${basePath}/extracted.txt`).save(Buffer.from(extracted, "utf8"), { resumable: false, contentType: "text/plain; charset=utf-8", metadata: { cacheControl: "private, no-store" } }),
    ]);

    await createdGuideRef.update({ status: "indexing", sourceStoragePath: `${basePath}/source/${safeFileName(file.name)}`, extractedTextStoragePath: `${basePath}/extracted.txt`, extractedCharacterCount: extracted.length, estimatedTokenCount: estimateTokens(extracted), chunkCount: chunks.length, updatedAt: FieldValue.serverTimestamp() });
    const versionRef = createdGuideRef.collection("versions").doc("1");
    await versionRef.set({ version: 1, sourceSha256: digest, status: "ready", createdAt: FieldValue.serverTimestamp() });
    for (let offset = 0; offset < chunks.length; offset += 400) {
      const batch = adminDb.batch();
      chunks.slice(offset, offset + 400).forEach((chunk, index) => {
        const chunkIndex = offset + index;
        const chunkId = `chunk_${String(chunkIndex).padStart(4, "0")}`;
        batch.set(versionRef.collection("chunks").doc(chunkId), { schemaVersion: 1, chunkId, referenceGuideId, referenceGuideVersion: 1, universeId, studioKey: context.studioKey, authorId: context.authorId, chunkIndex, text: chunk, sectionTitle: null, sourcePage: null, spoilerLevel: normalizeSpoilerLevel(form.get("spoilerLevel")) === "limited_spoilers" ? "limited_spoilers" : "public_safe", embeddingModel: "lexical-v1", embeddingVersion: 1, createdAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
    await createdGuideRef.update({ status: "ready", readyAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await worldRef.set({ defaultReferenceGuideId: referenceGuideId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ success: true, referenceGuideId, version: 1, chunkCount: chunks.length }, { status: 201 });
  } catch (error) {
    if (guideRef) await guideRef.set({ status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Reference Guide ingestion failed.", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
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

function normalizeExtractedText(value: string): string { return value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim(); }
function normalizeSpoilerLevel(value: FormDataEntryValue | null): "public_safe" | "limited_spoilers" | "author_directed" { return value === "limited_spoilers" || value === "author_directed" ? value : "public_safe"; }
function safeFileName(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || "guide"; }
