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

const { AuthorInvitationError, buildAuthorInvitationUrl, createAuthorInvitationEnvelope, establishAuthorInvitation, resolveAuthorInvitation } = await import("../../../../core/security/author-invitation.ts");
const { createAuthorInvitationHandlers } = await import("./handler.ts");

test("account-establishment URL carries only an opaque expiring invitation", () => {
  const envelope = createAuthorInvitationEnvelope(1_000, "A".repeat(43));
  const url = new URL(buildAuthorInvitationUrl(envelope.token, { KOBA_DASHBOARD_URL: "https://dashboard.koba-i.com" }));
  assert.equal(url.pathname, "/setup-password");
  assert.equal(url.searchParams.get("invite"), envelope.token);
  assert.equal(url.searchParams.has("email"), false);
  assert.equal(url.searchParams.has("license"), false);
  assert.equal(envelope.expiresAt > 1_000, true);
});

test("resolve returns only safe locked identity fields", async () => {
  const handlers = createAuthorInvitationHandlers({
    resolve: async () => ({ authorEmail: "author@example.com", authorName: "Author", expiresAt: Date.now() + 1_000 }),
    establish: async () => ({ customToken: "custom", email: "author@example.com" }),
  });
  const response = await handlers.GET(new Request("https://dashboard.koba-i.com/api/auth/invitation?token=opaque"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.invitation.authorEmail, "author@example.com");
  assert.equal(JSON.stringify(payload).includes("studioKey"), false);
});

test("used and expired invitations preserve stable HTTP contracts", async () => {
  for (const [status, code] of [[410, "AUTHOR_INVITATION_USED"], [410, "AUTHOR_INVITATION_EXPIRED"]]) {
    const handlers = createAuthorInvitationHandlers({
      resolve: async () => { throw new AuthorInvitationError(status, code, "Unavailable"); },
      establish: async () => { throw new Error("unused"); },
    });
    const response = await handlers.GET(new Request("https://dashboard.koba-i.com/api/auth/invitation?token=opaque"));
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
});

test("successful establishment returns the Firebase custom token for the existing login exchange", async () => {
  const calls = [];
  const handlers = createAuthorInvitationHandlers({
    resolve: async () => { throw new Error("unused"); },
    establish: async (input) => { calls.push(input); return { customToken: "firebase-custom", email: "author@example.com" }; },
  });
  const response = await handlers.POST(new Request("https://dashboard.koba-i.com/api/auth/invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "A".repeat(43), password: "Valid!234" }) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).customToken, "firebase-custom");
  assert.deepEqual(calls, [{ token: "A".repeat(43), password: "Valid!234" }]);
});

test("first-login UI contains no phone collection or editable StudioKey", async () => {
  const source = await readFile(path.join(projectRoot, "app/setup-password/page.tsx"), "utf8");
  assert.equal(source.includes('type="tel"'), false);
  assert.equal(source.includes("licenseParam"), false);
  assert.equal(source.includes("studioKey"), false);
  assert.match(source, /signInWithCustomToken/);
  assert.match(source, /\/api\/login/);
});

test("the dormant unsigned activation boundary is retired", async () => {
  const source = await readFile(path.join(projectRoot, "app/api/auth/activate/route.ts"), "utf8");
  assert.match(source, /AUTHOR_ACTIVATION_REPLACED/);
  assert.match(source, /status:\s*410/);
  assert.equal(source.includes('.collection("licenses")'), false);
  assert.equal(source.includes("request.json"), false);
});

test("authoritative plugin license ownership is required and successful redemption is single use", async () => {
  const token = "B".repeat(43);
  const envelope = createAuthorInvitationEnvelope(Date.now(), token);
  const provisionPath = "plugin_license_provisions/provision";
  const licensePath = "plugin_licenses/KOBA-AUDIO-0123456789ABCDEF";
  const rows = new Map([
    [provisionPath, { studioKey: "KOBA-AUDIO-0123456789ABCDEF", authorEmail: "author@example.com", authorName: "Author", welcomeInvitationTokenHash: envelope.tokenHash, welcomeInvitationStatus: "active", welcomeInvitationExpiresAt: envelope.expiresAt }],
    [licensePath, { studioKey: "KOBA-AUDIO-0123456789ABCDEF", authorEmail: "wrong@example.com", status: "active" }],
  ]);
  const db = fakeDatabase(rows);
  await assert.rejects(() => resolveAuthorInvitation(db, token), (error) => error.code === "AUTHOR_INVITATION_OWNERSHIP_MISMATCH");
  rows.set(licensePath, { studioKey: "KOBA-AUDIO-0123456789ABCDEF", authorEmail: "author@example.com", status: "active" });
  const auth = {
    async getUserByEmail() { const error = new Error("missing"); error.code = "auth/user-not-found"; throw error; },
    async createUser(input) { return { uid: "firebase-author", email: input.email, displayName: input.displayName }; },
    async updateUser() { throw new Error("unused"); },
    async createCustomToken(uid) { return `custom-${uid}`; },
  };
  const result = await establishAuthorInvitation(db, auth, { token, password: "Secure!234" });
  assert.equal(result.customToken, "custom-firebase-author");
  assert.equal(rows.get("users/author@example.com").authConfigured, true);
  assert.equal(rows.get(licensePath).authConfigured, true);
  await assert.rejects(() => resolveAuthorInvitation(db, token), (error) => error.code === "AUTHOR_INVITATION_USED");
});

function fakeDatabase(rows) {
  const ref = (path) => ({ path, async get() { return snap(path); }, async set(data, options) { rows.set(path, options?.merge ? { ...(rows.get(path) || {}), ...data } : data); } });
  const snap = (path) => ({ id: path.split("/").at(-1), ref: ref(path), exists: rows.has(path), data: () => rows.get(path) });
  const collection = (name) => ({
    doc(id) { return ref(`${name}/${id}`); },
    where(field, _operator, value) { return { limit() { return { async get() { const docs = [...rows.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/").length === 2 && data[field] === value).map(([path]) => snap(path)); return { empty: docs.length === 0, docs }; } }; } }; },
  });
  return {
    collection,
    async runTransaction(work) { return work({ async get(reference) { return reference.get(); }, update(reference, data) { rows.set(reference.path, { ...(rows.get(reference.path) || {}), ...data }); }, set(reference, data, options) { rows.set(reference.path, options?.merge ? { ...(rows.get(reference.path) || {}), ...data } : data); } }); },
  };
}
