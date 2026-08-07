import assert from "node:assert/strict";
import test from "node:test";
import { inventoryReaderMediaStorage, summarizeReaderMediaStorage } from "../reader-media-storage-inventory.ts";

test("inventory distinguishes protected, public-only, and missing media without exposing full public URLs", () => {
  const items = inventoryReaderMediaStorage([{ id: "abk_book", data: { type: "audiobook", studioTracks: [{ storagePath: "studio/abk_book/chapter-1.mp3", url: "https://legacy.example/one.mp3" }, { audioUrl: "https://legacy.example/media/two.m4a?secret=value" }, { title: "Missing" }] } }]);
  assert.deepEqual(summarizeReaderMediaStorage(items), { total: 3, protected: 1, public_url_only: 1, missing: 1 });
  assert.equal(items[1].publicOrigin, "https://legacy.example");
  assert.equal(items[1].proposedStoragePath, "studio/abk_book/chapter-2.m4a");
  assert.equal(JSON.stringify(items).includes("secret=value"), false);
});

test("ebook text is excluded from protected audio/video migration inventory", () => {
  assert.deepEqual(inventoryReaderMediaStorage([{ id: "ebk_book", data: { type: "ebook", chapters: [{ url: "https://example.test/chapter" }] } }]), []);
});
