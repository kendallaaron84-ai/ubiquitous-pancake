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

const { createModernConnectionRegistrationHandlers } = await import("./modern-handler.ts");
const ORIGIN = "http://localhost:3000";
const OWNER = { uid: "owner", email: "owner@example.com", studioKey: "OWNER", accessScope: "full" };
const body = {
  studioKey: "KOBA-AUDIO-0123456789ABCDEF",
  targetWpOrigin: "https://author.example.com",
  wpUsername: "author",
  wpAppPassword: "test-only-application-password",
  contentRole: "story_world",
};

function request(value = body, origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/admin/connections/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(value),
  });
}

function harness(overrides = {}) {
  const calls = { ownership: [], capacity: [], verify: [], persist: [] };
  const dependencies = {
    loadConfiguration: () => ({
      firebaseProjectId: "author-jubilee-command-center",
      ownerEmails: [OWNER.email],
      allowedOrigins: [ORIGIN],
    }),
    readSessionToken: async () => "session",
    verifySession: async () => OWNER,
    resolvePublicHostname: async () => undefined,
    resolveAuthorOwnership: async (studioKey) => {
      calls.ownership.push(studioKey);
      return { authorId: "author@example.com", primaryUserRef: { path: "users/author@example.com" } };
    },
    websiteConnectionIdForOrigin: () => "site_0123456789abcdef",
    assertWebsiteAvailable: async (input) => calls.capacity.push(input),
    verifyAndProvision: async (input) => {
      calls.verify.push(input);
      return {
        studioKey: input.studioKey,
        targetWpOrigin: input.targetWpOrigin,
        wpUsername: input.wpUsername,
        secretCredentialRef: `projects/400566266819/secrets/WP_CREDS_${input.studioKey}_${input.websiteConnectionId}/versions/latest`,
      };
    },
    persistWebsite: async (input) => {
      calls.persist.push(input);
      return { grant: { websiteConnectionId: input.websiteConnectionId, origin: input.wordpressOrigin, role: input.contentRole, status: "active" } };
    },
    ...overrides,
  };
  return { calls, handlers: createModernConnectionRegistrationHandlers(dependencies) };
}

test("owner flow uses gateway result and persists the authoritative website grant", async () => {
  const h = harness();
  const response = await h.handlers.POST(request());
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls.ownership, [body.studioKey]);
  assert.equal(h.calls.verify.length, 1);
  assert.equal(h.calls.persist.length, 1);
  assert.equal(h.calls.persist[0].authorId, "author@example.com");
  assert.equal(h.calls.persist[0].websiteConnectionId, "site_0123456789abcdef");
  assert.equal(h.calls.persist[0].contentRole, "story_world");
  assert.equal(payload.grant.status, "active");
  assert.equal(JSON.stringify(payload).includes(body.wpAppPassword), false);
  assert.equal(JSON.stringify(payload).includes("secretCredentialRef"), false);
});

test("gateway verification failure writes no website grant", async () => {
  const h = harness({ verifyAndProvision: async () => { throw new Error("gateway unavailable"); } });
  const response = await h.handlers.POST(request());
  assert.equal(response.status, 503);
  assert.equal(h.calls.persist.length, 0);
});

test("missing session and non-owner fail before ownership or gateway calls", async () => {
  const missing = harness({ readSessionToken: async () => null });
  assert.equal((await missing.handlers.POST(request())).status, 401);
  assert.equal(missing.calls.ownership.length, 0);
  assert.equal(missing.calls.verify.length, 0);

  const nonOwner = harness({ verifySession: async () => ({ ...OWNER, email: "author@example.com" }) });
  assert.equal((await nonOwner.handlers.POST(request())).status, 403);
  assert.equal(nonOwner.calls.verify.length, 0);
});

test("exact normalized origin and role are capacity-checked before verification", async () => {
  const h = harness();
  const response = await h.handlers.POST(request({ ...body, targetWpOrigin: "https://AUTHOR.example.com/", contentRole: "business_brand" }));
  assert.equal(response.status, 200);
  assert.equal(h.calls.capacity[0].wordpressOrigin, "https://author.example.com");
  assert.equal(h.calls.capacity[0].contentRole, "business_brand");
  assert.equal(h.calls.verify[0].targetWpOrigin, "https://author.example.com");
});

test("route source wires the shared gateway and modern transaction instead of direct Basic auth", async () => {
  const route = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./route.ts", import.meta.url), "utf8"));
  assert.match(route, /verifyAndProvisionThroughGateway/);
  assert.match(route, /persistVerifiedPluginWebsite/);
  assert.doesNotMatch(route, /Authorization:\s*`Basic/);
  assert.doesNotMatch(route, /addSecretVersion/);
});
