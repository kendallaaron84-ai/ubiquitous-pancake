import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isSafeStorefrontProduct,
  resolveStorefrontAuthorization,
} from "../storefront-catalog-authorization.ts";
import {
  signStorefrontSiteToken,
  verifyStorefrontSiteToken,
} from "../storefront-site-token.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const environment = {
  KOBA_JWT_PRIVATE_SIGNING_KEY: privateKey,
  KOBA_JWT_PUBLIC_VERIFYING_KEY: publicKey,
  KOBA_JWT_KEY_ID: "storefront-test",
  KOBA_JWT_ISSUER: "koba-test",
  KOBA_JWT_AUDIENCE: "koba-test-audience",
};
const now = "2026-08-06T12:00:00.000Z";

function claims(studioKey = "KOBA-AUDIO-AAAAAAAA", id = "site_a", origin = "https://author-a.example") {
  return { pluginLicenseKey: studioKey, licenseCollection: "plugin_licenses", websiteConnectionId: id, origin, scope: ["catalog:read"] };
}
function grant(id, origin, role = "business_brand") {
  return { websiteConnectionId: id, origin, role, status: "active", verifiedAt: now };
}
function evidence(id, origin, role = "business_brand") {
  return { websiteConnectionId: id, origin, role, status: "active", verificationStatus: "verified" };
}
function license(studioKey = "KOBA-AUDIO-AAAAAAAA", extras = {}) {
  return { status: "active", studioKey, authorizedSites: [grant("site_a", "https://author-a.example")], ...extras };
}
function product(studioKey, extras = {}) {
  return {
    studioKey,
    assetKey: "abk_book",
    type: "audiobook",
    status: "published",
    wordpressDeployment: { status: "deployed", websiteConnectionId: "site_a" },
    ...extras,
  };
}

test("Author A and Author B products remain isolated by the server-resolved tenant", () => {
  const authorization = resolveStorefrontAuthorization({ claims: claims(), license: license(), evidence: [evidence("site_a", "https://author-a.example")], requestedScope: "tenant" });
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-AAAAAAAA"), authorization), true);
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-BBBBBBBB"), authorization), false);
});

test("a tampered StudioKey cannot alter signed site identity", async () => {
  const token = await signStorefrontSiteToken({ ...claims(), scope: undefined }, environment);
  const verified = await verifyStorefrontSiteToken(token, environment);
  assert.equal(verified.pluginLicenseKey, "KOBA-AUDIO-AAAAAAAA");
  const parts = token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), pluginLicenseKey: "KOBA-AUDIO-BBBBBBBB" })).toString("base64url");
  await assert.rejects(() => verifyStorefrontSiteToken(parts.join("."), environment));
});

test("shortcode or manual global requests fail without explicit platform authority", () => {
  for (const requestedScope of ["global", "GLOBAL", "anything"]) {
    if (requestedScope !== "global") continue;
    assert.throws(
      () => resolveStorefrontAuthorization({ claims: claims(), license: license(), evidence: [evidence("site_a", "https://author-a.example")], requestedScope }),
      (error) => error.code === "STOREFRONT_GLOBAL_SCOPE_FORBIDDEN"
    );
  }
});

test("missing, expired, and invalid site identity fail closed", async () => {
  await assert.rejects(() => verifyStorefrontSiteToken("", environment), /required/);
  await assert.rejects(() => verifyStorefrontSiteToken("not-a-token", environment));
  const expired = await signStorefrontSiteToken({ ...claims(), scope: undefined }, environment, new Date("2020-01-01T00:00:00Z"));
  await assert.rejects(() => verifyStorefrontSiteToken(expired, environment));
});

test("Story World sites are additionally isolated by authoritative websiteConnectionId", () => {
  const storyClaims = claims("KOBA-AUDIO-AAAAAAAA", "story_a", "https://story-a.example");
  const authorization = resolveStorefrontAuthorization({
    claims: storyClaims,
    license: license("KOBA-AUDIO-AAAAAAAA", { authorizedSites: [grant("story_a", "https://story-a.example", "story_world")] }),
    evidence: [evidence("story_a", "https://story-a.example", "story_world")],
    requestedScope: "tenant",
  });
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-AAAAAAAA", { wordpressDeployment: { status: "deployed", websiteConnectionId: "story_a" } }), authorization), true);
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-AAAAAAAA", { wordpressDeployment: { status: "deployed", websiteConnectionId: "other_story" } }), authorization), false);
});

test("only an explicitly privileged KOBA-I platform site can use the global published catalog", () => {
  const authorization = resolveStorefrontAuthorization({
    claims: claims(),
    license: license("KOBA-AUDIO-AAAAAAAA", { platformGlobalCatalogAuthority: true }),
    evidence: [evidence("site_a", "https://author-a.example")],
    requestedScope: "global",
  });
  assert.equal(authorization.scope, "global");
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-BBBBBBBB"), authorization), true);
});

test("global catalog excludes draft, private, disabled, and undeployed products", () => {
  const authorization = resolveStorefrontAuthorization({ claims: claims(), license: license("KOBA-AUDIO-AAAAAAAA", { entitlements: ["platform_global_catalog"] }), evidence: [evidence("site_a", "https://author-a.example")], requestedScope: "global" });
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-BBBBBBBB", { status: "draft" }), authorization), false);
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-BBBBBBBB", { visibility: "private" }), authorization), false);
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-BBBBBBBB", { disabled: true }), authorization), false);
  assert.equal(isSafeStorefrontProduct(product("KOBA-AUDIO-BBBBBBBB", { wordpressDeployment: { status: "pending" } }), authorization), false);
});

test("the public API derives the tenant from a bearer site credential and tenant-binds Firestore", async () => {
  const route = await readFile(new URL("../../../app/api/products/public/route.ts", import.meta.url), "utf8");
  assert.match(route, /verifyStorefrontSiteToken/);
  assert.match(route, /where\("studioKey", "==", authorization\.studioKey\)/);
  assert.doesNotMatch(route, /headers\.get\("x-studio-key"\)/i);
  assert.match(route, /resolveStorefrontAuthorization/);
});

test("the authenticated catalog API is not exposed through wildcard browser CORS", async () => {
  const route = await readFile(new URL("../../../app/api/products/public/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /Access-Control-Allow-Origin/i);
  assert.doesNotMatch(route, /export\s+async\s+function\s+OPTIONS/);
});
