import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BUSINESS_BRAND_GOALS,
  NEXUS_MAX_ACTIVE_WEBSITES,
  STORY_WORLD_GOALS,
  isGoalAllowed,
} from "../contracts.ts";
import { getNexusFeatureFlags } from "../feature-flags.ts";
import {
  NEXUS_REFERENCE_GUIDE_LIMITS,
  createTraceabilityChunks,
  estimateTokens,
  validateReferenceGuideText,
  validateReferenceGuideFile,
} from "../reference-guide.ts";
import {
  NEXUS_STORY_BRIEF_LIMITS,
  validateStoryBriefFile,
  validateStoryBriefText,
} from "../story-brief.ts";
import { validateFirebasePublicConfig } from "../../firebase-config.ts";
import {
  assertGuideCanBeArchived,
  assertGuideCanBeDeleted,
  assertGuideCanBecomeActive,
  normalizeReferenceGuideStatus,
} from "../reference-guide-lifecycle.ts";
import {
  NEXUS_STRATEGY_CATALOG,
  selectNexusStrategy,
  validateNexusStrategySourceGoals,
} from "../strategy-library.ts";

const ROOT = new URL("../../../", import.meta.url);

test("ADR-002 exposes only Business Brand and Story World goal contracts", () => {
  assert.equal(isGoalAllowed("business_brand", "build_authority"), true);
  assert.equal(isGoalAllowed("business_brand", "deepen_character"), false);
  assert.equal(isGoalAllowed("story_world", "deepen_character"), true);
  assert.equal(isGoalAllowed("story_world", "drive_action"), false);
  assert.equal(BUSINESS_BRAND_GOALS.includes("journal_style_entry"), false);
  assert.equal(STORY_WORLD_GOALS.includes("journal_style_entry"), true);
  assert.equal(NEXUS_MAX_ACTIVE_WEBSITES, 2);
});

test("automatic strategy selection is deterministic and records its reason", () => {
  for (const goal of new Set(NEXUS_STRATEGY_CATALOG.flatMap((guide) => guide.goals))) {
    const first = selectNexusStrategy({ goal });
    const retry = selectNexusStrategy({ goal });
    assert.deepEqual(retry, first);
    assert.equal(first.selectionMode, "automatic");
    assert.ok(first.primaryStrategyGuideId);
    assert.equal(first.supportingStrategyGuideId, null);
    assert.match(first.selectionReason, new RegExp(goal));
  }
});

test("manual strategy selection allows one primary and at most one distinct support", () => {
  const selection = selectNexusStrategy({
    goal: "persuade",
    mode: "manual",
    primaryId: "strategy_persuasion",
    supportingId: "strategy_trust_authority",
  });
  assert.equal(selection.primaryStrategyGuideId, "strategy_persuasion");
  assert.equal(selection.supportingStrategyGuideId, "strategy_trust_authority");
  assert.match(selection.selectionReason, /Author selected/);
  assert.throws(
    () => selectNexusStrategy({ goal: "persuade", mode: "manual", primaryId: "missing" }),
    /NEXUS_PRIMARY_STRATEGY_INVALID/
  );
  assert.throws(
    () => selectNexusStrategy({ goal: "persuade", mode: "manual", primaryId: "strategy_persuasion", supportingId: "strategy_persuasion" }),
    /NEXUS_STRATEGY_DUPLICATE/
  );
});

