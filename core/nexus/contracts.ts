export const NEXUS_SCHEMA_VERSION = 1 as const;
export const NEXUS_MAX_ACTIVE_WEBSITES = 2 as const;

export type NexusContentSource = "business_brand" | "story_world";
export type NexusGoal =
  | "educate"
  | "build_authority"
  | "create_intrigue"
  | "challenge_assumptions"
  | "build_audience_trust"
  | "persuade"
  | "drive_action"
  | "deepen_character"
  | "explore_theme"
  | "reveal_story_world"
  | "journal_style_entry"
  | "answer_reader_question"
  | "build_anticipation";
export type NexusRequestedGoal = NexusGoal | "automatic";
export type NexusStrategySelectionMode = "automatic" | "manual";
export type NexusWebsiteContentRole = NexusContentSource | "both";

export interface NexusSeoKeywords {
  primary: string;
  secondary: string;
  longTail: string;
}

export interface NexusGenerationRequest {
  schemaVersion: 1;
  blueprintId: string;
  generationAttemptId: string;
  studioKey: string;
  authorId: string;
  authorEmail: string;
  requestedByUid: string;
  websiteConnectionId: string;
  targetWpOrigin: string;
  secretCredentialRef: string;
  contentSource: NexusContentSource;
  universeId: string | null;
  referenceGuideId: string | null;
  topicTitle: string;
  targetAudience: string;
  seoKeywords: NexusSeoKeywords;
  requestedGoal: NexusRequestedGoal;
  strategyGuideSelectionMode: NexusStrategySelectionMode;
  primaryStrategyGuideId: string | null;
  supportingStrategyGuideId: string | null;
  customDirectives: string;
  requestedAt: unknown;
}

export interface NexusWebsiteConnection {
  schemaVersion: 1;
  websiteConnectionId: string;
  studioKey: string;
  authorId: string;
  displayName: string;
  wordpressOrigin: string;
  wordpressUsername: string;
  secretCredentialRef: string;
  contentRole: NexusWebsiteContentRole;
  defaultUniverseId: string | null;
  status: "active" | "disabled" | "verification_failed";
  verifiedAt: unknown | null;
  lastValidatedAt: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface NexusBusinessProfile {
  schemaVersion: 1;
  authorId: string;
  studioKey: string;
  businessName: string;
  brandSummary: string;
  coreValues: string;
  brandValues: string;
  toneOfVoice: string;
  targetAudience: string;
  approvedTerminology: string[];
  prohibitedClaims: string[];
  defaultWebsiteConnectionId: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface NexusStoryWorld {
  schemaVersion: 1;
  universeId: string;
  studioKey: string;
  authorId: string;
  title: string;
  genre: string;
  description: string;
  defaultReferenceGuideId: string | null;
  defaultWebsiteConnectionId: string | null;
  status: "active" | "archived";
  createdAt: unknown;
  updatedAt: unknown;
}

export type NexusReferenceGuideStatus =
  | "uploaded"
  | "extracting"
  | "indexing"
  | "ready"
  | "failed"
  | "archived";

export interface NexusReferenceGuide {
  schemaVersion: 1;
  referenceGuideId: string;
  universeId: string;
  studioKey: string;
  authorId: string;
  displayName: string;
  sourceStoragePath: string;
  extractedTextStoragePath: string | null;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  extractedCharacterCount: number;
  estimatedTokenCount: number;
  chunkCount: number;
  version: number;
  status: NexusReferenceGuideStatus;
  spoilerPolicy: {
    defaultLevel: "public_safe" | "limited_spoilers" | "author_directed";
    thingsSafeToDiscuss: string;
    thingsNeverToReveal: string;
  };
  createdAt: unknown;
  updatedAt: unknown;
  readyAt: unknown | null;
  errorMessage: string | null;
}

export interface NexusKnowledgeChunk {
  schemaVersion: 1;
  chunkId: string;
  referenceGuideId: string;
  referenceGuideVersion: number;
  universeId: string;
  studioKey: string;
  authorId: string;
  chunkIndex: number;
  text: string;
  sectionTitle: string | null;
  sourcePage: number | null;
  spoilerLevel: "public_safe" | "limited_spoilers" | "restricted";
  embeddingModel: string;
  embeddingVersion: number;
  createdAt: unknown;
}

export interface NexusKnowledgeQuery {
  studioKey: string;
  authorId: string;
  contentSource: NexusContentSource;
  universeId: string | null;
  referenceGuideId: string | null;
  topic: string;
  targetAudience: string;
  seoKeywords: NexusSeoKeywords;
  goal: NexusGoal;
  maxChunks: number;
}

export interface NexusKnowledgeResult {
  sourceType: "business_profile" | "reference_guide";
  sourceIds: string[];
  chunks: Array<{
    chunkId: string;
    text: string;
    sectionTitle: string | null;
    sourcePage: number | null;
    spoilerLevel: string;
    relevanceScore: number;
  }>;
  guardrails: { safeToDiscuss: string; neverReveal: string };
  retrievalVersion: number;
}

export type NexusStrategyFocus =
  | "persuasion"
  | "brand_positioning"
  | "audience_building"
  | "intrigue"
  | "conversion_copy"
  | "trust_authority";

export interface NexusStrategyGuide {
  schemaVersion: 1;
  strategyGuideId: string;
  displayName: string;
  focus: NexusStrategyFocus;
  description: string;
  supportedGoals: NexusGoal[];
  sourceStoragePath: string;
  extractedTextStoragePath: string | null;
  status: "active" | "disabled";
  version: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface NexusStrategySelection {
  selectionMode: NexusStrategySelectionMode;
  primaryStrategyGuideId: string;
  supportingStrategyGuideId: string | null;
  selectionReason: string;
  selectorVersion: number;
}

export interface NexusBlueprintAdditions {
  schemaVersion: 1;
  websiteConnectionId: string;
  contentSource: NexusContentSource;
  universeId: string | null;
  referenceGuideId: string | null;
  referenceGuideVersion: number | null;
  requestedGoal: NexusRequestedGoal;
  resolvedGoal: NexusGoal;
  strategySelectionMode: NexusStrategySelectionMode;
  primaryStrategyGuideId: string;
  supportingStrategyGuideId: string | null;
  strategySelectionReason: string;
  knowledgeChunkIds: string[];
  knowledgeRetrievalVersion: number;
  groundingStatus: "pending" | "grounded" | "failed";
  groundingWarnings: string[];
  canonValidationStatus: "not_applicable" | "passed" | "warning" | "failed";
  spoilerValidationStatus: "not_applicable" | "passed" | "warning" | "failed";
  wordpressPostId: number | null;
  liveDraftUrl: string | null;
}

export const BUSINESS_BRAND_GOALS: readonly NexusGoal[] = [
  "educate", "build_authority", "create_intrigue", "challenge_assumptions",
  "build_audience_trust", "persuade", "drive_action", "answer_reader_question",
];

export const STORY_WORLD_GOALS: readonly NexusGoal[] = [
  "create_intrigue", "deepen_character", "explore_theme", "reveal_story_world",
  "journal_style_entry", "answer_reader_question", "build_anticipation", "educate",
];

export function isGoalAllowed(source: NexusContentSource, goal: NexusGoal): boolean {
  return (source === "business_brand" ? BUSINESS_BRAND_GOALS : STORY_WORLD_GOALS).includes(goal);
}
