import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export {};" };
  if (specifier.startsWith("@/")) return { shortCircuit: true, url: pathToFileURL(path.join(projectRoot, `${specifier.slice(2)}.ts`)).href };
  return nextResolve(specifier, context);
} });

const { createAuthorQueueHandlers } = await import("./handler.ts");
const { classifyAuthorOnboardingState, listAuthorOnboardingQueue } = await import("../../../../core/security/author-onboarding-queue.ts");
const owner = { uid: "owner", email: "owner@example.com", studioKey: "OWNER", accessScope: "full" };
const durable = [{ provisionId: "provision", authorName: "Sharon", authorEmail: "sharon@example.com", maskedStudioKey: "KOBA-AUDIO****1234", capabilities: { hasAudiobookPlayer: true, hasEreader: true }, websiteConnectionStatus: "connected", siteOrigins: ["https://author.example.com"], welcomeEmailStatus: "deferred", welcomeEmailSentAt: null, accountEstablished: false, accountEstablishedAt: null, group: "welcome_deferred", nextAction: "Send welcome package" }];

test("owner queue reloads durable state without exposing secrets", async () => {
  const handlers = createAuthorQueueHandlers({ readSessionToken: async () => "session", verifySession: async () => owner, ownerEmails: [owner.email], loadQueue: async () => durable });
  const response = await handlers.GET();
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.authors[0].welcomeEmailStatus, "deferred");
  assert.equal(payload.authors[0].siteOrigins[0], "https://author.example.com");
  assert.equal(JSON.stringify(payload).includes("secretCredentialRef"), false);
  assert.equal(JSON.stringify(payload).includes("ApplicationPassword"), false);
});

test("queue is owner-only", async () => {
  const handlers = createAuthorQueueHandlers({ readSessionToken: async () => "session", verifySession: async () => ({ ...owner, email: "author@example.com" }), ownerEmails: [owner.email], loadQueue: async () => durable });
  assert.equal((await handlers.GET()).status, 403);
});

test("durable queue states map to the approved owner groupings", () => {
  assert.equal(classifyAuthorOnboardingState({ accountEstablished: false, connected: false, welcomeEmailStatus: "pending" }), "needs_setup");
  assert.equal(classifyAuthorOnboardingState({ accountEstablished: false, connected: true, welcomeEmailStatus: "deferred" }), "welcome_deferred");
  assert.equal(classifyAuthorOnboardingState({ accountEstablished: false, connected: true, welcomeEmailStatus: "failed" }), "welcome_failed");
  assert.equal(classifyAuthorOnboardingState({ accountEstablished: false, connected: true, welcomeEmailStatus: "sent" }), "welcome_sent_awaiting_account");
  assert.equal(classifyAuthorOnboardingState({ accountEstablished: true, connected: true, welcomeEmailStatus: "sent" }), "active");
  assert.equal(classifyAuthorOnboardingState({ accountEstablished: true, connected: false, welcomeEmailStatus: "sent" }), "needs_setup");
});

test("durable records are joined into one safe queue row", async () => {
  const db = fakeQueueDatabase({
    provision: { studioKey: "KOBA-AUDIO-0123456789ABCDEF", authorEmail: "sharon@example.com", authorName: "Sharon", welcomeEmailStatus: "sent", welcomeEmailSentAt: "2026-08-08T12:00:00.000Z" },
    license: { studioKey: "KOBA-AUDIO-0123456789ABCDEF", authorEmail: "sharon@example.com", hasAudiobookPlayer: true, hasEreader: true, status: "active", secretCredentialRef: "must-not-leak" },
    user: { email: "sharon@example.com", authConfigured: true, accountEstablishedAt: "2026-08-08T13:00:00.000Z" },
    connection: { status: "active", verificationStatus: "verified", targetWpOrigin: "https://author.example.com", wpUsername: "must-not-leak" },
  });
  const items = await listAuthorOnboardingQueue(db);
  assert.equal(items.length, 1);
  assert.equal(items[0].group, "active");
  assert.equal(items[0].maskedStudioKey.includes("0123456789ABCDEF"), false);
  assert.deepEqual(items[0].siteOrigins, ["https://author.example.com"]);
  assert.equal(JSON.stringify(items).includes("must-not-leak"), false);
});

test("Owner Control Plane reloads the queue and reuses the existing welcome action", async () => {
  const source = await readFile(path.join(projectRoot, "app/admin/connections/page.tsx"), "utf8");
  assert.match(source, /fetch\("\/api\/admin\/authors"/);
  assert.match(source, /fetch\("\/api\/admin\/provision-author"/);
  assert.match(source, /Send welcome package now/);
  assert.match(source, /welcomeEmailStatus === "deferred" \|\| author\.welcomeEmailStatus === "failed"/);
});

function fakeQueueDatabase({ provision, license, user, connection }) {
  const emptyWebsites = { docs: [] };
  const snapshot = (id, data) => ({ id, exists: Boolean(data), data: () => data });
  return {
    collection(name) {
      if (name === "plugin_license_provisions") return { async get() { return { docs: [{ id: "provision", data: () => provision }] }; } };
      if (name === "plugin_licenses") return { doc() { return { async get() { return snapshot("license", license); } }; } };
      if (name === "users") return { doc() { return { async get() { return snapshot("user", user); } }; } };
      if (name === "connections") return { doc() { return { async get() { return snapshot("connection", connection); }, collection() { return { async get() { return emptyWebsites; } }; } }; } };
      throw new Error(`Unexpected collection ${name}`);
    },
  };
}
