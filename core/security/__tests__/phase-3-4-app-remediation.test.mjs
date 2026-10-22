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
  const [checkout, completion, sessionRoute, sessionHandler, middleware] = await Promise.all([
    read("../../../app/api/checkout/create-session/route.ts"),
    read("../../../app/api/checkout/create-session/complete/route.ts"),
    read("../../../app/api/session/route.ts"),
    read("../../../app/api/session/handler.ts"),
    read("../../../middleware.ts"),
  ]);
  for (const source of [checkout, completion, `${sessionRoute}\n${sessionHandler}`]) {
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

test("Workbench illustrations use the protected Studio upload route", async () => {
  const source = await read("../../../app/workbench/[assetId]/page.tsx");
  assert.match(source, /uploadStudioFile\(assetId, file, "illustrated_page"\)/);
  assert.doesNotMatch(source, /from "firebase\/storage"|`studio\/\$\{assetId\}\/illustrations/);
});

test("global configuration writes are owner-only server operations", async () => {
  const [client, route] = await Promise.all([
    read("../../../components/admin-controls-modal.tsx"),
    read("../../../app/api/admin/system-config/route.ts"),
  ]);
  assert.match(client, /fetch\("\/api\/admin\/system-config"/);
  assert.doesNotMatch(client, /firebase\/storage|firebase\/firestore|system_config\/foundational_constraints/);
  assert.match(route, /requirePlatformOwner/);
  assert.match(route, /requireSameOrigin/);
  assert.match(route, /system_config/);
  assert.match(route, /updatedBy: session\.email/);
});

test("automation and saved test runs are owner-only server operations", async () => {
  const [client, route] = await Promise.all([
    read("../../../app/automation-center/page.tsx"),
    read("../../../app/api/admin/automation-state/route.ts"),
  ]);
  assert.match(client, /\/api\/admin\/automation-state/);
  assert.doesNotMatch(client, /firebase\/firestore|collection\(db|doc\(db/);
  assert.match(route, /requirePlatformOwner/);
  assert.match(route, /collection\("steps"\)/);
  assert.match(route, /collection\("saved_test_runs"\)/);
});

test("unused sales pipeline browser component is retired", async () => {
  await assert.rejects(() => read("../../../components/sales-funnel-dashboard.tsx"));
  const files = await Promise.all([
    read("../../../app/page.tsx"),
    read("../../../components/layout/sidebar.tsx"),
  ]);
  assert.doesNotMatch(files.join("\n"), /SalesFunnelDashboard|sales_pipeline/);
});

test("audiobook requests bind author identity to the authenticated session", async () => {
  const [client, route] = await Promise.all([
    read("../../../app/page.tsx"),
    read("../../../app/api/audiobook-requests/route.ts"),
  ]);
  assert.match(client, /fetch\("\/api\/audiobook-requests"/);
  assert.doesNotMatch(client, /targetAuthorEmail|collection\(db, "audiobook_requests"/);
  assert.match(route, /authorEmail: session\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(route, /Object\.keys\(body\).*\["title", "authorName"\]/s);
});

test("final rules deny privileged browser self-grants and global collections", async () => {
  const [firestore, storage] = await Promise.all([
    read("../../../firestore.rules"),
    read("../../../storage.rules"),
  ]);
  for (const field of ["hasContentEngineAccess", "hasBlogEngineAccess", "contentEngineEnabled", "blogEngineEnabled", "nexusEnabled", "pluginEntitlements"]) {
    assert.doesNotMatch(firestore, new RegExp(`editableUserFields\\(\\)[\\s\\S]*"${field}"`));
  }
  for (const collection of ["system_config", "steps", "saved_test_runs", "sales_pipeline"]) {
    assert.match(firestore, new RegExp(`match /${collection}.*allow read, write: if false`));
  }
  assert.match(storage, /match \/users\/\{userEmail\}/);
  assert.match(storage, /match \/\{allPaths=\*\*\}[\s\S]*allow read, write: if false/);
});
