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
    publicationType: "ebook",
    chapters: [],
    ebookPayload: {
      layoutMode: "illustrated_pages",
      chapters: [{ pages: [{ pageId: "page-1", assetId: "studio/ebk_original-book/pages/page-1.jpg" }] }],
    },
  });
  assert.deepEqual(paths, ["studio/ebk_original-book/pages/page-1.jpg"]);
});

test("cross-publication protected references fail closed before deployment", () => {
  assert.throws(
    () => requiredProtectedPublicationPaths({
      assetId: "ebk_renamed-book",
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
      publicationType: "audiobook",
      chapters: [{ storagePath: "studio/abk_audio-book/tracks/chapter-1.mp3" }],
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
    publicationType: "audiobook",
    chapters: [{ id: "chapter-1", title: "Chapter 1" }],
    requireAsset: false,
  }), []);
});
