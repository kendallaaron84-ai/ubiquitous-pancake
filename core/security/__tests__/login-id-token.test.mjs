import assert from "node:assert/strict";
import test from "node:test";

import {
  LoginIdTokenError,
  verifyLoginIdToken,
} from "../login-id-token.ts";

test("missing ID token returns ID_TOKEN_REQUIRED without resolving Admin Auth", async () => {
  let resolverCalls = 0;

  await assert.rejects(
    () =>
      verifyLoginIdToken("", () => {
        resolverCalls += 1;
        throw new Error("must not run");
      }),
    (error) =>
      error instanceof LoginIdTokenError &&
      error.status === 400 &&
      error.code === "ID_TOKEN_REQUIRED"
  );
  assert.equal(resolverCalls, 0);
});

test("invalid ID token returns INVALID_ID_TOKEN", async () => {
  await assert.rejects(
    () =>
      verifyLoginIdToken("invalid-token", () => ({
        verifyIdToken: async () => {
          throw new Error("token rejected");
        },
      })),
    (error) =>
      error instanceof LoginIdTokenError &&
      error.status === 401 &&
      error.code === "INVALID_ID_TOKEN"
  );
});

test("valid ID token returns the verified Firebase claims", async () => {
  const decoded = { uid: "reader-1", email: "reader@example.com" };
  const result = await verifyLoginIdToken("valid-token", () => ({
    verifyIdToken: async () => decoded,
  }));

  assert.equal(result, decoded);
});

test("verifyIdToken is never called on a null Auth instance", async () => {
  let verifyCalls = 0;
  const nullAuth = null;

  await assert.rejects(
    () =>
      verifyLoginIdToken(
        "valid-looking-token",
        () => nullAuth
      ),
    (error) =>
      error instanceof LoginIdTokenError &&
      error.status === 500 &&
      error.code === "FIREBASE_ADMIN_NOT_CONFIGURED"
  );
  assert.equal(verifyCalls, 0);
});
