import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb, adminStorage, resolveFirebaseStorageBucketName } from "@/core/firebase-admin";
import { nexusErrorResponse, NexusRouteError, text } from "@/core/nexus/http";
import { requireNexusOwnerContext } from "@/core/nexus/owner-context";
import {
  NEXUS_STRATEGY_CATALOG,
  NexusStrategyCatalogValidationError,
  validateNexusStrategySourceGoals,
} from "@/core/nexus/strategy-library";

export const runtime = "nodejs";
export const maxDuration = 60;
const nodeRequire = createRequire(import.meta.url);

export async function GET() {
  try {
    await requireNexusOwnerContext();
    const snapshot = await adminDb.collection("nexus_strategy_guides").get();
    return NextResponse.json({ success: true, strategies: snapshot.docs.map((doc) => {
      const data = doc.data();
      return { strategyGuideId: doc.id, displayName: data.displayName, description: data.description, focus: data.focus, supportedGoals: data.supportedGoals || [], primaryEligible: data.primaryEligible !== false, supportingEligible: data.supportingEligible !== false, status: data.status || "inactive", activeVersion: data.activeVersion || null, latestVersion: data.latestVersion || 0, createdAt: data.createdAt || null, updatedAt: data.updatedAt || null };
    }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return nexusErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const owner = await requireNexusOwnerContext();
    if (!adminStorage) throw new NexusRouteError(503, "Strategy source storage is unavailable.");
    const form = await request.formData();
    const strategyGuideId = text(form.get("strategyGuideId"), 100);
    const catalog = NEXUS_STRATEGY_CATALOG.find((entry) => entry.id === strategyGuideId);
    const file = form.get("file");
    if (!catalog || !(file instanceof File)) throw new NexusRouteError(400, "Select a stable strategy ID and an approved source file.");
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new NexusRouteError(413, "Strategy source files must be no larger than 5 MB.");
    let goals;
    try {
      goals = validateNexusStrategySourceGoals(strategyGuideId, form.getAll("supportedGoals"));
    } catch (error) {
      if (!(error instanceof NexusStrategyCatalogValidationError)) throw error;
      const messages: Record<string, string> = {
        NEXUS_STRATEGY_SLOT_INVALID: "Select a valid Strategy Intelligence slot.",
        NEXUS_STRATEGY_GOAL_REQUIRED: "Select at least one supported goal.",
        NEXUS_STRATEGY_GOAL_UNKNOWN: "One or more submitted goals are not recognized by the Strategy Intelligence catalog.",
        NEXUS_STRATEGY_GOAL_NOT_SUPPORTED_BY_SLOT: "One or more submitted goals are not supported by the selected strategy slot.",
      };
      throw new NexusRouteError(400, messages[error.code] || "The supported-goal selection is invalid.", error.code);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const normalized = (await extractText(bytes, file.name, file.type)).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
    if (normalized.length < 100 || normalized.length > 100_000) throw new NexusRouteError(422, "The extracted strategy source must contain 100–100,000 normalized characters of approved material.");
    const ref = adminDb.collection("nexus_strategy_guides").doc(strategyGuideId);
    const current = await ref.get();
    const version = Number(current.data()?.latestVersion || 0) + 1;
    const digest = createHash("sha256").update(bytes).digest("hex");
    const basePath = `nexus/platform/strategy-sources/${strategyGuideId}/v${version}`;
    const sourcePath = `${basePath}/source/${safeFileName(file.name)}`;
    const textPath = `${basePath}/extracted.txt`;
    const bucket = adminStorage.bucket(resolveFirebaseStorageBucketName());
    await Promise.all([
      bucket.file(sourcePath).save(bytes, { resumable: false, contentType: file.type || "application/octet-stream", metadata: { cacheControl: "private, no-store" } }),
      bucket.file(textPath).save(Buffer.from(normalized), { resumable: false, contentType: "text/plain; charset=utf-8", metadata: { cacheControl: "private, no-store" } }),
    ]);
    await ref.collection("versions").doc(String(version)).set({ schemaVersion: 1, version, checksum: digest, status: "approved", sourceStoragePath: sourcePath, extractedTextStoragePath: textPath, wordCount: normalized.split(/\s+/).length, characterCount: normalized.length, createdAt: FieldValue.serverTimestamp(), createdByUid: owner.session.uid, createdByEmail: owner.authorEmail });
    await ref.set({ schemaVersion: 1, strategyGuideId, displayName: text(form.get("displayName"), 160) || catalog.displayName, description: text(form.get("description"), 400) || catalog.description, focus: catalog.focus, supportedGoals: goals, primaryEligible: form.get("primaryEligible") === "true", supportingEligible: form.get("supportingEligible") === "true", status: current.exists ? current.data()?.status || "inactive" : "inactive", activeVersion: current.data()?.activeVersion || null, latestVersion: version, updatedAt: FieldValue.serverTimestamp(), createdAt: current.exists ? current.data()?.createdAt : FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ success: true, strategyGuideId, version, status: "approved" }, { status: 201 });
  } catch (error) { return nexusErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const owner = await requireNexusOwnerContext();
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.strategyGuideId, 100);
    const action = text(body.action, 20);
    const ref = adminDb.collection("nexus_strategy_guides").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new NexusRouteError(404, "The strategy source was not found.");
    if (action === "deactivate") await ref.set({ status: "inactive", updatedAt: FieldValue.serverTimestamp(), updatedByUid: owner.session.uid }, { merge: true });
    else if (action === "activate") {
      const version = Number(body.version || snapshot.data()?.latestVersion || 0);
      const versionSnapshot = await ref.collection("versions").doc(String(version)).get();
      if (!versionSnapshot.exists || versionSnapshot.data()?.status !== "approved") throw new NexusRouteError(409, "Only an approved strategy source version can be activated.");
      await ref.set({ status: "active", activeVersion: version, updatedAt: FieldValue.serverTimestamp(), updatedByUid: owner.session.uid }, { merge: true });
    } else throw new NexusRouteError(400, "The strategy source action is invalid.");
    return NextResponse.json({ success: true });
  } catch (error) { return nexusErrorResponse(error); }
}

async function extractText(bytes: Buffer, name: string, mimeType: string): Promise<string> {
  const extension = name.toLowerCase().split(".").pop();
  if (mimeType.startsWith("text/") || ["txt", "md", "markdown"].includes(extension || "")) return bytes.toString("utf8");
  if (mimeType.includes("wordprocessingml") || extension === "docx") return (await (nodeRequire("mammoth") as { extractRawText(input: { buffer: Buffer }): Promise<{ value: string }> }).extractRawText({ buffer: bytes })).value;
  if (mimeType === "application/pdf" || extension === "pdf") return (await (nodeRequire("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>)(bytes)).text;
  throw new NexusRouteError(415, "This strategy source file type is not supported.");
}

function safeFileName(value: string) { return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || "source"; }
