import assert from "node:assert/strict";
import test from "node:test";

import {
  TURNSTILE_ERROR_CODES,
  verifyFreePublicationHuman,
} from "../turnstile.ts";

const environment = {
  TURNSTILE_SECRET_KEY: "test-secret",
  TURNSTILE_EXPECTED_HOSTNAME: "dashboard.koba-i.com",
};

function response(payload, ok = true) {
  return { ok, async json() { return payload; } };
}

test("Turnstile verification is bound to hostname, action, and requested asset", async () => {
  let requestBody;
  await verifyFreePublicationHuman({
    token: "verified-token",
    assetId: "abk_free",
    source: environment,
    fetchImpl: async (_url, options) => {
      requestBody = String(options.body);
      return response({ success: true, hostname: "dashboard.koba-i.com", action: "free_publication", cdata: "abk_free" });
    },
  });
  assert.match(requestBody, /response=verified-token/);
  assert.doesNotMatch(requestBody, /remoteip=/);
});

for (const payload of [
  { success: false, hostname: "dashboard.koba-i.com", action: "free_publication", cdata: "abk_free" },
  { success: true, hostname: "attacker.example", action: "free_publication", cdata: "abk_free" },
  { success: true, hostname: "dashboard.koba-i.com", action: "other", cdata: "abk_free" },
  { success: true, hostname: "dashboard.koba-i.com", action: "free_publication", cdata: "abk_other" },
]) {
  test("Turnstile response mismatch fails closed", async () => {
    await assert.rejects(
      () => verifyFreePublicationHuman({ token: "token", assetId: "abk_free", source: environment, fetchImpl: async () => response(payload) }),
      (error) => error.code === TURNSTILE_ERROR_CODES.failed && error.status === 403
    );
  });
}

test("missing configuration and provider failure use stable unavailable codes", async () => {
  await assert.rejects(
    () => verifyFreePublicationHuman({ token: "token", assetId: "abk_free", source: {}, fetchImpl: async () => response({}) }),
    (error) => error.code === TURNSTILE_ERROR_CODES.notConfigured && error.status === 503
  );
  await assert.rejects(
    () => verifyFreePublicationHuman({ token: "token", assetId: "abk_free", source: environment, fetchImpl: async () => { throw new Error("network"); } }),
    (error) => error.code === TURNSTILE_ERROR_CODES.unavailable && error.status === 503
  );
});

test("Cloudflare testing metadata is accepted only by the isolated non-production runtime", async () => {
  const testingPayload = {
    success: true,
    hostname: "example.com",
    metadata: { result_with_testing_key: true },
  };
  const localEnvironment = {
    NODE_ENV: "development",
    KOBA_LOCAL_ACCEPTANCE: "true",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    TURNSTILE_EXPECTED_HOSTNAME: "localhost",
  };

  await verifyFreePublicationHuman({
    token: "XXXX.DUMMY.TOKEN.XXXX",
    assetId: "ebk_local_acceptance",
    source: localEnvironment,
    fetchImpl: async () => response(testingPayload),
  });

  for (const source of [
    { ...localEnvironment, NODE_ENV: "production" },
    { ...localEnvironment, KOBA_LOCAL_ACCEPTANCE: "false" },
    { ...localEnvironment, TURNSTILE_SECRET_KEY: "not-the-cloudflare-test-secret" },
    { ...localEnvironment, TURNSTILE_EXPECTED_HOSTNAME: "dashboard.koba-i.com" },
  ]) {
    await assert.rejects(
      () => verifyFreePublicationHuman({
        token: "XXXX.DUMMY.TOKEN.XXXX",
        assetId: "ebk_local_acceptance",
        source,
        fetchImpl: async () => response(testingPayload),
      }),
      (error) => error.code === TURNSTILE_ERROR_CODES.failed && error.status === 403
    );
  }

  await assert.rejects(
    () => verifyFreePublicationHuman({
      token: "XXXX.DUMMY.TOKEN.XXXX",
      assetId: "ebk_local_acceptance",
      source: localEnvironment,
      fetchImpl: async () => response({ success: true, hostname: "example.com" }),
    }),
    (error) => error.code === TURNSTILE_ERROR_CODES.failed && error.status === 403
  );
});
