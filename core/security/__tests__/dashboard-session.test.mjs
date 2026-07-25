import assert from "node:assert/strict";
import test from "node:test";

import {
  issueDashboardSession,
  resolveDashboardAccessScope,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "../dashboard-session.ts";

const SECRET = "test-dashboard-session-secret-with-adequate-length";

test("issues and verifies an asset-independent dashboard session", async () => {
  const token = await issueDashboardSession(
    {
      uid: "firebase-user-1",
      email: "author@example.com",
      studioKey: "STUDIO-1234",
      accessScope: "mvp",
    },
    SECRET
  );

  const claims = await verifyDashboardSession(token, SECRET);

  assert.deepEqual(claims, {
    uid: "firebase-user-1",
    email: "author@example.com",
    studioKey: "STUDIO-1234",
    accessScope: "mvp",
  });
});

test("rejects tampered and incorrectly signed dashboard sessions", async () => {
  const token = await issueDashboardSession(
    {
      uid: "firebase-user-1",
      email: "author@example.com",
      studioKey: null,
      accessScope: "mvp",
    },
    SECRET
  );

  const tokenParts = token.split(".");
  const signature = tokenParts[2];
  const tamperedSignature = `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
  const tamperedToken = `${tokenParts[0]}.${tokenParts[1]}.${tamperedSignature}`;

  await assert.rejects(
    () => verifyDashboardSession(tamperedToken, SECRET)
  );
  await assert.rejects(
    () =>
      verifyDashboardSession(
        token,
        "a-different-dashboard-session-secret-of-safe-length"
      )
  );
});

test("fails closed on missing or weak production secrets", () => {
  assert.throws(
    () => resolveDashboardSessionSecret({ NODE_ENV: "production" }),
    /at least 32 characters/
  );
  assert.throws(
    () =>
      resolveDashboardSessionSecret({
        NODE_ENV: "production",
        KOBA_DASHBOARD_SESSION_SECRET: "too-short",
      }),
    /at least 32 characters/
  );
});

test("production access defaults to MVP and only allowlisted owners receive full access", () => {
  const productionEnvironment = {
    NODE_ENV: "production",
    KOBA_OWNER_EMAILS: "owner@example.com, second-owner@example.com",
  };

  assert.equal(
    resolveDashboardAccessScope("author@example.com", productionEnvironment),
    "mvp"
  );
  assert.equal(
    resolveDashboardAccessScope("OWNER@example.com", productionEnvironment),
    "full"
  );
  assert.equal(
    resolveDashboardAccessScope("author@example.com", {
      NODE_ENV: "development",
    }),
    "full"
  );
});
