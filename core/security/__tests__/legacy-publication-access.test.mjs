import assert from "node:assert/strict";
import test from "node:test";

import {
  LegacyPublicationAccessError,
  resolveLegacyPublicationAuthorName,
} from "../legacy-publication-access.ts";

test("ownership-matched legacy publications remain readable after an active license is registered", () => {
  assert.equal(
    resolveLegacyPublicationAuthorName({
      publicationAuthorEmail: "Author@Example.com",
      publicationAuthorName: "Dr. Author",
      activeLicenseExists: true,
      license: { status: "active", authorEmail: "author@example.com", authorName: "Author" },
    }),
    "Dr. Author"
  );
});

test("legacy access falls back to the active license author name without mutating the publication", () => {
  assert.equal(
    resolveLegacyPublicationAuthorName({
      publicationAuthorEmail: "author@example.com",
      publicationAuthorName: "",
      activeLicenseExists: true,
      license: { status: "active", authorId: "author@example.com", authorName: "Verified Author" },
    }),
    "Verified Author"
  );
});

test("active tenant licenses fail closed for mismatched or inactive legacy ownership", () => {
  for (const license of [
    { status: "active", authorEmail: "different@example.com" },
    { status: "disabled", authorEmail: "author@example.com" },
  ]) {
    assert.throws(
      () => resolveLegacyPublicationAuthorName({
        publicationAuthorEmail: "author@example.com",
        publicationAuthorName: "Author",
        activeLicenseExists: true,
        license,
      }),
      (error) => error instanceof LegacyPublicationAccessError && error.code === "LEGACY_PUBLICATION_OWNER_MISMATCH"
    );
  }
});

test("pre-license legacy behavior remains available without weakening reader authentication", () => {
  assert.equal(
    resolveLegacyPublicationAuthorName({
      publicationAuthorEmail: "author@example.com",
      publicationAuthorName: "Legacy Author",
      activeLicenseExists: false,
      license: {},
    }),
    "Legacy Author"
  );
});
