import type {
  NexusContentSource,
  NexusGoal,
  NexusReferenceGuide,
} from "@/core/nexus/contracts";
import { assertCanonicalReferenceGuide, assertOwnedStoryWorld } from "@/core/nexus/story-world-authoring";

export interface NexusKnowledgeQuery {
  studioKey: string;
  authorId: string;
  authorEmail: string;
  contentSource: NexusContentSource;
  universeId: string | null;
  referenceGuideId: string | null;
  topic: string;
  targetAudience: string;
  seoKeywords: { primary: string; secondary: string; longTail: string };
  goal: NexusGoal;
  maxChunks: number;
}

export interface NexusKnowledgeResult {
  sourceType: "business_profile" | "reference_guide";
  sourceIds: string[];
  chunks: Array<{ chunkId: string; text: string; sectionTitle: string | null; sourcePage: number | null; spoilerLevel: string; relevanceScore: number }>;
  guardrails: { safeToDiscuss: string; neverReveal: string };
  retrievalVersion: number;
  knowledgeMode: "business_profile" | "full_reference_guide";
  referenceGuideVersion: number | null;
  referenceGuideWordCount: number | null;
  referenceGuideCharacterCount: number | null;
}

export async function retrieveNexusKnowledge(database: FirebaseFirestore.Firestore, query: NexusKnowledgeQuery): Promise<NexusKnowledgeResult> {
  if (query.contentSource === "business_brand") {
    const snapshot = await database.collection("users").doc(query.authorEmail.toLowerCase()).collection("profile").doc("brand_voice").get();
    if (!snapshot.exists) throw new Error("NEXUS_BUSINESS_PROFILE_REQUIRED");
    const data = snapshot.data() || {};
    const required = [data.businessName || data.authorName, data.coreValues, data.toneOfVoice || data.voice, data.targetAudience];
    if (required.some((value) => !clean(value))) throw new Error("NEXUS_BUSINESS_PROFILE_INCOMPLETE");
    return { sourceType: "business_profile", sourceIds: [snapshot.ref.path], chunks: [], guardrails: { safeToDiscuss: clean(data.approvedTerminology), neverReveal: clean(data.prohibitedClaims) }, retrievalVersion: 2, knowledgeMode: "business_profile", referenceGuideVersion: null, referenceGuideWordCount: null, referenceGuideCharacterCount: null };
  }

  if (!query.universeId || !query.referenceGuideId) throw new Error("NEXUS_REFERENCE_GUIDE_REQUIRED");
  const worldRef = database.collection("nexus_story_worlds").doc(query.universeId);
  const guideRef = worldRef.collection("reference_guides").doc(query.referenceGuideId);
  const [worldSnapshot, guideSnapshot] = await Promise.all([worldRef.get(), guideRef.get()]);
  const world = worldSnapshot.data() || {};
  assertOwnedStoryWorld(worldSnapshot.exists, world, query, { requireActive: true });
  if (!guideSnapshot.exists) throw new Error("NEXUS_REFERENCE_GUIDE_NOT_FOUND");
  const guide = guideSnapshot.data() as NexusReferenceGuide;
  assertCanonicalReferenceGuide(world, guideSnapshot.exists, guide as unknown as Record<string, unknown>, {
    studioKey: query.studioKey,
    authorId: query.authorId,
    universeId: query.universeId,
    referenceGuideId: query.referenceGuideId,
  });

  if (guide.publicSafeAcknowledged !== true || guide.contentPolicyVersion !== 1) throw new Error("NEXUS_REFERENCE_GUIDE_ACKNOWLEDGEMENT_REQUIRED");
  const versionSnapshot = await guideRef.collection("versions").doc(String(guide.version)).get();
  const version = versionSnapshot.data() || {};
  if (!versionSnapshot.exists || version.status !== "ready" || !version.extractedTextStoragePath) throw new Error("NEXUS_REFERENCE_GUIDE_NOT_READY");
  const chunkSnapshot = await guideRef.collection("versions").doc(String(guide.version)).collection("chunks").orderBy("chunkIndex").limit(120).get();
  const chunks = chunkSnapshot.docs
    .map((snapshot) => ({ snapshot, data: snapshot.data() }))
    .filter(({ data }) => data.studioKey === query.studioKey && data.authorId === query.authorId && data.universeId === query.universeId && data.referenceGuideId === query.referenceGuideId && data.referenceGuideVersion === guide.version && data.spoilerLevel !== "restricted")
    .map(({ snapshot, data }) => ({ chunkId: snapshot.id, text: "", sectionTitle: data.sectionTitle || null, sourcePage: data.sourcePage || null, spoilerLevel: String(data.spoilerLevel || "public_safe"), relevanceScore: 0 }));
  if (!chunks.length) throw new Error("NEXUS_INSUFFICIENT_GROUNDING");
  return { sourceType: "reference_guide", sourceIds: [guideRef.path, versionSnapshot.ref.path], chunks, guardrails: { safeToDiscuss: guide.spoilerPolicy.thingsSafeToDiscuss, neverReveal: guide.spoilerPolicy.thingsNeverToReveal }, retrievalVersion: 2, knowledgeMode: "full_reference_guide", referenceGuideVersion: guide.version, referenceGuideWordCount: Number(version.wordCount || guide.wordCount || 0), referenceGuideCharacterCount: Number(version.extractedCharacterCount || guide.extractedCharacterCount || 0) };
}

function clean(value: unknown): string {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(", ");
  return typeof value === "string" ? value.trim() : "";
}
