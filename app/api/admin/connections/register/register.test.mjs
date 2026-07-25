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

const { createConnectionRegistrationHandlers } = await import("./handler.ts");

const ORIGIN = "http://localhost:3000";
const OWNER = {
  uid: "owner-1",
  email: "owner@example.com",
  studioKey: "OWNER-STUDIO",
  accessScope: "full",
};

function makeRequest(body, origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/admin/connections/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

function createHarness(overrides = {}) {
  const calls = { fetch: [], secret: [], writes: [] };
  const document = {
    async get() {
      return { exists: false, data: () => undefined };
    },
    async set(value, options) {
      calls.writes.push({ value, options });
    },
  };
  const secretManager = {
    async createSecret(request) {
      calls.secret.push({ method: "createSecret", request });
    },
    async addSecretVersion(request) {
      calls.secret.push({
        method: "addSecretVersion",
        request: {
          ...request,
          payload: { data: Buffer.from(request.payload.data) },
        },
      });
    },
    async getIamPolicy(request) {
      calls.secret.push({ method: "getIamPolicy", request });
      return [{ bindings: [{ role: "roles/viewer", members: ["user:a@example.com"] }] }];
    },
    async setIamPolicy(request) {
      calls.secret.push({ method: "setIamPolicy", request });
    },
  };
  const dependencies = {
    db: { collection: () => ({ doc: () => document }) },
    secretManager,
    serverTimestamp: () => ({ serverTimestamp: true }),
    loadConfiguration: () => ({
      secretProjectId: "jubilee-command-center---dev",
      secretProjectNumber: "751521788548",
      workerServiceAccount:
        "content-worker-dev@jubilee-command-center---dev.iam.gserviceaccount.com",
      ownerEmails: ["owner@example.com"],
      allowedOrigins: [ORIGIN],
    }),
    readSessionToken: async () => "signed-session",
    verifySession: async () => OWNER,
    resolvePublicHostname: async () => undefined,
    fetchImpl: async (url, options) => {
      calls.fetch.push({ url, options });
      return new Response(
        url.includes("/users/me")
          ? JSON.stringify({
              id: 42,
              capabilities: { edit_posts: true, upload_files: true },
            })
          : "{}",
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
    ...overrides,
  };
  return {
    calls,
    handlers: createConnectionRegistrationHandlers(dependencies),
  };
}

const validBody = {
  studioKey: "STUDIO-1234",
  targetWpOrigin: "https://author.example.com",
  wpUsername: "author",
  wpAppPassword: "test-only-app-password",
};

test("requires a signed owner session before any external side effect", async () => {
  const harness = createHarness({ readSessionToken: async () => null });
  const response = await harness.handlers.POST(makeRequest(validBody));
  assert.equal(response.status, 401);
  assert.equal(harness.calls.fetch.length, 0);
  assert.equal(harness.calls.secret.length, 0);
  assert.equal(harness.calls.writes.length, 0);
});

test("rejects a full-scope user who is not explicitly owner-allowlisted", async () => {
  const harness = createHarness({
    verifySession: async () => ({ ...OWNER, email: "author@example.com" }),
  });
  const response = await harness.handlers.POST(makeRequest(validBody));
  assert.equal(response.status, 403);
  assert.equal(harness.calls.fetch.length, 0);
});

test("does not provision a secret when WordPress preflight fails", async () => {
  const harness = createHarness({
    fetchImpl: async () => new Response("Unauthorized", { status: 401 }),
  });
  const response = await harness.handlers.POST(makeRequest(validBody));
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(
    payload.error,
    "WordPress authentication failed. Please check the URL, Username, and Application Password."
  );
  assert.equal(harness.calls.secret.length, 0);
  assert.equal(harness.calls.writes.length, 0);
});

test("preflights WordPress, provisions numeric-project secret, grants worker access, and writes connection", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(makeRequest(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(harness.calls.fetch.length, 2);
  assert.equal(
    harness.calls.fetch[0].url,
    "https://author.example.com/wp-json/wp/v2/users/me?context=edit"
  );
  assert.equal(
    harness.calls.fetch[1].url,
    "https://author.example.com/wp-json/wp/v2/types/post?context=edit"
  );
  assert.match(harness.calls.fetch[0].options.headers.Authorization, /^Basic /);

  const addVersion = harness.calls.secret.find(
    (call) => call.method === "addSecretVersion"
  );
  assert.equal(
    addVersion.request.parent,
    "projects/jubilee-command-center---dev/secrets/WP_CREDS_STUDIO-1234"
  );
  assert.deepEqual(JSON.parse(addVersion.request.payload.data.toString("utf8")), {
    wordpressUrl: "https://author.example.com",
    username: "author",
    applicationPassword: "test-only-app-password",
  });

  const setPolicy = harness.calls.secret.find(
    (call) => call.method === "setIamPolicy"
  );
  assert.ok(
    setPolicy.request.policy.bindings.some(
      (binding) =>
        binding.role === "roles/secretmanager.secretAccessor" &&
        binding.members.includes(
          "serviceAccount:content-worker-dev@jubilee-command-center---dev.iam.gserviceaccount.com"
        )
    )
  );
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(
    harness.calls.writes[0].value.secretCredentialRef,
    "projects/751521788548/secrets/WP_CREDS_STUDIO-1234/versions/latest"
  );
  assert.equal(harness.calls.writes[0].value.status, "active");
  assert.equal(harness.calls.writes[0].value.verificationStatus, "verified");
  assert.equal(JSON.stringify(payload).includes("test-only-app-password"), false);
  assert.equal("secretCredentialRef" in payload.connection, false);
});

test("rejects untrusted request origins before authentication", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(
    makeRequest(validBody, "https://malicious.example")
  );
  assert.equal(response.status, 403);
  assert.equal(harness.calls.fetch.length, 0);
});
