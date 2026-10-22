import assert from "node:assert/strict";
import test from "node:test";

import {
  StudioPublicationAccessError,
  assertCanonicalPublicationType,
} from "../studio-publication-access.ts";

test("canonical audiobook and ebook asset IDs accept their matching type", () => {
  assert.equal(assertCanonicalPublicationType("abk_0123456789abcdef", "audiobook"), "audiobook");
  assert.equal(assertCanonicalPublicationType("ebk_0123456789abcdef", "ebook"), "ebook");
});

test("canonical asset IDs reject a cross-format Save & Sync mutation", () => {
  for (const [assetId, type] of [
    ["abk_0123456789abcdef", "ebook"],
    ["ebk_0123456789abcdef", "audiobook"],
  ]) {
    assert.throws(
      () => assertCanonicalPublicationType(assetId, type),
      (error) => {
        assert.ok(error instanceof StudioPublicationAccessError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "STUDIO_PUBLICATION_TYPE_IMMUTABLE");
        return true;
      }
    );
  }
});

test("legacy noncanonical IDs remain readable without forced migration", () => {
  assert.equal(assertCanonicalPublicationType("historical-publication-42", "ebook"), "ebook");
});
