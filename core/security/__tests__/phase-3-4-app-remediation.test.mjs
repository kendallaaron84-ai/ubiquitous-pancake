import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { activeLicenseBelongsToSession } from "../content-engine-access.ts";
import { buildUserScopedProductAssetPath } from "../product-image-path.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("login requires a verified Firebase ID token before database access", async () => {
  const source = await read("../../../app/api/login/route.ts");
  const missingGate = source.indexOf("if (!idToken)");
  const verification = source.indexOf("verifyLoginIdToken(");
  const firstDatabaseRead = source.indexOf("adminDb.collection");
  assert.ok(missingGate >= 0);
  assert.ok(verification > missingGate);
  assert.ok(firstDatabaseRead > verification);
  assert.match(source, /const email = trimString\(decodedToken\.email\)\.toLowerCase\(\)/);
  assert.doesNotMatch(source, /const email = trimString\(payload\.email\)/);
});

test("active licenses are owned only by the authenticated email", () => {
  const session = { email: "Author@Example.com" };
  assert.equal(activeLicenseBelongsToSession(session, true, {
    status: "active",
    authorEmail: "author@example.com",
  }), true);
  assert.equal(activeLicenseBelongsToSession(session, true, {
    status: "active",
    authorEmail: "other@example.com",
  }), false);
  assert.equal(activeLicenseBelongsToSession(session, true, {
    status: "revoked",
    authorEmail: "author@example.com",
  }), false);
  assert.equal(activeLicenseBelongsToSession(session, false, {
    status: "active",
    authorEmail: "author@example.com",
  }), false);
});

test("billing replacements accept cookie or Bearer identity and enforce license ownership", async () => {
  const [checkout, completion, session, middleware] = await Promise.all([
    read("../../../app/api/checkout/create-session/route.ts"),
    read("../../../app/api/checkout/create-session/complete/route.ts"),
    read("../../../app/api/session/route.ts"),
    read("../../../middleware.ts"),
  ]);
  for (const source of [checkout, completion, session]) {
    assert.match(source, /requireDashboardRequestSession/);
    assert.match(source, /hasOwnedActiveLicense/);
    assert.match(source, /STUDIO_KEY_OWNERSHIP_MISMATCH/);
  }
  assert.match(middleware, /INTERNALLY_AUTHENTICATED_API_EXACT_PATHS/);
  assert.match(middleware, /"\/api\/checkout\/create-session"/);
  assert.match(middleware, /"\/api\/checkout\/create-session\/complete"/);
  assert.doesNotMatch(middleware, /startsWith\(["']\/api\/billing/);
});

test("current Nexus context cannot select a caller-supplied StudioKey", async () => {
  const source = await read("../../nexus/author-context.ts");
  assert.match(source, /const studioKey = clean\(session\.studioKey\)/);
  assert.match(source, /loadContentEngineAccess\(adminDb, session\)/);
  assert.doesNotMatch(source, /input\.studioKey|requestedStudioKey|searchParams.*studioKey/);
});

test("Product Catalog artwork uses the authenticated user's Storage namespace", () => {
  assert.equal(
    buildUserScopedProductAssetPath(
      "Author@Example.com",
      "ebk_123",
      "cover",
      "My Cover.png"
    ),
    "users/author@example.com/assets/ebk_123_coverUrl_My-Cover.png"
  );
  assert.throws(
    () => buildUserScopedProductAssetPath("../other", "ebk_123", "bg", "x.png"),
    /verified author email/
  );
});

test("confirmed-unused public content routes are retired without payload access", async () => {
  for (const path of [
    "../../../app/api/content/public/route.ts",
    "../../../app/api/publications/[id]/route.ts",
  ]) {
    const source = await read(path);
    assert.match(source, /retiredDashboardRouteResponse/);
    assert.doesNotMatch(source, /adminDb|firestore|products|content_blueprints/i);
  }
});

test("legacy Stripe destinations delegate to the canonical signed webhook", async () => {
  const [rootWebhook, studioDashboard, canonical, middleware] = await Promise.all([
    read("../../../app/api/webhook/route.ts"),
    read("../../../app/api/studio/dashboard/route.ts"),
    read("../../../app/api/webhook/stripe/route.ts"),
    read("../../../middleware.ts"),
  ]);
  assert.match(rootWebhook, /from "\.\/stripe\/route"/);
  assert.match(studioDashboard, /from "\.\.\/\.\.\/webhook\/stripe\/route"/);
  assert.match(canonical, /Stripe\.webhooks\.constructEvent/);
  assert.match(canonical, /checkoutType === "listener_purchase"/);
  assert.match(canonical, /checkoutType === "plugin_purchase"/);
  assert.match(middleware, /"\/api\/webhook\/stripe"/);
  assert.doesNotMatch(middleware, /PUBLIC_API_PREFIXES/);
});
