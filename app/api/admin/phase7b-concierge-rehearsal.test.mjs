import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
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

const { createProvisionAuthorHandlers } = await import("./provision-author/handler.ts");
const { createModernConnectionRegistrationHandlers } = await import("./connections/register/modern-handler.ts");

const ORIGIN = "http://localhost:3000";
const OWNER = {
  uid: "fixture-owner",
  email: "owner@example.test",
  studioKey: "OWNER",
  accessScope: "full",
};
const FIXTURE_STUDIO_KEY = "KOBA-AUDIO-0123456789ABCDEF";
const FIXTURE_AUTHOR = "fixture.author@example.test";

function request(pathname, body) {
  return new Request(`${ORIGIN}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

function createFixture() {
  const state = {
    author: null,
    welcomeSendCount: 0,
    gatewayCalls: 0,
    persistCalls: 0,
    authorizedSites: [],
  };

  const provisioning = createProvisionAuthorHandlers({
    readSessionToken: async () => "fixture-session",
    verifySession: async () => OWNER,
    ownerEmails: [OWNER.email],
    allowedOrigins: [ORIGIN],
    createIdempotencyKey: (email) => `phase7b:${email}`,
    provisionAuthor: async (input) => {
      const created = state.author === null;
      if (created) {
        state.author = {
          authorEmail: input.authorEmail,
          studioKey: FIXTURE_STUDIO_KEY,
          hasAudiobookPlayer: input.hasAudiobookPlayer,
          hasEreader: input.hasEreader,
          welcomeEmailStatus: input.welcomeDelivery === "defer" ? "deferred" : "sent",
        };
      }
      if (input.welcomeDelivery === "send") {
        state.welcomeSendCount += 1;
        state.author.welcomeEmailStatus = "sent";
      }
      return {
        studioKey: state.author.studioKey,
        created,
        welcomeEmailSent: state.author.welcomeEmailStatus === "sent",
        welcomeEmailStatus: state.author.welcomeEmailStatus,
      };
    },
  });

  const connection = createModernConnectionRegistrationHandlers({
    loadConfiguration: () => ({
      firebaseProjectId: "fixture-project",
      ownerEmails: [OWNER.email],
      allowedOrigins: [ORIGIN],
    }),
    readSessionToken: async () => "fixture-session",
    verifySession: async () => OWNER,
    resolvePublicHostname: async () => undefined,
    resolveAuthorOwnership: async (studioKey) => {
      assert.equal(studioKey, state.author?.studioKey);
      return { authorId: state.author.authorEmail };
    },
    websiteConnectionIdForOrigin: () => "site_0123456789abcdef",
    assertWebsiteAvailable: async () => undefined,
    verifyAndProvision: async (input) => {
      state.gatewayCalls += 1;
      return {
        studioKey: input.studioKey,
        targetWpOrigin: input.targetWpOrigin,
        wpUsername: input.wpUsername,
        secretCredentialRef: `projects/fixture/secrets/WP_CREDS_${input.studioKey}_${input.websiteConnectionId}/versions/latest`,
      };
    },
    persistWebsite: async (input) => {
      state.persistCalls += 1;
      const existing = state.authorizedSites.find(
        (site) => site.websiteConnectionId === input.websiteConnectionId || site.origin === input.wordpressOrigin,
      );
      const grant = {
        websiteConnectionId: input.websiteConnectionId,
        origin: input.wordpressOrigin,
        role: input.contentRole,
        status: "active",
      };
      if (existing) Object.assign(existing, grant);
      else state.authorizedSites.push(grant);
      return { grant };
    },
  });

  return { state, provisioning, connection };
}

test("Phase 7B fixture provisions silently, selects capabilities, and creates one tenant-scoped modern grant", async () => {
  const fixture = createFixture();
  const provisionResponse = await fixture.provisioning.POST(request("/api/admin/provision-author", {
    authorName: "Phase Seven Fixture",
    authorEmail: FIXTURE_AUTHOR.toUpperCase(),
    hasAudiobookPlayer: true,
    hasEreader: true,
    welcomeDelivery: "defer",
  }));
  const provision = await provisionResponse.json();

  assert.equal(provisionResponse.status, 201);
  assert.equal(provision.studioKey, FIXTURE_STUDIO_KEY);
  assert.equal(provision.welcomeEmailStatus, "deferred");
  assert.equal(fixture.state.welcomeSendCount, 0);
  assert.equal(fixture.state.author.hasAudiobookPlayer, true);
  assert.equal(fixture.state.author.hasEreader, true);

  const connectResponse = await fixture.connection.POST(request("/api/admin/connections/register", {
    studioKey: provision.studioKey,
    targetWpOrigin: "https://fixture-author.example.test/",
    wpUsername: "fixture-author",
    wpAppPassword: "fixture-only-not-a-real-secret",
    contentRole: "both",
  }));
  const connected = await connectResponse.json();

  assert.equal(connectResponse.status, 200);
  assert.equal(fixture.state.gatewayCalls, 1);
  assert.equal(fixture.state.persistCalls, 1);
  assert.equal(connected.connection.websiteConnectionId, "site_0123456789abcdef");
  assert.deepEqual(fixture.state.authorizedSites, [{
    websiteConnectionId: "site_0123456789abcdef",
    origin: "https://fixture-author.example.test",
    role: "both",
    status: "active",
  }]);
  assert.equal(JSON.stringify(connected).includes("fixture-only-not-a-real-secret"), false);
  assert.equal(JSON.stringify(connected).includes("secretCredentialRef"), false);

  const repeated = await fixture.provisioning.POST(request("/api/admin/provision-author", {
    authorName: "Phase Seven Fixture",
    authorEmail: FIXTURE_AUTHOR,
    hasAudiobookPlayer: true,
    hasEreader: true,
    welcomeDelivery: "defer",
  }));
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).studioKey, FIXTURE_STUDIO_KEY);

  const repeatedConnection = await fixture.connection.POST(request("/api/admin/connections/register", {
    studioKey: FIXTURE_STUDIO_KEY,
    targetWpOrigin: "https://fixture-author.example.test",
    wpUsername: "fixture-author",
    wpAppPassword: "fixture-only-not-a-real-secret",
    contentRole: "both",
  }));
  assert.equal(repeatedConnection.status, 200);
  assert.equal(fixture.state.authorizedSites.length, 1);
});

test("Phase 7B gateway failure creates no website grant and sends no welcome", async () => {
  const fixture = createFixture();
  await fixture.provisioning.POST(request("/api/admin/provision-author", {
    authorName: "Phase Seven Fixture",
    authorEmail: FIXTURE_AUTHOR,
    hasAudiobookPlayer: true,
    hasEreader: false,
    welcomeDelivery: "defer",
  }));
  fixture.connection = createModernConnectionRegistrationHandlers({
    loadConfiguration: () => ({ firebaseProjectId: "fixture-project", ownerEmails: [OWNER.email], allowedOrigins: [ORIGIN] }),
    readSessionToken: async () => "fixture-session",
    verifySession: async () => OWNER,
    resolvePublicHostname: async () => undefined,
    resolveAuthorOwnership: async () => ({ authorId: FIXTURE_AUTHOR }),
    websiteConnectionIdForOrigin: () => "site_0123456789abcdef",
    assertWebsiteAvailable: async () => undefined,
    verifyAndProvision: async () => { throw new Error("fixture gateway failure"); },
    persistWebsite: async () => {
      fixture.state.persistCalls += 1;
      throw new Error("must not be called");
    },
  });

  const response = await fixture.connection.POST(request("/api/admin/connections/register", {
    studioKey: FIXTURE_STUDIO_KEY,
    targetWpOrigin: "https://fixture-author.example.test",
    wpUsername: "fixture-author",
    wpAppPassword: "fixture-only-not-a-real-secret",
    contentRole: "both",
  }));

  assert.equal(response.status, 503);
  assert.equal(fixture.state.persistCalls, 0);
  assert.equal(fixture.state.authorizedSites.length, 0);
  assert.equal(fixture.state.welcomeSendCount, 0);
});
