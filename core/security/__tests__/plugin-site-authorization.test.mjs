import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  authorizePluginSite,
  isSupportedPluginLicenseKey,
  reconcilePluginSiteGrants,
  revokePluginSite,
} from "../plugin-site-authorization.ts";

const key = "KOBA-AUDIO-E63DC9CA";
const projectId = "author-jubilee-command-center";
const now = "2026-08-06T12:00:00.000Z";

function evidence(id, origin, role) {
  return {
    websiteConnectionId: id,
    origin,
    role,
    status: "active",
    verificationStatus: "verified",
    verifiedAt: now,
    createdAt: now,
  };
}

function grant(id, origin, role) {
  return {
    websiteConnectionId: id,
    origin,
    role,
    status: "active",
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
    authorizedBy: "author_dashboard",
  };
}

function authorize(overrides = {}) {
  return authorizePluginSite({
    pluginLicenseKey: key,
    clientOrigin: "https://audio.koba-i.com",
    firebaseProjectId: projectId,
    license: { status: "active", studioKey: key },
    evidence: [evidence("primary", "https://audio.koba-i.com", "business_brand")],
    now,
    actor: "wordpress_plugin_activation",
    ...overrides,
  });
}

test("supports existing eight-character and newer sixteen-character plugin license IDs", () => {
  assert.equal(isSupportedPluginLicenseKey(key), true);
  assert.equal(isSupportedPluginLicenseKey("KOBA-AUDIO-6A2289E2E40B502C"), true);
  assert.equal(isSupportedPluginLicenseKey("KOBA-AUDIO-SHARON2026"), false);
});

test("legacy null associatedWebsite is recognized only through a verified dashboard connection", () => {
  const result = authorize({ license: { status: "active", studioKey: key, associatedWebsite: null } });
  assert.equal(result.created, true);
  assert.equal(result.migratedLegacySite, true);
  assert.equal(result.grant.origin, "https://audio.koba-i.com");
});

test("legacy null associatedWebsite cannot authorize an arbitrary origin", () => {
  assert.throws(
    () => authorize({ clientOrigin: "https://unverified.example", evidence: [] }),
    (error) => error.code === "PLUGIN_LICENSE_LEGACY_MIGRATION_REQUIRED"
  );
});

test("the existing audio site remains authorized when the Duncan Story World site is added", () => {
  const audio = grant("primary", "https://audio.koba-i.com", "business_brand");
  const result = authorize({
    clientOrigin: "https://duncan-hunter.koba-i.com/",
    license: { status: "active", studioKey: key, authorizedSites: [audio], maxAuthorizedSites: 2 },
    evidence: [evidence("site_duncan", "https://duncan-hunter.koba-i.com", "story_world")],
  });
  assert.deepEqual(result.authorizedSites.map((site) => site.origin), [
    "https://audio.koba-i.com",
    "https://duncan-hunter.koba-i.com",
  ]);
  assert.equal(result.grant.websiteConnectionId, "site_duncan");
});

test("a third website receives the stable limit code and approved message", () => {
  assert.throws(
    () => authorize({
      clientOrigin: "https://third.example.com",
      license: {
        status: "active",
        studioKey: key,
        authorizedSites: [
          grant("primary", "https://audio.koba-i.com", "business_brand"),
          grant("site_duncan", "https://duncan-hunter.koba-i.com", "story_world"),
        ],
      },
      evidence: [evidence("site_third", "https://third.example.com", "story_world")],
    }),
    (error) => {
      assert.equal(error.code, "PLUGIN_SITE_LIMIT_REACHED");
      assert.equal(error.message, "A maximum of two websites have been assigned to this plugin license.");
      return true;
    }
  );
});

test("a combined site cannot coexist with a second active specialized site", () => {
  assert.throws(
    () => authorize({
      clientOrigin: "https://duncan-hunter.koba-i.com",
      license: {
        status: "active",
        studioKey: key,
        authorizedSites: [grant("primary", "https://audio.koba-i.com", "both")],
      },
      evidence: [evidence("site_duncan", "https://duncan-hunter.koba-i.com", "story_world")],
    }),
    (error) => error.code === "PLUGIN_SITE_NOT_AUTHORIZED"
  );
});

