import type {
  NexusContentSource,
  NexusGoal,
  NexusKnowledgeChunk,
  NexusReferenceGuide,
} from "@/core/nexus/contracts";

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
}

export async function retrieveNexusKnowledge(database: FirebaseFirestore.Firestore, query: NexusKnowledgeQuery): Promise<NexusKnowledgeResult> {
  if (query.contentSource === "business_brand") {
    const snapshot = await database.collection("users").doc(query.authorEmail.toLowerCase()).collection("profile").doc("brand_voice").get();
    if (!snapshot.exists) throw new Error("NEXUS_BUSINESS_PROFILE_REQUIRED");
    const data = snapshot.data() || {};
    const required = [data.businessName || data.authorName, data.coreValues, data.toneOfVoice || data.voice, data.targetAudience];
    if (required.some((value) => !clean(value))) throw new Error("NEXUS_BUSINESS_PROFILE_INCOMPLETE");
    return { sourceType: "business_profile", sourceIds: [snapshot.ref.path], chunks: [], guardrails: { safeToDiscuss: clean(data.approvedTerminology), neverReveal: clean(data.prohibitedClaims) }, retrievalVersion: 1 };
  }

  if (!query.universeId || !query.referenceGuideId) throw new Error("NEXUS_REFERENCE_GUIDE_REQUIRED");
  const guideRef = database.collection("nexus_story_worlds").doc(query.universeId).collection("reference_guides").doc(query.referenceGuideId);
  const guideSnapshot = await guideRef.get();
  if (!guideSnapshot.exists) throw new Error("NEXUS_REFERENCE_GUIDE_NOT_FOUND");
  const guide = guideSnapshot.data() as NexusReferenceGuide;
  if (guide.studioKey !== query.studioKey || guide.authorId !== query.authorId || guide.universeId !== query.universeId || guide.status !== "ready") throw new Error("NEXUS_REFERENCE_GUIDE_NOT_READY");

  const chunkSnapshot = await guideRef.collection("chunks").where("referenceGuideVersion", "==", guide.version).limit(120).get();
  const terms = tokenize([query.topic, query.targetAudience, query.seoKeywords.primary, query.seoKeywords.secondary, query.seoKeywords.longTail, query.goal].join(" "));
  const limit = Math.max(1, Math.min(query.maxChunks, 10));
  const chunks = chunkSnapshot.docs
    .map((snapshot) => ({ snapshot, data: snapshot.data() as NexusKnowledgeChunk }))
    .filter(({ data }) => data.studioKey === query.studioKey && data.authorId === query.authorId && data.universeId === query.universeId && data.referenceGuideId === query.referenceGuideId && data.referenceGuideVersion === guide.version && data.spoilerLevel !== "restricted")
    .map(({ snapshot, data }) => ({ chunkId: snapshot.id, text: data.text, sectionTitle: data.sectionTitle, sourcePage: data.sourcePage, spoilerLevel: data.spoilerLevel, relevanceScore: lexicalScore(data.text, terms) }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, limit);
  if (!chunks.length) throw new Error("NEXUS_INSUFFICIENT_GROUNDING");
  return { sourceType: "reference_guide", sourceIds: [guideRef.path], chunks, guardrails: { safeToDiscuss: guide.spoilerPolicy.thingsSafeToDiscuss, neverReveal: guide.spoilerPolicy.thingsNeverToReveal }, retrievalVersion: 1 };
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
}

function lexicalScore(text: string, terms: Set<string>): number {
  if (!terms.size) return 0;
  const haystack = text.toLowerCase();
  let matches = 0;
  for (const term of terms) if (haystack.includes(term)) matches += 1;
  return Number((matches / terms.size).toFixed(4));
}

function clean(value: unknown): string {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(", ");
  return typeof value === "string" ? value.trim() : "";
}