test("reference guide validation accepts approved formats and rejects unsafe inputs", () => {
  for (const [name, type] of [
    ["guide.pdf", "application/pdf"],
    ["guide.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["guide.txt", "text/plain"],
    ["guide.md", "text/markdown"],
  ]) {
    assert.doesNotThrow(() => validateReferenceGuideFile({ name, type, size: 128 }));
  }
  assert.throws(() => validateReferenceGuideFile({ name: "guide.exe", type: "application/octet-stream", size: 128 }), /REFERENCE_GUIDE_TYPE_UNSUPPORTED/);
  assert.throws(() => validateReferenceGuideFile({ name: "guide.txt", type: "text/plain", size: 0 }), /REFERENCE_GUIDE_EMPTY/);
  assert.throws(() => validateReferenceGuideFile({ name: "guide.txt", type: "text/plain", size: NEXUS_REFERENCE_GUIDE_LIMITS.maxFileSizeBytes + 1 }), /REFERENCE_GUIDE_TOO_LARGE/);
});

test("reference guide traceability chunking is bounded and token estimation is stable", () => {
  const chunks = createTraceabilityChunks("Character facts.\n\nLocation facts.\n\nTheme facts.", 30);
  assert.deepEqual(chunks, ["Character facts.", "Location facts.\n\nTheme facts."]);
  assert.ok(chunks.every((chunk) => chunk.length <= 30));
  assert.equal(estimateTokens("12345678"), 2);
});

test("full-context limits reject instead of silently truncating", () => {
  const minimum = Array.from({ length: 300 }, () => "canon").join(" ");
  assert.deepEqual(validateReferenceGuideText(minimum), {
    normalizedText: minimum,
    wordCount: 300,
    characterCount: minimum.length,
  });
  assert.throws(() => validateReferenceGuideText(Array.from({ length: 299 }, () => "canon").join(" ")), /REFERENCE_GUIDE_TOO_SHORT/);
  const maxWords = Array.from({ length: 5000 }, () => "a").join(" ");
  assert.equal(validateReferenceGuideText(maxWords).wordCount, 5000);
  assert.throws(() => validateReferenceGuideText(`${maxWords} a`), /REFERENCE_GUIDE_WORD_LIMIT_EXCEEDED/);

  const exactlyThirtyThousand = `${Array.from({ length: 299 }, () => "a").join(" ")} ${"b".repeat(29402)}`;
  assert.equal(exactlyThirtyThousand.length, 30000);
  assert.equal(validateReferenceGuideText(exactlyThirtyThousand).characterCount, 30000);
  assert.throws(() => validateReferenceGuideText(`${exactlyThirtyThousand}b`), /REFERENCE_GUIDE_CHARACTER_LIMIT_EXCEEDED/);
});

test("Story Brief validation supports short story-scoped facts without silent truncation", () => {
  const brief = "Mara interviews Leonard Crane at the North Harbor Hotel.";
  assert.deepEqual(validateStoryBriefText(brief), {
    normalizedText: brief,
    wordCount: 9,
    characterCount: brief.length,
  });
  for (const [name, type] of [
    ["brief.pdf", "application/pdf"],
    ["brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["brief.txt", "text/plain"],
    ["brief.md", "text/markdown"],
  ]) assert.doesNotThrow(() => validateStoryBriefFile({ name, type, size: 128 }));
  assert.throws(() => validateStoryBriefText(""), /STORY_BRIEF_TEXT_EMPTY/);
  assert.throws(() => validateStoryBriefText(Array.from({ length: 5001 }, () => "fact").join(" ")), /STORY_BRIEF_WORD_LIMIT_EXCEEDED/);
  assert.throws(() => validateStoryBriefText("x".repeat(NEXUS_STORY_BRIEF_LIMITS.maximumCharacters + 1)), /STORY_BRIEF_CHARACTER_LIMIT_EXCEEDED/);
});

test("Firebase client configuration fails early with actionable environment errors", () => {
  const valid = {
    apiKey: `AIza${"a".repeat(32)}`,
    authDomain: "example.firebaseapp.com",
    projectId: "example",
    storageBucket: "example.firebasestorage.app",
    messagingSenderId: "123",
    appId: "1:123:web:abc",
  };
  assert.doesNotThrow(() => validateFirebasePublicConfig(valid));
  assert.throws(() => validateFirebasePublicConfig({ ...valid, apiKey: "not-a-key" }), /invalid NEXT_PUBLIC_FIREBASE_API_KEY/);
  assert.throws(() => validateFirebasePublicConfig({ ...valid, authDomain: "" }), /NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN/);
});

test("feature flags default closed except the backward-compatible strategy selector", () => {
  const names = [
    "NEXUS_MULTI_SITE_ENABLED",
    "NEXUS_STORY_WORLD_ENABLED",
    "NEXUS_REFERENCE_GUIDE_ENABLED",
    "NEXUS_STRATEGY_SELECTOR_ENABLED",
    "NEXUS_GROUNDING_VALIDATION_ENABLED",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.deepEqual(getNexusFeatureFlags(), {
      multiSite: false,
      storyWorld: false,
      referenceGuide: false,
      strategySelector: true,
      groundingValidation: false,
    });
    for (const name of names) process.env[name] = "true";
    assert.deepEqual(getNexusFeatureFlags(), {
      multiSite: true,
      storyWorld: true,
      referenceGuide: true,
      strategySelector: true,
      groundingValidation: true,
    });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("strategy source goals are catalog-driven and reject unknown or cross-slot tokens", () => {
  assert.deepEqual(
    validateNexusStrategySourceGoals("strategy_brand_positioning", ["build_authority", "challenge_assumptions"]),
    ["build_authority", "challenge_assumptions"]
  );
  assert.deepEqual(
    validateNexusStrategySourceGoals("strategy_intrigue", ["create_intrigue", "create_intrigue"]),
    ["create_intrigue"]
  );
  assert.throws(
    () => validateNexusStrategySourceGoals("strategy_intrigue", ["invented_goal"]),
    /NEXUS_STRATEGY_GOAL_UNKNOWN/
  );
  assert.throws(
    () => validateNexusStrategySourceGoals("strategy_intrigue", ["drive_action"]),
    /NEXUS_STRATEGY_GOAL_NOT_SUPPORTED_BY_SLOT/
  );
  assert.throws(
    () => validateNexusStrategySourceGoals("strategy_intrigue", []),
    /NEXUS_STRATEGY_GOAL_REQUIRED/
  );
});

test("Setup and Nexus UI use the canonical multi-site website workflow", async () => {
  const setup = await readFile(
    new URL("components/section/billing/index.tsx", ROOT),
    "utf8"
  );
  const connectionRoute = await readFile(
    new URL("app/api/connections/verify/route.ts", ROOT),
    "utf8"
  );
  const intake = await readFile(
    new URL("components/author-intake-form.tsx", ROOT),
    "utf8"
  );
  const knowledgePanel = await readFile(
    new URL("components/nexus-knowledge-panel.tsx", ROOT),
    "utf8"
  );
  const websiteService = await readFile(
    new URL("core/nexus/website-connections.ts", ROOT),
    "utf8"
  );

  assert.match(setup, /Connected Websites/);
  assert.match(setup, /Add Website/);
  assert.match(setup, /Business Brand/);
  assert.match(setup, /Story World/);
  assert.match(setup, /Disable Website/);
  assert.match(setup, /websiteConnectionId/);
  assert.match(setup, /\/api\/nexus\/websites/);
  assert.doesNotMatch(setup, /Change WordPress Site/);
  assert.doesNotMatch(setup, /Your publishing site/);

  assert.match(connectionRoute, /listNexusWebsiteConnections/);
  assert.match(connectionRoute, /searchParams\.get\("websiteConnectionId"\)/);
  assert.match(connectionRoute, /selectedConnection\.secretCredentialRef/);
  assert.match(connectionRoute, /requestedContentRole/);
  assert.match(connectionRoute, /WEBSITE_CONFIGURATION_CONFLICT/);

  assert.match(intake, /Destination Website/);
  assert.match(intake, /context\.websites/);
  assert.match(intake, /site\.status === "active"/);
  assert.match(intake, /different content role/);
  assert.match(intake, /key=\{strategy\.id\}/);
  assert.doesNotMatch(intake, /key=\{strategy\.strategyGuideId\}/);
  assert.match(intake, /context\.flags\?\.storyWorld/);
  assert.match(knowledgePanel, /context\.flags\?\.storyWorld === true/);

  assert.match(websiteService, /storedStatus === "disabled"/);
  assert.match(websiteService, /normalizeLegacyWebsite/);
  assert.match(
    websiteService,
    /A maximum of two websites have been assigned to this plugin license\./
  );
  assert.match(websiteService, /assertNexusWebsiteRoleConfiguration/);
});

test("worker and gateway retain critical baseline controls", async () => {
  const worker = await readFile(new URL("services/content-engine-worker/main.py", ROOT), "utf8");
  const gateway = await readFile(new URL("services/wordpress-egress-gateway/index.js", ROOT), "utf8");
  assert.match(worker, /Invalid task signature/);
  assert.match(worker, /acquire_worker_lease/);
  assert.match(worker, /acquire_transcription_lease/);
  assert.match(worker, /facebook_post/);
  assert.match(worker, /instagram_caption/);
  assert.match(worker, /generate_featured_image/);
  assert.match(worker, /(?:COMPLETE|CANONICAL) Reference Guide/i);
  assert.match(worker, /NEXUS_INSUFFICIENT_GROUNDING/);
  assert.match(worker, /knowledgeMode.*full_reference_guide/s);
  const fullContextRetrieval = worker.slice(
    worker.indexOf("def retrieve_story_world_knowledge"),
    worker.indexOf("def select_strategy_guides")
  );
  assert.match(fullContextRetrieval, /completeReferenceGuide/);
  assert.doesNotMatch(fullContextRetrieval, /lexical/i);
  assert.match(worker, /"status": "draft"/);
  assert.match(gateway, /app\.post\("\/verify-wordpress"/);
  assert.match(gateway, /app\.post\("\/publish-vault"/);
  assert.match(gateway, /secretCredentialRef/);
  assert.doesNotMatch(gateway, /status\s*:\s*["']publish["']/);
});

test("Reference Guide management exposes lifecycle summaries and focused management", async () => {
  const contextRoute = await readFile(new URL("app/api/nexus/context/route.ts", ROOT), "utf8");
  const guideRoute = await readFile(new URL("app/api/nexus/reference-guides/route.ts", ROOT), "utf8");
  const lifecycle = await readFile(new URL("core/nexus/reference-guide-lifecycle.ts", ROOT), "utf8");
  const panel = await readFile(new URL("components/nexus-knowledge-panel.tsx", ROOT), "utf8");

  assert.match(contextRoute, /normalizeReferenceGuideStatus/);
  assert.doesNotMatch(contextRoute, /reference_guides"\)\.where\("status", "==", "ready"\)/);
  assert.match(panel, /Active Guide/);
  assert.match(panel, /Ready Guides/);
  assert.match(panel, /Processing/);
  assert.match(panel, /Failed/);
  assert.match(panel, /Manage Reference Guides/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /clientRequestId/);
  assert.match(guideRoute, /REFERENCE_GUIDE_DUPLICATE_REQUEST/);
  assert.match(guideRoute, /action === "set_active"/);
  assert.match(guideRoute, /action === "archive"/);
  assert.match(guideRoute, /action === "delete_incomplete"/);
  assert.match(guideRoute, /content_blueprints/);
  assert.match(guideRoute, /recursiveDelete/);
  assert.match(panel, /Delete Incomplete/);
  assert.match(guideRoute, /reference_guide_audit_events/);
  assert.match(lifecycle, /REFERENCE_GUIDE_NOT_READY/);
  assert.match(lifecycle, /REFERENCE_GUIDE_ACTIVE/);
});

test("Reference Guide lifecycle rejects invalid activation, archive, and deletion transitions", () => {
  assert.equal(normalizeReferenceGuideStatus({ status: "extracting" }), "processing");
  assert.equal(normalizeReferenceGuideStatus({ status: "ready", version: 1, publicSafeAcknowledged: true }), "ready");
  assert.throws(() => assertGuideCanBecomeActive("failed"), /Only a ready/);
  assert.throws(() => assertGuideCanBeArchived({ isActive: true }), /active guide/);
  assert.throws(() => assertGuideCanBeDeleted({ status: "ready", isActive: false, historicallyReferenced: false }), /Only failed or incomplete/);
  assert.throws(() => assertGuideCanBeDeleted({ status: "failed", isActive: false, historicallyReferenced: true }), /retained because a draft references/);
  assert.doesNotThrow(() => assertGuideCanBeDeleted({ status: "incomplete", isActive: false, historicallyReferenced: false }));
});

test("Nexus intake refreshes context and selects only ready active guides", async () => {
  const intake = await readFile(new URL("components/author-intake-form.tsx", ROOT), "utf8");
  const panel = await readFile(new URL("components/nexus-knowledge-panel.tsx", ROOT), "utf8");
  const page = await readFile(new URL("app/nexus-engine/page.tsx", ROOT), "utf8");

  assert.match(intake, /koba:nexus-context-updated/);
  assert.match(panel, /koba:nexus-context-updated/);
  assert.match(intake, /guide\.status === "ready"/);
  assert.match(intake, /defaultReferenceGuideId/);
  assert.match(intake, /!loadingContext && context\.flags\?\.storyWorld !== true/);
  assert.match(intake, /No ready guides/);
  assert.match(page, /Knowledge &amp; Strategy/);
  assert.doesNotMatch(page, /Blog Settings/);
  assert.match(panel, /Available Strategies/);
});

test("strategy source management is owner-only, private, versioned, and worker-enforced", async () => {
  const ownerContext = await readFile(new URL("core/nexus/owner-context.ts", ROOT), "utf8");
  const sourceRoute = await readFile(new URL("app/api/nexus/strategy-sources/route.ts", ROOT), "utf8");
  const ownerPage = await readFile(new URL("app/admin/nexus-strategy-sources/page.tsx", ROOT), "utf8");
  const sourceService = await readFile(new URL("core/nexus/strategy-source-service.ts", ROOT), "utf8");
  const blueprintRoute = await readFile(new URL("app/api/nexus/blueprints/route.ts", ROOT), "utf8");
  const worker = await readFile(new URL("services/content-engine-worker/main.py", ROOT), "utf8");

  assert.match(ownerContext, /KOBA_OWNER_EMAILS/);
  assert.match(ownerContext, /throw new NexusRouteError\(403/);
  assert.match(sourceRoute, /requireNexusOwnerContext\(\)/);
  assert.match(sourceRoute, /collection\("versions"\)/);
  assert.match(sourceRoute, /status: "approved"/);
  assert.match(sourceRoute, /cacheControl: "private, no-store"/);
  assert.match(sourceRoute, /validateNexusStrategySourceGoals/);
  assert.match(sourceRoute, /NEXUS_STRATEGY_GOAL_UNKNOWN/);
  assert.match(sourceRoute, /const version = Number\(current\.data\(\)\?\.latestVersion \|\| 0\) \+ 1/);
  assert.match(sourceRoute, /activeVersion: current\.data\(\)\?\.activeVersion \|\| null/);
  assert.match(sourceRoute, /status: "active", activeVersion: version/);
  assert.match(ownerPage, /fetch\("\/api\/session"/);
  assert.match(ownerPage, /payload\.isOwner !== true/);
  assert.match(ownerPage, /router\.replace\("\/products"\)/);
  assert.match(ownerPage, /selectedCatalogEntry\.goals\.map/);
  assert.match(ownerPage, /Upload New Version/);
  assert.doesNotMatch(ownerPage, /Comma-separated supported goal IDs/);
  const authorResponse = sourceRoute.slice(sourceRoute.indexOf("export async function GET"), sourceRoute.indexOf("export async function POST"));
  assert.doesNotMatch(authorResponse, /sourceStoragePath|extractedTextStoragePath|normalizedText/);
  assert.match(sourceService, /status === "active"/);
  assert.match(blueprintRoute, /primaryStrategyGuideVersion/);
  assert.match(blueprintRoute, /supportingStrategyGuideVersion/);
  assert.match(worker, /sourceMode": "catalog_summary"/);
  assert.match(worker, /sourceMode": "approved_version"/);
  assert.match(worker, /selected strategy source is no longer active/);
  assert.match(worker, /selected strategy source version is not approved/);
});

test("Reference Guide upload deduplication records terminal request state", async () => {
  const guideRoute = await readFile(new URL("app/api/nexus/reference-guides/route.ts", ROOT), "utf8");
  assert.match(guideRoute, /reference_guide_upload_requests/);
  assert.match(guideRoute, /status: "completed"[\s\S]*deduplicated: true/);
  assert.match(guideRoute, /sourceSha256/);
  assert.match(guideRoute, /already processing/);
});

test("Story World authoring uses the existing tenant-owned routes and immutable guide versions", async () => {
  const [middleware, worldRoute, guideRoute, panel, intake, knowledge, blueprint, worker] = await Promise.all([
    readFile(new URL("middleware.ts", ROOT), "utf8"),
    readFile(new URL("app/api/nexus/story-worlds/route.ts", ROOT), "utf8"),
    readFile(new URL("app/api/nexus/reference-guides/route.ts", ROOT), "utf8"),
    readFile(new URL("components/nexus-knowledge-panel.tsx", ROOT), "utf8"),
    readFile(new URL("components/author-intake-form.tsx", ROOT), "utf8"),
    readFile(new URL("core/nexus/knowledge-service.ts", ROOT), "utf8"),
    readFile(new URL("app/api/nexus/blueprints/route.ts", ROOT), "utf8"),
    readFile(new URL("services/content-engine-worker/main.py", ROOT), "utf8"),
  ]);
  const allowlistStart = middleware.indexOf("const MVP_API_EXACT_PATHS");
  const allowlistEnd = middleware.indexOf(");", allowlistStart);
  const allowlist = middleware.slice(allowlistStart, allowlistEnd);
  assert.match(allowlist, /"\/api\/nexus\/story-worlds"/);
  assert.match(allowlist, /"\/api\/nexus\/reference-guides"/);
  assert.doesNotMatch(allowlist, /"\/api\/nexus\/blueprints"/);
  assert.doesNotMatch(allowlist, /"\/api\/admin/);

  assert.match(worldRoute, /export async function PATCH/);
  assert.match(worldRoute, /assertOwnedStoryWorld/);
  assert.match(worldRoute, /buildStoryWorldAuthorPatch/);
  assert.doesNotMatch(worldRoute, /body\?\.studioKey|body\?\.authorId/);

  assert.match(guideRoute, /export async function GET/);
  assert.match(guideRoute, /export async function PUT/);
  assert.match(guideRoute, /collection\("versions"\)\.doc\(String\(version\)\)/);
  assert.match(guideRoute, /await versionRef\.create/);
  assert.match(guideRoute, /pendingVersionRef\.set\(\{ status: "failed"/);
  assert.match(guideRoute, /version_created/);
  assert.match(guideRoute, /Cache-Control.*private, no-store/s);
  assert.match(panel, /Edit Story World/);
  assert.match(panel, /View Current Guide/);
  assert.match(panel, /Edit as New Version/);
  assert.match(panel, /Canonical Guide/);
  assert.doesNotMatch(panel, /Story World management is not enabled for this environment/);
  assert.match(intake, /guide\.id === selectedWorld\?\.defaultReferenceGuideId/);

  for (const source of [knowledge, blueprint]) assert.match(source, /assertCanonicalReferenceGuide/);
  assert.match(worker, /defaultReferenceGuideId/);
  assert.match(worker, /active Canonical Guide/);
});

test("Story World schema v2 keeps Story Brief truth separate and protected", async () => {
  const [contracts, route, intake, worker, rules] = await Promise.all([
    readFile(new URL("core/nexus/contracts.ts", ROOT), "utf8"),
    readFile(new URL("app/api/nexus/blueprints/route.ts", ROOT), "utf8"),
    readFile(new URL("components/author-intake-form.tsx", ROOT), "utf8"),
    readFile(new URL("services/content-engine-worker/main.py", ROOT), "utf8"),
    readFile(new URL("firestore.rules", ROOT), "utf8"),
  ]);
  assert.match(contracts, /NEXUS_SCHEMA_VERSION = 2/);
  assert.match(contracts, /canonical_plus_story_brief/);
  assert.match(route, /collection\("story_briefs"\)/);
  assert.match(route, /boundBlueprintId/);
  assert.match(route, /storyBriefSha256/);
  assert.doesNotMatch(route, /blueprintData[\s\S]{0,2000}normalizedText/);
  assert.match(intake, /Story Brief — what is true for this story/);
  assert.match(intake, /Custom Directives — how should KOBA-I tell it/);
  assert.match(worker, /def retrieve_story_brief/);
  assert.match(worker, /approved truth only for this Blueprint/);
  assert.match(worker, /Custom Directives are not factual authority/);
  assert.match(worker, /NEXUS_STORY_BRIEF_CONTRADICTS_CANON/);
  assert.match(rules, /match \/nexus_story_worlds\/\{universeId\}[\s\S]*allow read, write: if false/);
});

test("Reference Guide detail responses hide server storage coordinates", async () => {
  const guideRoute = await readFile(new URL("app/api/nexus/reference-guides/route.ts", ROOT), "utf8");
  const responseStart = guideRoute.indexOf("return NextResponse.json({", guideRoute.indexOf("export async function GET"));
  const responseEnd = guideRoute.indexOf("Cache-Control", responseStart);
  const responseProjection = guideRoute.slice(responseStart, responseEnd);
  assert.ok(responseStart >= 0 && responseEnd > responseStart);
  assert.doesNotMatch(responseProjection, /sourceStoragePath|extractedTextStoragePath|bucket/);
  assert.match(responseProjection, /normalizedText/);
  assert.match(responseProjection, /versions/);
});
