import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  StudioPublicationAccessError,
  assertActiveStudioLicense,
  assertNoAuthoritativeStudioFields,
  assertOwnedStudioProduct,
  assertTenantBoundStoragePath,
  assertValidStudioAssetId,
  buildStudioManifestPatch,
  buildWorkbenchDraftPatch,
  listOwnedStudioProducts,
  studioProductProjection,
} from "../studio-publication-access.ts";

const ROOT = new URL("../../../", import.meta.url);
const SHARON_KEY = "KOBA-AUDIO-SHARON123456";
const KENDALL_KEY = "KOBA-AUDIO-KENDALL1234";

function session(overrides = {}) {
  return {
    uid: "firebase_sharon",
    email: "sharon@example.com",
    studioKey: SHARON_KEY,
    accessScope: "mvp",
    iat: 1,
    exp: 2,
    ...overrides,
  };
}

function context() {
  return assertActiveStudioLicense(session(), SHARON_KEY, {
    status: "active",
    authorEmail: "SHARON@example.com",
  });
}

function product(overrides = {}) {
  return {
    studioKey: SHARON_KEY,
    wpStudioKey: SHARON_KEY,
    authorEmail: "sharon@example.com",
    authorId: "sharon@example.com",
    title: "Sharon's Book",
    type: "audiobook",
    studioTracks: [],
    chapters: [],
    ...overrides,
  };
}

test("active license ownership requires the exact document ID and normalized email", () => {
  const authorized = context();
  assert.equal(authorized.studioKey, SHARON_KEY);
  assert.equal(authorized.authorEmail, "sharon@example.com");

  for (const [documentId, license] of [
    [KENDALL_KEY, { status: "active", authorEmail: "sharon@example.com" }],
    [SHARON_KEY, { status: "active", authorEmail: "kendall@example.com" }],
    [SHARON_KEY, { status: "disabled", authorEmail: "sharon@example.com" }],
  ]) {
    assert.throws(
      () => assertActiveStudioLicense(session(), documentId, license),
      StudioPublicationAccessError
    );
  }
});

test("Sharon can load her product while Kendall and forged IDs fail closed", () => {
  const authorized = context();
  assert.equal(assertOwnedStudioProduct(authorized, product()).title, "Sharon's Book");
  for (const foreign of [
    product({ studioKey: KENDALL_KEY }),
    product({ authorEmail: "kendall@example.com", authorId: "kendall@example.com" }),
    null,
  ]) {
    assert.throws(
      () => assertOwnedStudioProduct(authorized, foreign),
      (error) => error.status === 404 && error.code === "STUDIO_PUBLICATION_NOT_FOUND"
    );
  }
  for (const value of ["", "../kendall", "x", "asset/foreign", "asset?admin=true"]) {
    assert.throws(() => assertValidStudioAssetId(value), StudioPublicationAccessError);
  }
});

test("server-side Studio listing filters both StudioKey and author ownership", async () => {
  const documents = [
    { id: "abk_sharon", data: () => product() },
    { id: "abk_kendall", data: () => product({ authorEmail: "kendall@example.com", authorId: "kendall@example.com" }) },
    { id: "abk_other_studio", data: () => product({ studioKey: KENDALL_KEY, wpStudioKey: KENDALL_KEY }) },
  ];
  const database = {
    collection() {
      return {
        where(field, _operator, value) {
          return {
            async get() {
              return {
                docs: documents.filter((document) => document.data()[field] === value),
              };
            },
          };
        },
      };
    },
  };
  const results = await listOwnedStudioProducts(database, context());
  assert.deepEqual(results.map((entry) => entry.id), ["abk_sharon"]);
});

test("Studio and Workbench projections never expose or accept apiKeys or ownership fields", () => {
  const projection = studioProductProjection("abk_sharon", product({
    apiKeys: { provider: "must-not-leave-server" },
    secretCredentialRef: "projects/example/secrets/private",
    guardrails: { apiKeys: { nested: "must-not-leave-server" } },
    chapters: [{ id: "one", apiKeys: { nested: true } }],
  }));
  assert.equal("apiKeys" in projection, false);
  assert.equal("secretCredentialRef" in projection, false);
  assert.equal("studioKey" in projection, false);
  assert.equal("authorEmail" in projection, false);
  assert.equal("apiKeys" in projection.guardrails, false);
  assert.equal("apiKeys" in projection.chapters[0], false);

  for (const field of ["id", "assetKey", "studioKey", "tenantId", "authorEmail", "apiKeys"]) {
    assert.throws(
      () => assertNoAuthoritativeStudioFields({ [field]: "forged" }),
      (error) => error.code === "STUDIO_AUTHORITATIVE_FIELD_REJECTED"
    );
  }
  const draft = buildWorkbenchDraftPatch({
    chapters: [{ id: "one", title: "One", textContent: "Text" }],
    guardrails: { setting: "Texas", apiKeys: { bad: true } },
  });
  assert.equal("apiKeys" in draft, false);
  assert.equal("apiKeys" in draft.guardrails, false);
});

