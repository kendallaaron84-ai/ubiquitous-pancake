import assert from "node:assert/strict";
import test from "node:test";

import { establishReaderIdentity } from "../reader-auth.ts";
import { createAnonymousFreeMediaHandoffHandler, createReaderMediaHandoffExchangeHandler, createReaderMediaHandoffHandler } from "../reader-media-handoff.ts";
import { READER_SESSION_COOKIE, serializeReaderSessionCookie } from "../reader-session-cookie.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

function encoded(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function mediaJwt() { return `${encoded({ alg: "none" })}.${encoded({ exp: 2_000_000_000, principalType: "firebase_uid" })}.signature`; }
function freeMediaJwt() { return `${encoded({ alg: "none" })}.${encoded({ exp: 2_000_000_000, principalType: "anonymous_free", tenantId: "studio_a", assetId: "abk_free", origin: "https://author.example" })}.signature`; }
function product(overrides = {}) { return { studioKey: "studio_a", status: "published", isPublished: true, wordpressDeployment: { status: "deployed", targetWpOrigin: "https://author.example", publicationUrl: "https://author.example/koba_publication/book/" }, ...overrides }; }

async function setup(source = "purchase", status = "active") {
  const db = createMemoryDb({ "products/abk_book": product() });
  const identity = await establishReaderIdentity(db, { uid: "reader_uid", email: "reader@example.com", email_verified: true, name: "Reader", firebase: { sign_in_provider: "password" } }, "identity");
  db.docs.set("reader_entitlements/entitlement", { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_book", source, status });
  const cookie = serializeReaderSessionCookie({ sessionId: identity.sessionId, token: identity.token });
  const dependencies = { db, issueToken: async () => mediaJwt() };
  return { db, cookie, dependencies };
}

async function createHandoff(dependencies, cookie, body = { assetId: "abk_book" }) {
  const response = await createReaderMediaHandoffHandler(dependencies)(new Request("https://dashboard.koba-i.com/api/reader/media/handoff", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie: `${READER_SESSION_COOKIE}=${cookie}` } : {}) }, body: JSON.stringify(body) }));
  return { response, payload: await response.json() };
}

function fragmentCredential(launchUrl) { return decodeURIComponent(new URL(launchUrl).hash.split("=")[1]); }
async function exchange(dependencies, handoff, origin = "https://author.example", assetId = "abk_book") {
  const response = await createReaderMediaHandoffExchangeHandler(dependencies)(new Request("https://dashboard.koba-i.com/api/reader/media/handoff/exchange", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ handoff, assetId }) }));
  return { response, payload: await response.json() };
}

for (const source of ["purchase", "promotion"]) {
  test(`${source} entitlement completes Bookshelf-to-author-site Firebase UID handoff`, async () => {
    const { cookie, dependencies } = await setup(source);
    const created = await createHandoff(dependencies, cookie);
    assert.equal(created.response.status, 200);
    assert.equal(new URL(created.payload.launchUrl).origin, "https://author.example");
    assert.equal(new URL(created.payload.launchUrl).search, "");
    const result = await exchange(dependencies, fragmentCredential(created.payload.launchUrl));
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.principalType, "firebase_uid");
    assert.equal(result.payload.tenantId, "studio_a");
    assert.equal(result.payload.readerToken, mediaJwt());
  });
}

test("anonymous Bookshelf request fails closed", async () => {
  const { dependencies } = await setup();
  const result = await createHandoff(dependencies, null);
  assert.equal(result.response.status, 401);
  assert.equal(result.payload.code, "READER_SESSION_INVALID");
});

test("wrong author origin fails closed without consuming a valid handoff", async () => {
  const { cookie, dependencies } = await setup();
  const created = await createHandoff(dependencies, cookie);
  const credential = fragmentCredential(created.payload.launchUrl);
  assert.equal((await exchange(dependencies, credential, "https://attacker.example")).response.status, 401);
  assert.equal((await exchange(dependencies, credential)).response.status, 200);
});

