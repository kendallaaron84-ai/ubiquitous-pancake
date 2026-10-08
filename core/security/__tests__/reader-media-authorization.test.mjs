import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { establishReaderIdentity } from "../reader-auth.ts";
import {
  authorizeAnonymousFreeMedia,
  authorizeReaderMedia,
  buildProtectedPublicationChapters,
  ReaderMediaAuthorizationError,
  READER_MEDIA_ERROR_CODES,
} from "../reader-media-authorization.ts";
import { createReaderMediaTokenHandler } from "../reader-media-token-handler.ts";
import {
  READER_SESSION_COOKIE,
  serializeReaderSessionCookie,
} from "../reader-session-cookie.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

const ROOT = new URL("../../../", import.meta.url);

function product(overrides = {}) {
  return {
    title: "Protected Publication",
    studioKey: "studio_a",
    status: "published",
    isPublished: true,
    type: "audiobook",
    wordpressDeployment: {
      status: "deployed",
      targetWpOrigin: "https://author.example",
      publicationUrl: "https://author.example/koba_publication/protected/",
    },
    studioTracks: [
      {
        id: "chapter_1",
        title: "Chapter One",
        storagePath: "studio/abk_protected/chapter-1.mp3",
        transcriptStoragePath:
          "transcripts/studio_a/abk_protected/chapter-1.txt",
        url: "https://public.example/must-not-leak.mp3",
      },
      {
        id: "chapter_2",
        title: "Chapter Two",
        storagePath: "studio/abk_protected/chapter-2.mp3",
      },
    ],
    ...overrides,
  };
}

async function authorizedDb(options = {}) {
  const db = createMemoryDb({
    "products/abk_protected": product(options.product),
  });
  const identity = await establishReaderIdentity(
    db,
    {
      uid: "reader_uid",
      email: "reader@example.com",
      email_verified: true,
      name: "Reader",
      firebase: { sign_in_provider: "password" },
    },
    "phase5e-reader"
  );
  if (options.entitlement !== false) {
    db.docs.set("reader_entitlements/entitlement_1", {
      id: "entitlement_1",
      readerUid: "reader_uid",
      tenantId: "studio_a",
      assetId: "abk_protected",
      status: options.entitlementStatus || "active",
      source: "purchase",
    });
  }
  return {
    db,
    identity,
    cookie: serializeReaderSessionCookie({
      sessionId: identity.sessionId,
      token: identity.token,
    }),
  };
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function testJwt() {
  return `${encoded({ alg: "none" })}.${encoded({ exp: 2_000_000_000 })}.signature`;
}

function mediaRequest(cookie, body = { assetId: "abk_protected", tenantId: "studio_a" }) {
  return new Request("https://dashboard.koba-i.com/api/reader/media/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${READER_SESSION_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("Phase 5A session and canonical entitlement issue a Firebase UID media token", async () => {
  const { db, cookie } = await authorizedDb();
  let issuedInput = null;
  const handler = createReaderMediaTokenHandler({
    db,
    issueToken: async (input) => {
      issuedInput = input;
      return testJwt();
    },
  });
  const response = await handler(mediaRequest(cookie));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, "authorized");
  assert.equal(payload.assetId, "abk_protected");
  assert.equal(payload.publicationUrl, "https://author.example/koba_publication/protected/");
  assert.deepEqual(issuedInput, {
    principalId: "reader_uid",
    tenantId: "studio_a",
    principalType: "firebase_uid",
  });
  assert.ok(db.docs.get("reader_entitlements/entitlement_1").lastValidatedAt);
});

test("anonymous or expired reader sessions cannot mint media authorization", async () => {
  const { db } = await authorizedDb();
  let issueCalls = 0;
  const handler = createReaderMediaTokenHandler({
    db,
    issueToken: async () => {
      issueCalls += 1;
      return testJwt();
    },
  });
  const response = await handler(mediaRequest(null));
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.code, "READER_SESSION_INVALID");
  assert.equal(issueCalls, 0);
});

