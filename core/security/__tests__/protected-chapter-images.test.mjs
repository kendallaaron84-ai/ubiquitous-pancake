import assert from "node:assert/strict";
import test from "node:test";

import {
  attachProtectedChapterImageUrls,
  canonicalizeProtectedChapterImages,
  protectedChapterImagePaths,
} from "../protected-chapter-images.ts";
import {
  assertTenantBoundStoragePath,
  buildWorkbenchDraftPatch,
} from "../studio-publication-access.ts";

const ASSET_ID = "ebk_protected";
const STUDIO_KEY = "studio_author";
const STORAGE_PATH = `studio/${ASSET_ID}/${STUDIO_KEY}/illustration/page-one.png`;

test("Workbench persistence discards signed previews and keeps canonical protected references", () => {
  const patch = buildWorkbenchDraftPatch({
    assetId: ASSET_ID,
    studioKey: STUDIO_KEY,
    layoutMode: "reflowable",
    chapters: [{
      id: "chapter_one",
      title: "Chapter One",
      textContent: `<p>Before</p><figure><img src="https://signed.example/temporary?token=secret" data-koba-storage-path="${STORAGE_PATH}" alt="Tree"></figure><p>After</p>`,
    }],
    guardrails: {},
  });
  const html = patch.chapters[0].textContent;
  assert.match(html, new RegExp(`data-koba-storage-path="${STORAGE_PATH}"`));
  assert.match(html, /src=""/);
  assert.doesNotMatch(html, /signed\.example|token=secret/);
  assert.deepEqual(protectedChapterImagePaths(html), [STORAGE_PATH]);
});

test("cross-tenant protected illustration references fail closed", () => {
  assert.throws(() => canonicalizeProtectedChapterImages(
    `<img src="https://signed.example" data-koba-storage-path="studio/${ASSET_ID}/other_tenant/illustration/stolen.png">`,
    (path) => assertTenantBoundStoragePath(path, ASSET_ID, STUDIO_KEY)
  ), /not authorized/);
});

test("authenticated preview rendering uses a fresh signed URL", async () => {
  const canonical = `<p>Before</p><img src="" data-koba-storage-path="${STORAGE_PATH}" alt="Tree"><p>After</p>`;
  const preview = await attachProtectedChapterImageUrls(
    canonical,
    (path) => assertTenantBoundStoragePath(path, ASSET_ID, STUDIO_KEY),
    async (path) => `https://signed.example/preview/${encodeURIComponent(path)}`
  );
  assert.match(preview, /https:\/\/signed\.example\/preview/);
  assert.match(preview, /data-koba-storage-path=/);

});
