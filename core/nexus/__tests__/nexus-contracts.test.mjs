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
import { validateFirebasePublicConfig } from "../../firebase-config.ts";
import {
  NEXUS_STRATEGY_CATALOG,
  selectNexusStrategy,
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
  assert.match(worker, /COMPLETE Reference Guide/);
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
