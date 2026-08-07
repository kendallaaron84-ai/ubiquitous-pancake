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
