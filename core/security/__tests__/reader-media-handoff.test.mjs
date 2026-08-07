import assert from "node:assert/strict";
import test from "node:test";

import { establishReaderIdentity } from "../reader-auth.ts";
import { createReaderMediaHandoffExchangeHandler, createReaderMediaHandoffHandler } from "../reader-media-handoff.ts";
import { READER_SESSION_COOKIE, serializeReaderSessionCookie } from "../reader-session-cookie.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

function encoded(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function mediaJwt() { return `${encoded({ alg: "none" })}.${encoded({ exp: 2_000_000_000, principalType: "firebase_uid" })}.signature`; }
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
