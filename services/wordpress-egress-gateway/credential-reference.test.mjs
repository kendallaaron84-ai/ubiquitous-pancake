import assert from "node:assert/strict";
import test from "node:test";

import {
  CredentialReferenceError,
  assertCredentialReference,
  credentialSecretReference,
  normalizeGatewayStudioKey,
  normalizeWebsiteConnectionId,
} from "./credential-reference.js";

const PROJECT_NUMBER = "751521788548";
const STUDIO_KEY = "JUBI-TEST-1234-5678";
const SECONDARY_ID = "site_8d89e9042e4ff691";

test("primary and secondary websites resolve independent credential references", () => {
  const primary = credentialSecretReference(PROJECT_NUMBER, STUDIO_KEY, "primary");
  const secondary = credentialSecretReference(
    PROJECT_NUMBER,
    STUDIO_KEY,
    SECONDARY_ID
  );

  assert.equal(
    primary,
    `projects/${PROJECT_NUMBER}/secrets/WP_CREDS_${STUDIO_KEY}/versions/latest`
  );
  assert.equal(
    secondary,
    `projects/${PROJECT_NUMBER}/secrets/WP_CREDS_${STUDIO_KEY}-${SECONDARY_ID}/versions/latest`
  );
  assert.notEqual(primary, secondary);
});

test("the gateway validates the exact website credential reference", () => {
  const secondary = credentialSecretReference(
    PROJECT_NUMBER,
    STUDIO_KEY,
    SECONDARY_ID
  );
  assert.equal(
    assertCredentialReference({
      projectNumber: PROJECT_NUMBER,
      studioKey: STUDIO_KEY,
      websiteConnectionId: SECONDARY_ID,
      secretCredentialRef: secondary,
    }),
    secondary
  );

  assert.throws(
    () => assertCredentialReference({
      projectNumber: PROJECT_NUMBER,
      studioKey: STUDIO_KEY,
      websiteConnectionId: SECONDARY_ID,
      secretCredentialRef: credentialSecretReference(
        PROJECT_NUMBER,
        STUDIO_KEY,
        "primary"
      ),
    }),
    (error) => {
      assert.ok(error instanceof CredentialReferenceError);
      assert.equal(error.code, "TENANT_CONNECTION_MISMATCH");
      assert.equal(error.status, 403);
      return true;
    }
  );
});

test("publish requests cannot omit the website connection ID", () => {
  assert.throws(
    () => normalizeWebsiteConnectionId(undefined),
    (error) => {
      assert.equal(error.code, "INVALID_WEBSITE_CONNECTION_ID");
      return true;
    }
  );
  assert.equal(
    normalizeWebsiteConnectionId(undefined, { allowPrimaryDefault: true }),
    "primary"
  );
});

test("the legacy synthetic StudioKey workaround is rejected", () => {
  assert.throws(
    () => normalizeGatewayStudioKey(`${STUDIO_KEY}-${SECONDARY_ID}`),
    (error) => {
      assert.equal(error.code, "INVALID_STUDIO_KEY");
      return true;
    }
  );
});

