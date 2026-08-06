import assert from "node:assert/strict";
import test from "node:test";

import {
  establishReaderIdentity,
  ReaderAuthError,
  resolveReaderIdentitySession,
} from "../reader-auth.ts";
import {
  parseReaderSessionCookie,
  readReaderSessionCookie,
  READER_SESSION_COOKIE,
  serializeReaderSessionCookie,
} from "../reader-session-cookie.ts";
import { DASHBOARD_SESSION_COOKIE } from "../dashboard-session.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

function passwordClaims(overrides = {}) {
  return {
    uid: "reader_uid_1",
    email: "Reader@Example.com",
    email_verified: true,
    name: "Reader One",
    firebase: { sign_in_provider: "password" },
    ...overrides,
  };
}

test("verified Firebase password identity creates one profile and central reader session", async () => {
  const db = createMemoryDb();
  const result = await establishReaderIdentity(db, passwordClaims(), "phase5a-valid");

  assert.equal(result.readerUid, "reader_uid_1");
  assert.equal(result.email, "reader@example.com");
  assert.equal(db.docs.get("reader_profiles/reader_uid_1").authProvider, "password");
  assert.equal(db.docs.get(`reader_sessions/${result.sessionId}`).scope, "central");
  assert.ok(result.expiresAt.getTime() <= Date.now() + 30 * 86400000);
});

test("unverified email fails before profile or session persistence", async () => {
  const db = createMemoryDb();
  await assert.rejects(
    () => establishReaderIdentity(db, passwordClaims({ email_verified: false }), "phase5a-unverified"),
    (error) =>
      error instanceof ReaderAuthError &&
      error.status === 403 &&
      error.code === "READER_EMAIL_VERIFICATION_REQUIRED"
  );
  assert.equal([...db.docs.keys()].some((key) => key.startsWith("reader_profiles/")), false);
  assert.equal([...db.docs.keys()].some((key) => key.startsWith("reader_sessions/")), false);
});

test("reader identity rejects non-password Firebase providers", async () => {
  const db = createMemoryDb();
  await assert.rejects(
    () =>
      establishReaderIdentity(
        db,
        passwordClaims({ firebase: { sign_in_provider: "google.com" } }),
        "phase5a-provider"
      ),
    (error) =>
      error instanceof ReaderAuthError &&
      error.code === "READER_PASSWORD_PROVIDER_REQUIRED"
  );
  assert.equal(db.docs.size, 0);
});

test("disabled reader cannot obtain a new session", async () => {
  const db = createMemoryDb({
    "reader_profiles/reader_uid_1": {
      uid: "reader_uid_1",
      email: "reader@example.com",
      emailNormalized: "reader@example.com",
      emailVerified: true,
      accountStatus: "disabled",
      authProvider: "password",
    },
  });
  await assert.rejects(
    () => establishReaderIdentity(db, passwordClaims(), "phase5a-disabled"),
    (error) =>
      error instanceof ReaderAuthError &&
      error.code === "READER_ACCOUNT_NOT_ACTIVE"
  );
  assert.equal([...db.docs.keys()].some((key) => key.startsWith("reader_sessions/")), false);
});

test("opaque reader cookie resolves the verified reader and rejects tampering", async () => {
  const db = createMemoryDb();
  const created = await establishReaderIdentity(db, passwordClaims(), "phase5a-cookie");
  const serialized = serializeReaderSessionCookie(created);
  const parsed = parseReaderSessionCookie(serialized);
  const resolved = await resolveReaderIdentitySession(db, parsed);

  assert.equal(resolved.readerUid, "reader_uid_1");
  await assert.rejects(
    () => resolveReaderIdentitySession(db, parseReaderSessionCookie(`${created.sessionId}.tampered_token_value_12345678901234567890`)),
    (error) =>
      error instanceof ReaderAuthError &&
      error.code === "READER_SESSION_INVALID"
  );
});

test("reader cookie parser fails closed and remains separate from author dashboard sessions", () => {
  assert.notEqual(READER_SESSION_COOKIE, DASHBOARD_SESSION_COOKIE);
  assert.equal(parseReaderSessionCookie("not-a-session"), null);
  assert.equal(readReaderSessionCookie(`${READER_SESSION_COOKIE}=bad; other=value`), null);
});
