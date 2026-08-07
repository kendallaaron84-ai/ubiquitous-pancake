import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { decodeJwt } from "jose";

import {
  signReaderToken,
  verifyReaderToken,
} from "../reader-token.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const environment = {
  KOBA_JWT_PRIVATE_SIGNING_KEY: privateKey,
  KOBA_JWT_PUBLIC_VERIFYING_KEY: publicKey,
  KOBA_JWT_KEY_ID: "reader-test-key",
  KOBA_JWT_ISSUER: "koba-test-issuer",
  KOBA_JWT_AUDIENCE: "koba-test-media",
};

const tokenInput = {
  principalId: "principal_123",
  tenantId: "tenant_123",
};

test("signs and verifies an asymmetric tenant-scoped reader token", async () => {
  const token = await signReaderToken(tokenInput, environment);
  const claims = await verifyReaderToken(token, environment);
  const encodedClaims = decodeJwt(token);

  assert.deepEqual(claims, {
    ...tokenInput,
    principalType: "legacy",
    scope: ["media:read"],
  });
  assert.equal(
    encodedClaims.exp - encodedClaims.iat,
    30 * 24 * 60 * 60
  );
});

test("marks canonical Firebase UID media tokens without changing legacy tokens", async () => {
  const token = await signReaderToken(
    { ...tokenInput, principalType: "firebase_uid" },
    environment
  );
  const claims = await verifyReaderToken(token, environment);
  assert.equal(claims.principalType, "firebase_uid");
  assert.equal(claims.principalId, tokenInput.principalId);
});

test("anonymous free token is limited to 72 hours and exact asset/origin claims", async () => {
  const token = await signReaderToken(
    { ...tokenInput, principalType: "anonymous_free", assetId: "abk_free", origin: "https://author.example" },
    environment
  );
  const encodedClaims = decodeJwt(token);
  const claims = await verifyReaderToken(token, environment);
  assert.equal(encodedClaims.exp - encodedClaims.iat, 72 * 60 * 60);
  assert.equal(claims.principalType, "anonymous_free");
  assert.equal(claims.assetId, "abk_free");
  assert.equal(claims.origin, "https://author.example");
});

test("anonymous free token cannot be issued without exact resource scope", async () => {
  await assert.rejects(
    () => signReaderToken({ ...tokenInput, principalType: "anonymous_free" }, environment),
    /assetId is required/
  );
  await assert.rejects(
    () => signReaderToken({ ...tokenInput, principalType: "anonymous_free", assetId: "abk_free", origin: "http://author.example" }, environment),
    /HTTPS origin is required/
  );
});

test("rejects a tampered reader token", async () => {
  const token = await signReaderToken(tokenInput, environment);
  const [header, payload, signature] = token.split(".");
  const replacement = signature.startsWith("A") ? "B" : "A";
  const tamperedToken = [
    header,
    payload,
    `${replacement}${signature.slice(1)}`,
  ].join(".");

  await assert.rejects(() =>
    verifyReaderToken(tamperedToken, environment)
  );
});

test("fails closed when asymmetric signing configuration is missing", async () => {
  await assert.rejects(
    () => signReaderToken(tokenInput, {}),
    /Missing reader security configuration/
  );
});