test("owner-owned assets use the same exact ownership model", () => {
  const ownerSession = session({
    uid: "firebase_kendall",
    email: "kendall@example.com",
    studioKey: KENDALL_KEY,
    accessScope: "owner",
  });
  const ownerContext = assertActiveStudioLicense(ownerSession, KENDALL_KEY, {
    status: "active",
    authorEmail: "kendall@example.com",
  });
  assert.equal(
    assertOwnedStudioProduct(ownerContext, product({
      studioKey: KENDALL_KEY,
      wpStudioKey: KENDALL_KEY,
      authorEmail: "kendall@example.com",
      authorId: "kendall@example.com",
    })).title,
    "Sharon's Book"
  );
});

test("new media paths are tenant and asset scoped while unchanged legacy paths remain compatible", () => {
  const tenantPath = `studio/abk_sharon/${SHARON_KEY}/source/chapter.mp3`;
  assert.equal(
    assertTenantBoundStoragePath(tenantPath, "abk_sharon", SHARON_KEY),
    tenantPath
  );
  for (const path of [
    `studio/abk_kendall/${SHARON_KEY}/source/chapter.mp3`,
    `studio/abk_sharon/${KENDALL_KEY}/source/chapter.mp3`,
    `studio/abk_sharon/${SHARON_KEY}/../kendall.mp3`,
  ]) {
    assert.throws(() => assertTenantBoundStoragePath(path, "abk_sharon", SHARON_KEY));
  }

  const legacyPath = "studio/abk_sharon/chapter-1.mp3";
  const legacy = buildStudioManifestPatch({
    tracks: [{ id: "one", title: "One", storagePath: legacyPath }],
    mediaType: "audio",
    currentProduct: product({ studioTracks: [{ id: "one", storagePath: legacyPath, url: "https://storage.example/legacy" }] }),
    studioKey: SHARON_KEY,
    assetId: "abk_sharon",
    canonicalMediaUrl: (path) => `https://storage.example/${path}`,
  });
  assert.equal(legacy.studioTracks[0].storagePath, legacyPath);
  assert.equal(legacy.studioTracks[0].url, "https://storage.example/legacy");
});

test("Studio and Workbench clients use only the server-owned API", async () => {
  const [lobby, studio, workbench, client] = await Promise.all([
    readFile(new URL("app/studio/page.tsx", ROOT), "utf8"),
    readFile(new URL("app/studio/[assetId]/page.tsx", ROOT), "utf8"),
    readFile(new URL("app/workbench/[assetId]/page.tsx", ROOT), "utf8"),
    readFile(new URL("core/studio-client.ts", ROOT), "utf8"),
  ]);
  for (const source of [lobby, studio, workbench]) {
    assert.doesNotMatch(source, /firebase\/firestore|firebase\/storage|@\/core\/firebase/);
    assert.doesNotMatch(source, /kendallaaron84@gmail\.com/);
    assert.doesNotMatch(source, /apiKeys/);
  }
  assert.match(client, /\/api\/studio\/publications/);
  assert.match(client, /method: "PUT"/);
  assert.match(client, /credentials: "same-origin"/);
});

test("Vault and transcription share strict session, license, and product ownership", async () => {
  const [vault, transcribe, route] = await Promise.all([
    readFile(new URL("app/api/studio/vault/route.ts", ROOT), "utf8"),
    readFile(new URL("app/api/studio/transcribe/route.ts", ROOT), "utf8"),
    readFile(new URL("app/api/studio/publications/route.ts", ROOT), "utf8"),
  ]);
  for (const source of [vault, transcribe, route]) {
    assert.match(source, /requireStudioAuthorContext/);
    assert.match(source, /loadOwnedStudioProduct/);
  }
  assert.match(route, /action: "write"/);
  assert.match(route, /assertTenantBoundStoragePath/);
  assert.doesNotMatch(route, /apiKeys/);
});

test("Nexus remains independent from Studio authorization", async () => {
  const [helper, contextRoute] = await Promise.all([
    readFile(new URL("core/security/studio-publication-access.ts", ROOT), "utf8"),
    readFile(new URL("app/api/nexus/context/route.ts", ROOT), "utf8"),
  ]);
  assert.doesNotMatch(helper, /Nexus|hasContentEngineAccess|requireNexusAuthorContext/);
  assert.match(contextRoute, /requireNexusAuthorContext/);
});

test("MVP access exposes only the approved Studio and Workbench boundaries", async () => {
  const middleware = await readFile(new URL("middleware.ts", ROOT), "utf8");
  const pageStart = middleware.indexOf("const MVP_PAGE_PREFIXES");
  const apiStart = middleware.indexOf("const MVP_API_EXACT_PATHS");
  const middlewareStart = middleware.indexOf("export async function middleware");
  const pages = middleware.slice(pageStart, apiStart);
  const apis = middleware.slice(apiStart, middlewareStart);

  assert.match(pages, /"\/studio"/);
  assert.match(pages, /"\/workbench"/);
  assert.match(apis, /"\/api\/studio\/publications"/);
  assert.match(apis, /"\/api\/studio\/transcribe"/);
  assert.match(apis, /"\/api\/studio\/vault"/);
  assert.doesNotMatch(apis, /"\/api\/studio\/transcribe\/estimate"/);
  assert.doesNotMatch(apis, /"\/api\/studio\/dashboard"/);
  assert.doesNotMatch(apis, /\/api\/products\/\*/);
  assert.match(middleware, /MVP_API_EXACT_PATHS\.has\(pathname\)/);
});
