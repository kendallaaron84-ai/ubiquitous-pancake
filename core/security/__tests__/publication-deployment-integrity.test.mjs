import assert from "node:assert/strict";
import test from "node:test";

import {
  PublicationAssetIntegrityError,
  assertProtectedPublicationAssets,
  requiredProtectedPublicationPaths,
} from "../publication-deployment-integrity.ts";

test("renamed illustrated publications retain canonical asset-scoped page identity", () => {
  const paths = requiredProtectedPublicationPaths({
    assetId: "ebk_original-book",
    studioKey: "studio_test",
    publicationType: "ebook",
    chapters: [],
    ebookPayload: {
      layoutMode: "illustrated_pages",
      chapters: [{ pages: [{ pageId: "page-1", assetId: "studio/ebk_original-book/studio_test/pages/page-1.jpg" }] }],
    },
  });
  assert.deepEqual(paths, ["studio/ebk_original-book/studio_test/pages/page-1.jpg"]);
});

test("cross-publication protected references fail closed before deployment", () => {
  assert.throws(
    () => requiredProtectedPublicationPaths({
      assetId: "ebk_renamed-book",
      studioKey: "studio_test",
      publicationType: "ebook",
      chapters: [],
      ebookPayload: {
        layoutMode: "illustrated_pages",
        chapters: [{ pages: [{ assetId: "studio/ebk_original-book/pages/page-1.jpg" }] }],
      },
    }),
    (error) => error instanceof PublicationAssetIntegrityError &&
      error.code === "PUBLICATION_ASSETS_UNAVAILABLE"
  );
});

test("missing protected objects prevent a published result", async () => {
  await assert.rejects(
    assertProtectedPublicationAssets({
      assetId: "abk_audio-book",
      studioKey: "studio_test",
      publicationType: "audiobook",
      chapters: [{ storagePath: "studio/abk_audio-book/studio_test/tracks/chapter-1.mp3" }],
      requireAsset: true,
      exists: async () => false,
    }),
    (error) => error instanceof PublicationAssetIntegrityError &&
      error.code === "PUBLICATION_ASSETS_UNAVAILABLE"
  );
});

test("published protected publications cannot contain zero required assets", () => {
  assert.throws(
    () => requiredProtectedPublicationPaths({
      assetId: "abk_empty",
      studioKey: "studio_test",
      publicationType: "audiobook",
      chapters: [],
      requireAsset: true,
    }),
    PublicationAssetIntegrityError
  );
});

test("an unfinished audiobook draft may retain an empty chapter placeholder", () => {
  assert.deepEqual(requiredProtectedPublicationPaths({
    assetId: "abk_draft",
    studioKey: "studio_test",
    publicationType: "audiobook",
    chapters: [{ id: "chapter-1", title: "Chapter 1" }],
    requireAsset: false,
  }), []);
});

test("reflowable inline illustrations are tenant-bound and physically verified", async () => {
  const validPath = "studio/ebk_reflowable/studio_test/illustration/tree.png";
  const checked = [];
  await assertProtectedPublicationAssets({
    assetId: "ebk_reflowable",
    studioKey: "studio_test",
    publicationType: "ebook",
    chapters: [{
      textContent: `<p>Before</p><img data-koba-storage-path="${validPath}" src=""><p>After</p>`,
    }],
    exists: async (path) => { checked.push(path); return true; },
  });
  assert.deepEqual(checked, [validPath]);
});

test("cross-tenant inline illustrations fail closed before object lookup", async () => {
  await assert.rejects(
    assertProtectedPublicationAssets({
      assetId: "ebk_reflowable",
      studioKey: "studio_test",
      publicationType: "ebook",
      chapters: [{
        textContent: '<img data-koba-storage-path="studio/ebk_reflowable/studio_other/illustration/tree.png" src="">',
      }],
      exists: async () => true,
    }),
    PublicationAssetIntegrityError
  );
});

test("inline illustrations after long chapter prose are still validated", async () => {
  const validPath = "studio/ebk_long/studio_test/illustration/late.png";
  const checked = [];
  await assertProtectedPublicationAssets({
    assetId: "ebk_long",
    studioKey: "studio_test",
    publicationType: "ebook",
    chapters: [{
      textContent: `<p>${"prose ".repeat(500)}</p><img data-koba-storage-path="${validPath}" src="">`,
    }],
    exists: async (path) => { checked.push(path); return true; },
  });
  assert.deepEqual(checked, [validPath]);
});
