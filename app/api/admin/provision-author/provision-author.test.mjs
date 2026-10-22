import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) return { shortCircuit: true, url: pathToFileURL(path.join(projectRoot, `${specifier.slice(2)}.ts`)).href };
    return nextResolve(specifier, context);
  },
});

const { createProvisionAuthorHandlers } = await import("./handler.ts");
const ORIGIN = "http://localhost:3000";
const OWNER = { uid: "owner", email: "owner@example.com", studioKey: "OWNER", accessScope: "full" };

function request(body, origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/admin/provision-author`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

function harness(overrides = {}) {
  const calls = [];
  const dependencies = {
    readSessionToken: async () => "session",
    verifySession: async () => OWNER,
    ownerEmails: [OWNER.email],
    allowedOrigins: [ORIGIN],
    createIdempotencyKey: (email) => `manual:${email}`,
    provisionAuthor: async (input) => {
      calls.push(input);
      return {
        studioKey: "KOBA-AUDIO-0123456789ABCDEF",
        created: calls.length === 1,
        welcomeEmailSent: input.welcomeDelivery === "send",
        welcomeEmailStatus: input.welcomeDelivery === "send" ? "sent" : "deferred",
      };
    },
    ...overrides,
  };
  return { calls, handlers: createProvisionAuthorHandlers(dependencies) };
}

const author = { authorName: "Sharon Example", authorEmail: "SHARON@example.com" };

test("owner may provision audiobook and e-reader access while deferring welcome delivery", async () => {
  const h = harness();
  const response = await h.handlers.POST(request({
    ...author,
    hasAudiobookPlayer: true,
    hasEreader: true,
    welcomeDelivery: "defer",
  }));
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.welcomeEmailStatus, "deferred");
  assert.equal(payload.welcomeEmailSent, false);
  assert.deepEqual(h.calls[0], {
    authorName: "Sharon Example",
    authorEmail: "sharon@example.com",
    source: "manual_owner",
    idempotencyKey: "manual:sharon@example.com",
    hasAudiobookPlayer: true,
    hasEreader: true,
    welcomeDelivery: "defer",
  });
});

test("explicit later send reuses the same idempotency identity and existing workspace", async () => {
  const h = harness();
  await h.handlers.POST(request({ ...author, welcomeDelivery: "defer" }));
  const response = await h.handlers.POST(request({ ...author, welcomeDelivery: "send" }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.studioKey, "KOBA-AUDIO-0123456789ABCDEF");
  assert.equal(payload.welcomeEmailStatus, "sent");
  assert.equal(h.calls[0].idempotencyKey, h.calls[1].idempotencyKey);
});

test("default request preserves audiobook-only and immediate welcome behavior", async () => {
  const h = harness();
  const response = await h.handlers.POST(request(author));
  assert.equal(response.status, 201);
  assert.equal(h.calls[0].hasAudiobookPlayer, true);
  assert.equal(h.calls[0].hasEreader, false);
  assert.equal(h.calls[0].welcomeDelivery, "send");
});

test("no capability fails before provisioning", async () => {
  const h = harness();
  const response = await h.handlers.POST(request({ ...author, hasAudiobookPlayer: false, hasEreader: false }));
  assert.equal(response.status, 400);
  assert.equal(h.calls.length, 0);
});

test("non-owner and untrusted origins fail before provisioning", async () => {
  const h = harness({ verifySession: async () => ({ ...OWNER, email: "author@example.com" }) });
  assert.equal((await h.handlers.POST(request(author))).status, 403);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.handlers.POST(request(author, "https://evil.example"))).status, 500);
  assert.equal(h.calls.length, 0);
});
