import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCanonicalReferenceGuide,
  assertOwnedStoryWorld,
  buildStoryWorldAuthorPatch,
} from "../story-world-authoring.ts";

const owner = { studioKey: "KOBA-AUDIO-AUTHOR", authorId: "author_01" };
const world = { ...owner, universeId: "world_01", status: "active", defaultReferenceGuideId: "guide_01" };
const guide = { ...owner, universeId: "world_01", status: "ready", version: 2 };

test("tenant-owned Story Worlds are accepted while forged ownership fails closed", () => {
  assert.doesNotThrow(() => assertOwnedStoryWorld(true, world, owner, { requireActive: true }));
  assert.throws(() => assertOwnedStoryWorld(true, { ...world, studioKey: "KOBA-OTHER" }, owner), /not found/);
  assert.throws(() => assertOwnedStoryWorld(true, { ...world, authorId: "other" }, owner), /not found/);
  assert.throws(() => assertOwnedStoryWorld(false, {}, owner), /not found/);
});

test("only approved descriptive Story World fields are built from author input", () => {
  assert.deepEqual(buildStoryWorldAuthorPatch({
    title: "  Lantern Realm  ", genre: " Fantasy ", description: " Public description ", status: "archived",
    studioKey: "FORGED", authorId: "FORGED", universeId: "FORGED",
  }), { title: "Lantern Realm", genre: "Fantasy", description: "Public description", status: "archived" });
  assert.throws(() => buildStoryWorldAuthorPatch({ title: "Realm", genre: "Fantasy", description: "Description", status: "deleted" }), /valid Story World status/);
});

test("ready alternate and cross-tenant guides cannot replace the active Canonical Guide", () => {
  assert.doesNotThrow(() => assertCanonicalReferenceGuide(world, true, guide, { ...owner, universeId: "world_01", referenceGuideId: "guide_01" }));
  assert.throws(() => assertCanonicalReferenceGuide(world, true, guide, { ...owner, universeId: "world_01", referenceGuideId: "guide_02" }), /Canonical Guide/);
  assert.throws(() => assertCanonicalReferenceGuide(world, true, { ...guide, studioKey: "KOBA-OTHER" }, { ...owner, universeId: "world_01", referenceGuideId: "guide_01" }), /Canonical Guide/);
  assert.throws(() => assertCanonicalReferenceGuide(world, true, { ...guide, status: "archived" }, { ...owner, universeId: "world_01", referenceGuideId: "guide_01" }), /Canonical Guide/);
});
