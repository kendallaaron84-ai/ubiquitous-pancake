import assert from "node:assert/strict";
import test from "node:test";

import {
  BlogConnectionError,
  resolveVerifiedBlogConnection,
} from "../blog-connection.ts";

const kendallConnection = {
  studioKey: "KOBA-I-AUDIO",
  status: "active",
  verificationStatus: "verified",
  targetWpOrigin: "https://audio.koba-i.com/",
  secretCredentialRef:
    "projects/jubilee-command-center---dev/secrets/wp-koba-audio/versions/latest",
};

const sharonConnection = {
  studioKey: "SHARON-STUDIO",
  status: "active",
  verified: true,
  targetWpOrigin: "https://books.sharon-example.com",
  secretCredentialRef:
    "projects/jubilee-command-center---dev/secrets/wp-sharon-studio/versions/latest",
};

test("Kendall resolves only to the KOBA-I WordPress origin", () => {
  const resolved = resolveVerifiedBlogConnection(
    kendallConnection,
    "KOBA-I-AUDIO"
  );
  assert.equal(resolved.targetWpOrigin, "https://audio.koba-i.com");
  assert.equal(resolved.secretCredentialRef, kendallConnection.secretCredentialRef);
});

test("Sharon resolves only to Sharon's WordPress origin", () => {
  const resolved = resolveVerifiedBlogConnection(
    sharonConnection,
    "SHARON-STUDIO"
  );
  assert.equal(resolved.targetWpOrigin, "https://books.sharon-example.com");
  assert.equal(resolved.secretCredentialRef, sharonConnection.secretCredentialRef);
});

test("accepts a canonical Secret Manager reference using a numeric GCP project number", () => {
  const resolved = resolveVerifiedBlogConnection(
    {
      ...kendallConnection,
      secretCredentialRef:
        "projects/751521788548/secrets/WP_CREDS_KOBA-I-AUDIO/versions/latest",
    },
    "KOBA-I-AUDIO"
  );

  assert.equal(
    resolved.secretCredentialRef,
    "projects/751521788548/secrets/WP_CREDS_KOBA-I-AUDIO/versions/latest"
  );
});

test("a signed studio cannot consume another studio's connection", () => {
  assert.throws(
    () => resolveVerifiedBlogConnection(sharonConnection, "KOBA-I-AUDIO"),
    BlogConnectionError
  );
});

test("inactive, unverified, HTTP, and malformed-secret connections fail closed", () => {
  const invalidConnections = [
    { ...kendallConnection, status: "disabled" },
    { ...kendallConnection, verificationStatus: "pending" },
    { ...kendallConnection, targetWpOrigin: "http://audio.koba-i.com" },
    { ...kendallConnection, secretCredentialRef: "wp-koba-audio" },
  ];

  for (const connection of invalidConnections) {
    assert.throws(
      () => resolveVerifiedBlogConnection(connection, "KOBA-I-AUDIO"),
      BlogConnectionError
    );
  }
});
