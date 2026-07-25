import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return {
        shortCircuit: true,
        url: pathToFileURL(path.join(projectRoot, `${specifier.slice(2)}.ts`)).href,
      };
    }
    return nextResolve(specifier, context);
  },
});

process.env.KOBA_SMS_PROVIDER = "mock";
process.env.KOBA_APP_ENV = "test";

const { createMediaTokenRouteHandlers } = await import("./handler.ts");

const environment = {
  appEnvironment: "test",
  smsProvider: "mock",
  hmacSecret: "h".repeat(64),
  identityHashSecret: "i".repeat(64),
  identityHashVersion: 1,
  jwtPrivateSigningKey: "private",
  jwtPublicVerifyingKey: "public",
  jwtKeyId: "reader-key",
  jwtIssuer: "koba-auth",
  jwtAudience: "koba-media",
  allowedOrigins: ["http://koba-dev.local"],
  twilioAccountSid: null,
  twilioAuthToken: null,
  twilioVerifyServiceSid: null,
};

function makeHandlers(overrides = {}) {
  const calls = { authorize: 0, issue: 0 };
  const handlers = createMediaTokenRouteHandlers({
    db: {},
    loadEnvironment: () => environment,
    nowMillis: () => 1_800_000_000_000,
    authorizeSession: async () => {
      calls.authorize += 1;
      return { principalId: "phn_v1_reader", tenantId: "tenant_1" };
    },
    issueReaderToken: async () => {
      calls.issue += 1;
      return { readerToken: "signed.reader.token", expiresAt: 1_800_043_200_000 };
    },
    ...overrides,
  });
  return { handlers, calls };
}

function request(body, secret = "checkout-secret", origin = "http://koba-dev.local") {
  return new Request("http://localhost/api/v2/media/token", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
}

test("issues a tenant-scoped reader token only after authorization", async () => {
  const { handlers, calls } = makeHandlers();
  const response = await handlers.POST(request({
    checkoutSessionId: "chk_abcdefghijklmnop",
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.readerToken, "signed.reader.token");
  assert.equal(payload.tenantId, "tenant_1");
  assert.equal(calls.authorize, 1);
  assert.equal(calls.issue, 1);
});

test("rejects malformed session credentials before authorization", async () => {
  const { handlers, calls } = makeHandlers();
  const response = await handlers.POST(request({ checkoutSessionId: "bad" }));
  assert.equal(response.status, 401);
  assert.equal(calls.authorize, 0);
  assert.equal(calls.issue, 0);
});

test("does not mint a token when verified entitlement state is absent", async () => {
  const { handlers, calls } = makeHandlers({ authorizeSession: async () => null });
  const response = await handlers.POST(request({
    checkoutSessionId: "chk_abcdefghijklmnop",
  }));
  assert.equal(response.status, 401);
  assert.equal(calls.issue, 0);
});

test("rejects disallowed origins without touching authorization state", async () => {
  const { handlers, calls } = makeHandlers();
  const response = await handlers.POST(request(
    { checkoutSessionId: "chk_abcdefghijklmnop" },
    "checkout-secret",
    "https://attacker.example"
  ));
  assert.equal(response.status, 403);
  assert.equal(calls.authorize, 0);
  assert.equal(calls.issue, 0);
});

test("returns a neutral service error when signing fails", async () => {
  const { handlers } = makeHandlers({
    issueReaderToken: async () => { throw new Error("key unavailable"); },
  });
  const response = await handlers.POST(request({
    checkoutSessionId: "chk_abcdefghijklmnop",
  }));
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.success, false);
  assert.equal(String(payload.error).includes("key"), false);
});
