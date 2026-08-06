import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTINATION_CHANGE_FAILED_MESSAGE,
  buildAuthoritativeDeploymentFields,
  buildDeploymentHistoryEntry,
  buildFailedDeploymentPatch,
  buildPendingDeploymentPatch,
  isConfirmedDestinationChange,
} from "../publication-migration.ts";

const ORIGINAL = {
  websiteConnectionId: "primary",
  targetWpOrigin: "https://audio.koba-i.com",
};
const DUNCAN = {
  websiteConnectionId: "site_8d89e9042e4ff691",
  targetWpOrigin: "https://duncan-hunter.koba-i.com",
};

test("an existing publication move is detected and requires the confirmed path", () => {
  assert.equal(isConfirmedDestinationChange({
    hasConfirmedDeployment: true,
    previousWebsiteConnectionId: ORIGINAL.websiteConnectionId,
    previousTargetOrigin: ORIGINAL.targetWpOrigin,
    nextWebsiteConnectionId: DUNCAN.websiteConnectionId,
    nextTargetOrigin: DUNCAN.targetWpOrigin,
  }), true);
  assert.match(DESTINATION_CHANGE_FAILED_MESSAGE, /existing publication remains connected/);
});

test("pending and failed move patches never replace the authoritative destination", () => {
  const pending = buildPendingDeploymentPatch(DUNCAN, "started");
  const failed = buildFailedDeploymentPatch({
    destination: DUNCAN,
    failedAt: "failed",
    code: "INVALID_CREDENTIALS",
    boundary: "gateway_response",
  });

  for (const patch of [pending, failed]) {
    assert.equal(Object.hasOwn(patch, "websiteConnectionId"), false);
    assert.equal(Object.hasOwn(patch, "associatedWebsite"), false);
    assert.equal(Object.hasOwn(patch, "wordpressDeployment"), false);
  }
  assert.equal(failed.lastDeploymentAttempt.websiteConnectionId, DUNCAN.websiteConnectionId);
  assert.equal(failed.lastDeploymentAttempt.code, "INVALID_CREDENTIALS");
});

test("successful moves retain complete deployment history and preserve original assets", () => {
  const confirmation = {
    ...DUNCAN,
    publicationId: 41,
    pageId: 42,
    bookshelfPageId: 43,
    publicationUrl: `${DUNCAN.targetWpOrigin}/book/`,
    bookshelfUrl: `${DUNCAN.targetWpOrigin}/bookstore/`,
  };
  const history = buildDeploymentHistoryEntry({
    previousWebsiteConnectionId: ORIGINAL.websiteConnectionId,
    previousTargetOrigin: ORIGINAL.targetWpOrigin,
    next: confirmation,
    migrationTimestamp: "2026-08-06T12:00:00.000Z",
    authenticatedAuthor: "Author@Example.com",
  });

  assert.equal(history.previousWebsiteConnectionId, "primary");
  assert.equal(history.previousTargetOrigin, ORIGINAL.targetWpOrigin);
  assert.equal(history.newWebsiteConnectionId, DUNCAN.websiteConnectionId);
  assert.equal(history.newTargetOrigin, DUNCAN.targetWpOrigin);
  assert.equal(history.resultingPageId, 42);
  assert.equal(history.resultingBookshelfPageId, 43);
  assert.equal(history.authenticatedAuthor, "author@example.com");
  assert.equal(history.originalAssetsDeleted, false);

  const authoritative = buildAuthoritativeDeploymentFields(confirmation, "deployed");
  assert.equal(authoritative.websiteConnectionId, DUNCAN.websiteConnectionId);
  assert.equal(authoritative.associatedWebsite, DUNCAN.targetWpOrigin);
  assert.equal(authoritative.wordpressDeployment.websiteConnectionId, DUNCAN.websiteConnectionId);
  assert.equal(authoritative.wordpressDeployment.deployedAt, "deployed");
});