test("active entitlement is required for both paid and promotion publications", async () => {
  const { db, cookie } = await authorizedDb({ entitlement: false });
  const handler = createReaderMediaTokenHandler({ db, issueToken: async () => testJwt() });
  const response = await handler(mediaRequest(cookie));
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payload.code, READER_MEDIA_ERROR_CODES.entitlementRequired);

  db.docs.set("reader_entitlements/promotion", {
    readerUid: "reader_uid",
    tenantId: "studio_a",
    assetId: "abk_protected",
    status: "active",
    source: "promotion",
  });
  assert.equal((await handler(mediaRequest(cookie))).status, 200);
});

test("revoked, refunded, and suspended entitlements cannot authorize media", async () => {
  for (const status of ["revoked", "refunded", "suspended"]) {
    const { db } = await authorizedDb({ entitlementStatus: status });
    await assert.rejects(
      () =>
        authorizeReaderMedia(db, {
          readerUid: "reader_uid",
          tenantId: "studio_a",
          assetId: "abk_protected",
        }),
      (error) =>
        error instanceof ReaderMediaAuthorizationError &&
        error.code === READER_MEDIA_ERROR_CODES.entitlementRequired
    );
  }
});

test("cross-tenant, unpublished, non-deployed, and wrong-origin requests fail closed", async () => {
  const { db } = await authorizedDb();
  await assert.rejects(
    () => authorizeReaderMedia(db, { readerUid: "reader_uid", tenantId: "studio_b", assetId: "abk_protected" }),
    (error) => error.code === READER_MEDIA_ERROR_CODES.tenantMismatch
  );
  await assert.rejects(
    () => authorizeReaderMedia(db, { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_protected", requestOrigin: "https://attacker.example" }),
    (error) => error.code === READER_MEDIA_ERROR_CODES.originNotAllowed
  );

  db.docs.set("products/abk_protected", product({ status: "draft", isPublished: false }));
  await assert.rejects(
    () => authorizeReaderMedia(db, { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_protected" }),
    (error) => error.code === READER_MEDIA_ERROR_CODES.publicationUnavailable
  );
  db.docs.set("products/abk_protected", product({ wordpressDeployment: { status: "failed" } }));
  await assert.rejects(
    () => authorizeReaderMedia(db, { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_protected" }),
    (error) => error.code === READER_MEDIA_ERROR_CODES.publicationNotDeployed
  );
});

test("browser cannot choose UID, entitlement, source, or status", async () => {
  const { db, cookie } = await authorizedDb();
  let issueCalls = 0;
  const handler = createReaderMediaTokenHandler({
    db,
    issueToken: async () => {
      issueCalls += 1;
      return testJwt();
    },
  });
  for (const authority of [
    { uid: "other" },
    { readerUid: "other" },
    { entitlementId: "chosen" },
    { source: "promotion" },
    { status: "active" },
  ]) {
    const response = await handler(
      mediaRequest(cookie, {
        assetId: "abk_protected",
        tenantId: "studio_a",
        ...authority,
      })
    );
    assert.equal(response.status, 400);
  }
  assert.equal(issueCalls, 0);
});

test("complete chapter manifest uses only namespaced signed URLs and never raw pointers", async () => {
  const signedPaths = [];
  const chapters = await buildProtectedPublicationChapters({
    chapters: product().studioTracks,
    tenantId: "studio_a",
    assetId: "abk_protected",
    publicationType: "audiobook",
    signStoragePath: async (path) => {
      signedPaths.push(path);
      return `https://signed.example/${encodeURIComponent(path)}?expires=short`;
    },
  });
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, "Chapter One");
  assert.equal(chapters[1].title, "Chapter Two");
  assert.equal(String(chapters[0].url).startsWith("https://signed.example/"), true);
  assert.equal(chapters[0].storagePath, undefined);
  assert.equal(chapters[0].transcriptStoragePath, undefined);
  assert.equal(JSON.stringify(chapters).includes("public.example"), false);
  assert.deepEqual(signedPaths.sort(), [
    "studio/abk_protected/chapter-1.mp3",
    "studio/abk_protected/chapter-2.mp3",
    "transcripts/studio_a/abk_protected/chapter-1.txt",
  ].sort());
});

test("reflowable chapter illustrations resolve canonical paths only after reader authorization", async () => {
  const storagePath = "studio/ebk_protected/studio_a/illustration/tree.png";
  const [chapter] = await buildProtectedPublicationChapters({
    chapters: [{
      id: "chapter_one",
      textContent: `<p>Before</p><img src="" data-koba-storage-path="${storagePath}" alt="Tree"><p>After</p>`,
    }],
    tenantId: "studio_a",
    assetId: "ebk_protected",
    publicationType: "ebook",
    signStoragePath: async (path) => `https://signed.example/reader/${encodeURIComponent(path)}`,
  });
  assert.match(chapter.textContent, /https:\/\/signed\.example\/reader/);
  assert.match(chapter.textContent, /data-koba-storage-path=/);
  assert.doesNotMatch(chapter.textContent, /src=""/);
});

test("missing or cross-namespace protected media pointers fail closed", async () => {
  for (const storagePath of ["", "studio/other_asset/chapter.mp3"]) {
    await assert.rejects(
      () =>
        buildProtectedPublicationChapters({
          chapters: [{ title: "Unsafe", storagePath, url: "https://public.example/audio.mp3" }],
          tenantId: "studio_a",
          assetId: "abk_protected",
          publicationType: "audiobook",
          signStoragePath: async () => "https://signed.example/file",
        }),
      (error) => error.code === READER_MEDIA_ERROR_CODES.manifestUnavailable
    );
  }
});

test("active manifest route selects canonical UID authorization and requires access for free titles", async () => {
  const source = await readFile(new URL("../../../app/api/media/manifest/route.ts", import.meta.url), "utf8");
  assert.match(source, /claims\.principalType === "firebase_uid"/);
  assert.match(source, /authorizeReaderMedia\(adminDb/);
  assert.match(source, /if \(!readerToken\)/);
  assert.doesNotMatch(source, /if \(isPaid\)/);
  assert.match(source, /buildProtectedPublicationChapters/);
  assert.match(source, /claims\.principalType === "anonymous_free"/);
  assert.match(source, /claims\.assetId !== assetKey/);
  assert.match(source, /claims\.origin !== normalizedRequestOrigin/);
});

test("anonymous free media authorization requires explicit free, published, deployed, exact-origin product", async () => {
  const db = createMemoryDb({ "products/abk_free": product({ assetId: "abk_free", isFree: true }) });
  const result = await authorizeAnonymousFreeMedia(db, { assetId: "abk_free", requestOrigin: "https://author.example" });
  assert.equal(result.tenantId, "studio_a");
  await assert.rejects(
    () => authorizeAnonymousFreeMedia(db, { assetId: "abk_free", requestOrigin: "https://attacker.example" }),
    (error) => error.code === READER_MEDIA_ERROR_CODES.originNotAllowed
  );
  db.docs.set("products/abk_free", product({ assetId: "abk_free", price: 9.99 }));
  await assert.rejects(
    () => authorizeAnonymousFreeMedia(db, { assetId: "abk_free", requestOrigin: "https://author.example" }),
    (error) => error.code === READER_MEDIA_ERROR_CODES.freeAccessRequired
  );
});

test("reader media token route bypasses author middleware and enforces its own reader session", async () => {
  const middleware = await readFile(new URL("../../../middleware.ts", import.meta.url), "utf8");
  const handler = await readFile(new URL("../reader-media-token-handler.ts", import.meta.url), "utf8");
  assert.match(middleware, /"\/api\/reader\/media\/token"/);
  assert.match(handler, /resolveReaderIdentitySession/);
  assert.match(handler, /readReaderSessionCookie/);
});

test("Phase 5E media boundary has no Stripe, phone, SMS, or client Firestore dependency", async () => {
  const files = [
    "reader-media-authorization.ts",
    "reader-media-token-handler.ts",
  ];
  const source = (
    await Promise.all(
      files.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8"))
    )
  ).join("\n");
  assert.doesNotMatch(source, /stripe/i);
  assert.doesNotMatch(source, /twilio|sms|phone/i);
  assert.doesNotMatch(source, /firebase\/firestore/);
});