test("expired and replayed handoffs fail closed", async () => {
  const { db, cookie, dependencies } = await setup();
  const created = await createHandoff(dependencies, cookie);
  const credential = fragmentCredential(created.payload.launchUrl);
  const sessionId = credential.split(".")[0];
  db.docs.get(`reader_sessions/${sessionId}`).expiresAt = { toDate: () => new Date(0) };
  assert.equal((await exchange(dependencies, credential)).response.status, 401);

  const fresh = await createHandoff(dependencies, cookie);
  const freshCredential = fragmentCredential(fresh.payload.launchUrl);
  assert.equal((await exchange(dependencies, freshCredential)).response.status, 200);
  assert.equal((await exchange(dependencies, freshCredential)).response.status, 401);
});

for (const status of ["revoked", "refunded", "suspended"]) {
  test(`${status} entitlement cannot create a handoff`, async () => {
    const { cookie, dependencies } = await setup("purchase", status);
    const result = await createHandoff(dependencies, cookie);
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "READER_MEDIA_ENTITLEMENT_REQUIRED");
  });
}

test("cross-tenant entitlement and browser authority fields fail closed", async () => {
  const { db, cookie, dependencies } = await setup();
  db.docs.set("products/abk_book", product({ studioKey: "studio_b" }));
  assert.equal((await createHandoff(dependencies, cookie)).response.status, 403);
  db.docs.set("products/abk_book", product());
  assert.equal((await createHandoff(dependencies, cookie, { assetId: "abk_book", readerUid: "other" })).response.status, 400);
});

test("verified human receives one-use free handoff and 72-hour anonymous media principal without an entitlement", async () => {
  const db = createMemoryDb({ "products/abk_free": product({ assetId: "abk_free", isFree: true, wordpressDeployment: { status: "deployed", targetWpOrigin: "https://author.example", publicationUrl: "https://author.example/koba_publication/free/" } }) });
  let humanChecks = 0;
  const dependencies = {
    db,
    verifyHuman: async ({ token, assetId }) => { humanChecks += 1; assert.equal(token, "turnstile-token"); assert.equal(assetId, "abk_free"); },
    issueToken: async (input) => { assert.equal(input.principalType, "anonymous_free"); assert.equal(input.assetId, "abk_free"); assert.equal(input.origin, "https://author.example"); return freeMediaJwt(); },
  };
  const createdResponse = await createAnonymousFreeMediaHandoffHandler(dependencies)(new Request("https://dashboard.koba-i.com/api/reader/media/free-handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: "abk_free", turnstileToken: "turnstile-token" }) }));
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200);
  assert.equal(humanChecks, 1);
  assert.match(new URL(created.launchUrl).hash, /^#koba_reader_handoff=free\./);
  assert.equal([...db.docs.keys()].some((key) => key.startsWith("reader_entitlements/")), false);
  const credential = fragmentCredential(created.launchUrl);
  const exchanged = await exchange(dependencies, credential, "https://author.example", "abk_free");
  assert.equal(exchanged.response.status, 200);
  assert.equal(exchanged.payload.principalType, "anonymous_free");
  assert.equal((await exchange(dependencies, credential, "https://author.example", "abk_free")).response.status, 401);
});

test("failed human verification performs no product or handoff write", async () => {
  const db = createMemoryDb({ "products/abk_free": product({ isFree: true }) });
  const dependencies = { db, verifyHuman: async () => { throw new Error("blocked"); }, issueToken: async () => freeMediaJwt() };
  const response = await createAnonymousFreeMediaHandoffHandler(dependencies)(new Request("https://dashboard.koba-i.com/api/reader/media/free-handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: "abk_free", turnstileToken: "bad" }) }));
  assert.equal(response.status, 401);
  assert.equal([...db.docs.keys()].some((key) => key.startsWith("reader_free_handoffs/")), false);
});

test("paid-only publication cannot enter anonymous free handoff", async () => {
  const db = createMemoryDb({ "products/abk_paid": product({ price: 12.99 }) });
  const dependencies = { db, verifyHuman: async () => {}, issueToken: async () => freeMediaJwt() };
  const response = await createAnonymousFreeMediaHandoffHandler(dependencies)(new Request("https://dashboard.koba-i.com/api/reader/media/free-handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: "abk_paid", turnstileToken: "ok" }) }));
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.code, "READER_MEDIA_FREE_ACCESS_REQUIRED");
});
