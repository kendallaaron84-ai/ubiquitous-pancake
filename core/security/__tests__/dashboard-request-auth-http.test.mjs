import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return nextResolve("next/headers.js", context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return { shortCircuit: true, url: pathToFileURL(path.join(projectRoot, `${specifier.slice(2)}.ts`)).href };
    }
    return nextResolve(specifier, context);
  },
});

const { authenticateDashboardRequest } = await import("../dashboard-request-auth.ts");
const { activeLicenseBelongsToSession } = await import("../content-engine-access.ts");
const { createSessionStatusHandler } = await import("../../../app/api/session/handler.ts");

const SESSION = {
  uid: "uid-author",
  email: "author@example.com",
  studioKey: "STUDIO-A",
  accessScope: "mvp",
};

function dependencies(overrides = {}) {
  return {
    readSessionCookie: async (request) => /(?:^|;\s*)session-token=([^;]+)/.exec(request.headers.get("cookie") || "")?.[1] || null,
    verifySession: async (token) => {
      if (token !== "valid-cookie") throw new Error("expired");
      return SESSION;
    },
    verifyIdToken: async (token) => {
      if (token !== "valid-bearer") throw new Error("invalid-or-expired");
      return { uid: SESSION.uid, email: SESSION.email };
    },
    loadUserProfile: async () => ({ email: SESSION.email, studioKey: SESSION.studioKey }),
    resolveAccessScope: () => "mvp",
    ...overrides,
  };
}

async function sessionStatusHttp(request, authDependencies, license, counters = { access: 0, connection: 0 }) {
  const handler = createSessionStatusHandler({
    authenticate: (incoming) => authenticateDashboardRequest(incoming, authDependencies),
    async loadAccess(session) {
      counters.access += 1;
      return {
        hasContentEngineAccess: false,
        hasOwnedActiveLicense: activeLicenseBelongsToSession(session, true, license),
        userData: {},
        licenseData: license,
      };
    },
    async loadConnection() {
      counters.connection += 1;
      return { exists: false, data: {} };
    },
    ownerEmails: [],
  });
  return handler(request);
}

const ownedLicense = { status: "active", authorEmail: SESSION.email };

test("HTTP cookie authentication reaches an owned-license handler", async () => {
  const response = await sessionStatusHttp(new Request("https://dashboard.test/api/session", {
    headers: { Cookie: "session-token=valid-cookie" },
  }), dependencies(), ownedLicense);
  assert.equal(response.status, 200);
});

test("HTTP Firebase Bearer authentication reaches an owned-license handler", async () => {
  const response = await sessionStatusHttp(new Request("https://dashboard.test/api/session", {
    headers: { Authorization: "Bearer valid-bearer" },
  }), dependencies(), ownedLicense);
  assert.equal(response.status, 200);
});

test("HTTP authentication fails closed when credentials are missing", async () => {
  const counters = { access: 0, connection: 0 };
  const response = await sessionStatusHttp(new Request("https://dashboard.test/api/session"), dependencies(), ownedLicense, counters);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "DASHBOARD_AUTHENTICATION_REQUIRED");
  assert.deepEqual(counters, { access: 0, connection: 0 });
});

test("HTTP authentication rejects expired or invalid cookie credentials", async () => {
  const response = await sessionStatusHttp(new Request("https://dashboard.test/api/session", {
    headers: { Cookie: "session-token=expired-cookie" },
  }), dependencies(), ownedLicense);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "DASHBOARD_SESSION_INVALID");
});

test("HTTP authentication rejects expired or invalid Firebase Bearer credentials", async () => {
  const response = await sessionStatusHttp(new Request("https://dashboard.test/api/session", {
    headers: { Authorization: "Bearer expired-bearer" },
  }), dependencies(), ownedLicense);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "DASHBOARD_BEARER_INVALID");
});

test("HTTP owned-license boundary rejects a cross-license identity", async () => {
  const counters = { access: 0, connection: 0 };
  const response = await sessionStatusHttp(new Request("https://dashboard.test/api/session", {
    headers: { Authorization: "Bearer valid-bearer" },
  }), dependencies(), { status: "active", authorEmail: "other@example.com" }, counters);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "STUDIO_KEY_OWNERSHIP_MISMATCH");
  assert.deepEqual(counters, { access: 1, connection: 0 });
});

test("HTTP Bearer profile ownership mismatch fails before license access", async () => {
  const response = await sessionStatusHttp(new Request("https://dashboard.test/api/session", {
    headers: { Authorization: "Bearer valid-bearer" },
  }), dependencies({ loadUserProfile: async () => ({ email: "other@example.com" }) }), ownedLicense);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "DASHBOARD_PROFILE_OWNERSHIP_MISMATCH");
});