test("origins are exact after normalizing case and trailing slashes", () => {
  const existing = grant("primary", "https://audio.koba-i.com", "both");
  const result = authorize({
    clientOrigin: "HTTPS://AUDIO.KOBA-I.COM/anything",
    license: { status: "active", studioKey: key, authorizedSites: [existing] },
    evidence: [],
  });
  assert.equal(result.created, false);
  assert.equal(result.grant.origin, "https://audio.koba-i.com");
});

test("a stored StudioKey mismatch is rejected", () => {
  assert.throws(
    () => authorize({ license: { status: "active", studioKey: "KOBA-AUDIO-AAAAAAAA" } }),
    (error) => error.code === "PLUGIN_STUDIO_MISMATCH"
  );
});

test("a license from another Firebase environment is rejected", () => {
  assert.throws(
    () => authorize({ license: { status: "active", studioKey: key, firebaseProjectId: "wrong-project" } }),
    (error) => error.code === "PLUGIN_ENVIRONMENT_MISMATCH"
  );
});

test("revoking one specialized site preserves the other active site", () => {
  const result = revokePluginSite({
    authorizedSites: [
      grant("primary", "https://audio.koba-i.com", "business_brand"),
      grant("site_duncan", "https://duncan-hunter.koba-i.com", "story_world"),
    ],
    origin: "https://duncan-hunter.koba-i.com",
    now,
    actor: "kendall.aaron@koba-i.com",
  });
  assert.equal(result.find((site) => site.origin === "https://audio.koba-i.com")?.status, "active");
  assert.equal(result.find((site) => site.origin === "https://duncan-hunter.koba-i.com")?.status, "revoked");
});

test("the existing WordPress plugin request contract remains supported", async () => {
  const route = await readFile(
    new URL("../../../app/api/verify-license/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /get\("x-studio-key"\)/);
  assert.match(route, /body\?\.domain/);
  assert.match(route, /studioKey: pluginLicenseKey/);
  assert.doesNotMatch(route, /transaction\.(?:set|update)\(/);
});

test("repeated dashboard reconciliation updates one grant instead of appending a duplicate", () => {
  const first = grant("primary", "https://audio.koba-i.com", "both");
  const reconciled = reconcilePluginSiteGrants({
    pluginLicenseKey: key,
    firebaseProjectId: projectId,
    license: { status: "active", studioKey: key, authorizedSites: [first] },
    evidence: [evidence("primary", "https://audio.koba-i.com/", "both")],
    now: "2026-08-06T13:00:00.000Z",
    actor: "kendall.aaron@koba-i.com",
  });
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].websiteConnectionId, "primary");
  assert.equal(reconciled[0].origin, "https://audio.koba-i.com");
  assert.equal(reconciled[0].createdAt, first.createdAt);
  assert.equal(reconciled[0].updatedAt, "2026-08-06T13:00:00.000Z");
});

test("grant uniqueness is enforced by both connection ID and normalized exact origin", () => {
  assert.throws(
    () => reconcilePluginSiteGrants({
      pluginLicenseKey: key,
      firebaseProjectId: projectId,
      license: { status: "active", studioKey: key },
      evidence: [
        evidence("primary", "https://audio.koba-i.com", "business_brand"),
        evidence("primary", "https://duncan-hunter.koba-i.com", "story_world"),
      ],
      now,
      actor: "kendall.aaron@koba-i.com",
    }),
    (error) => error.code === "PLUGIN_ORIGIN_MISMATCH"
  );
});

test("an authenticated role change revalidates the complete two-site configuration", () => {
  assert.throws(
    () => reconcilePluginSiteGrants({
      pluginLicenseKey: key,
      firebaseProjectId: projectId,
      license: { status: "active", studioKey: key },
      evidence: [
        evidence("primary", "https://audio.koba-i.com", "both"),
        evidence("site_duncan", "https://duncan-hunter.koba-i.com", "story_world"),
      ],
      now,
      actor: "kendall.aaron@koba-i.com",
    }),
    (error) => error.code === "PLUGIN_SITE_NOT_AUTHORIZED"
  );
});

test("connection route reaches persistence only after gateway verification succeeds", async () => {
  const route = await readFile(
    new URL("../../../app/api/connections/verify/route.ts", import.meta.url),
    "utf8"
  );
  const verification = route.indexOf("verified = gatewayUrl");
  const persistence = route.indexOf("await adminDb.runTransaction", verification);
  assert.ok(verification >= 0);
  assert.ok(persistence > verification);
});
