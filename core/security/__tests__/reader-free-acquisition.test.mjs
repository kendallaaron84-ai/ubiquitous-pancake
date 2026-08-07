import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { establishReaderIdentity } from "../reader-auth.ts";
import {
  acquireReaderFreePublication,
  READER_FREE_ACQUISITION_ERROR_CODES,
} from "../reader-free-acquisition.ts";
import { handleReaderFreeAcquisitionRequest } from "../reader-free-acquisition-handler.ts";
import { listReaderBookshelf } from "../reader-bookshelf.ts";
import {
  READER_SESSION_COOKIE,
  serializeReaderSessionCookie,
} from "../reader-session-cookie.ts";
import { deterministicEntitlementId } from "../services/entitlement-service.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

const ROOT = new URL("../../../", import.meta.url);

function freeProduct(overrides = {}) {
  return {
    title: "Free Reader Publication",
    authorName: "A. Writer",
    studioKey: "studio_a",
    type: "audiobook",
    status: "published",
    isPublished: true,
    price: 0,
    wordpressDeployment: {
      status: "deployed",
      publicationUrl: "https://author.example/free-book/",
    },
    ...overrides,
  };
}

async function verifiedReaderDb(product = freeProduct()) {
  const db = createMemoryDb({ "products/abk_free": product });
  const identity = await establishReaderIdentity(
    db,
    {
      uid: "reader_uid",
      email: "reader@example.com",
      email_verified: true,
      name: "Verified Reader",
      firebase: { sign_in_provider: "password" },
    },
    "phase5d-reader"
  );
  const cookie = serializeReaderSessionCookie({
    sessionId: identity.sessionId,
    token: identity.token,
  });
  return { db, identity, cookie };
}

function acquisitionRequest(cookie, body = { assetId: "abk_free", tenantId: "studio_a" }) {
  return new Request("https://dashboard.koba-i.com/api/reader/publications/free-acquire", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${READER_SESSION_COOKIE}=${cookie}` } : {}),
      "x-request-id": "phase5d-request",
    },
    body: JSON.stringify(body),
  });
}

test("verified reader acquires one UID/tenant/asset promotion and sees it in Bookshelf", async () => {
  const { db, cookie } = await verifiedReaderDb();

  const response = await handleReaderFreeAcquisitionRequest(
    db,
    acquisitionRequest(cookie)
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.acquired, true);
  assert.equal(response.body.bookshelfUrl, "/reader/account");
  const entitlementId = deterministicEntitlementId(
    "reader_uid",
    "studio_a",
    "abk_free"
  );
  assert.equal(response.body.entitlementId, entitlementId);
  assert.deepEqual(db.docs.get(`reader_entitlements/${entitlementId}`), {
    id: entitlementId,
    readerUid: "reader_uid",
    tenantId: "studio_a",
    assetId: "abk_free",
    purchaseId: null,
    purchaseLineItemId: null,
    status: "active",
    source: "promotion",
    lastValidatedAt: null,
    suspendedAt: null,
    revokedAt: null,
    refundedAt: null,
    legacyEntitlementId: null,
    legacyReaderAccessKey: null,
    createdAt: db.docs.get(`reader_entitlements/${entitlementId}`).createdAt,
    updatedAt: db.docs.get(`reader_entitlements/${entitlementId}`).updatedAt,
  });
  const auditEvents = [...db.docs.values()].filter(
    (entry) => entry?.eventType === "promotion.acquired"
  );
  assert.equal(auditEvents.length, 1);
  assert.deepEqual(
    (await listReaderBookshelf(db, "reader_uid")).map((item) => item.title),
    ["Free Reader Publication"]
  );
});

test("duplicate free acquisition is idempotent and creates no duplicate entitlement", async () => {
  const { db, cookie } = await verifiedReaderDb();
  const first = await handleReaderFreeAcquisitionRequest(db, acquisitionRequest(cookie));
  const second = await handleReaderFreeAcquisitionRequest(db, acquisitionRequest(cookie));

  assert.equal(first.body.entitlementId, second.body.entitlementId);
  assert.equal(second.body.acquired, false);
  assert.equal(second.body.replay, true);
  assert.equal(
    [...db.docs.keys()].filter((key) => key.startsWith("reader_entitlements/")).length,
    1
  );
  assert.equal(
    [...db.docs.values()].filter((entry) => entry?.eventType === "promotion.acquired").length,
    1
  );
});

test("anonymous reader cannot acquire a free publication", async () => {
  const db = createMemoryDb({ "products/abk_free": freeProduct() });
  const response = await handleReaderFreeAcquisitionRequest(
    db,
    acquisitionRequest(null)
  );
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "READER_SESSION_INVALID");
  assert.equal(
    [...db.docs.keys()].some((key) => key.startsWith("reader_entitlements/")),
    false
  );
});

test("expired reader session cannot acquire a free publication", async () => {
  const { db, identity, cookie } = await verifiedReaderDb();
  db.docs.set(`reader_sessions/${identity.sessionId}`, {
    ...db.docs.get(`reader_sessions/${identity.sessionId}`),
    expiresAt: { toDate: () => new Date("2000-01-01T00:00:00.000Z") },
  });

  const response = await handleReaderFreeAcquisitionRequest(
    db,
    acquisitionRequest(cookie)
  );
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "READER_SESSION_INVALID");
  assert.equal(
    [...db.docs.keys()].some((key) => key.startsWith("reader_entitlements/")),
    false
  );
});

test("paid-only, disabled, unpublished, and non-deployed products fail closed", async () => {
  for (const [product, code] of [
    [freeProduct({ price: 9.99 }), READER_FREE_ACQUISITION_ERROR_CODES.notEligible],
    [
      freeProduct({ disabled: true }),
      READER_FREE_ACQUISITION_ERROR_CODES.disabled,
    ],
    [
      freeProduct({ status: "draft", isPublished: false }),
      READER_FREE_ACQUISITION_ERROR_CODES.unpublished,
    ],
    [
      freeProduct({ wordpressDeployment: { status: "pending" } }),
      READER_FREE_ACQUISITION_ERROR_CODES.notDeployed,
    ],
  ]) {
    const { db, identity } = await verifiedReaderDb(product);
    await assert.rejects(
      () =>
        acquireReaderFreePublication(db, {
          readerUid: identity.readerUid,
          tenantId: "studio_a",
          assetId: "abk_free",
          correlationId: "ineligible",
        }),
      (error) => error?.code === code
    );
  }
});

test("missing, cross-tenant, and malformed assets fail with stable codes", async () => {
  const { db, identity } = await verifiedReaderDb();
  await assert.rejects(
    () =>
      acquireReaderFreePublication(db, {
        readerUid: identity.readerUid,
        tenantId: "studio_a",
        assetId: "abk_missing",
        correlationId: "missing",
      }),
    (error) => error?.code === READER_FREE_ACQUISITION_ERROR_CODES.notFound
  );
  await assert.rejects(
    () =>
      acquireReaderFreePublication(db, {
        readerUid: identity.readerUid,
        tenantId: "different_studio",
        assetId: "abk_free",
        correlationId: "cross-tenant",
      }),
    (error) => error?.code === READER_FREE_ACQUISITION_ERROR_CODES.tenantMismatch
  );
  await assert.rejects(
    () =>
      acquireReaderFreePublication(db, {
        readerUid: identity.readerUid,
        tenantId: "studio_a",
        assetId: "../unsafe",
        correlationId: "malformed",
      }),
    (error) => error?.code === READER_FREE_ACQUISITION_ERROR_CODES.assetInvalid
  );
});

test("stored asset evidence must match the requested product document", async () => {
  const { db, identity } = await verifiedReaderDb(
    freeProduct({ assetKey: "abk_different" })
  );
  await assert.rejects(
    () =>
      acquireReaderFreePublication(db, {
        readerUid: identity.readerUid,
        tenantId: "studio_a",
        assetId: "abk_free",
        correlationId: "asset-mismatch",
      }),
    (error) => error?.code === READER_FREE_ACQUISITION_ERROR_CODES.assetMismatch
  );
});

test("browser cannot choose UID, source, status, or entitlement type", async () => {
  const { db, cookie } = await verifiedReaderDb();
  const response = await handleReaderFreeAcquisitionRequest(
    db,
    acquisitionRequest(cookie, {
      assetId: "abk_free",
      tenantId: "studio_a",
      readerUid: "attacker_uid",
      source: "purchase",
      status: "active",
    })
  );
  assert.equal(response.status, 400);
  assert.equal(
    response.body.code,
    READER_FREE_ACQUISITION_ERROR_CODES.requestInvalid
  );
  assert.equal(
    [...db.docs.keys()].some((key) => key.startsWith("reader_entitlements/")),
    false
  );
});

test("revoked promotion entitlement cannot be reacquired or reactivated", async () => {
  const { db, identity } = await verifiedReaderDb();
  const entitlementId = deterministicEntitlementId(
    identity.readerUid,
    "studio_a",
    "abk_free"
  );
  db.docs.set(`reader_entitlements/${entitlementId}`, {
    readerUid: identity.readerUid,
    tenantId: "studio_a",
    assetId: "abk_free",
    source: "promotion",
    status: "revoked",
  });
  await assert.rejects(
    () =>
      acquireReaderFreePublication(db, {
        readerUid: identity.readerUid,
        tenantId: "studio_a",
        assetId: "abk_free",
        correlationId: "revoked",
      }),
    (error) =>
      error?.code === READER_FREE_ACQUISITION_ERROR_CODES.entitlementInactive
  );
  assert.equal(db.docs.get(`reader_entitlements/${entitlementId}`).status, "revoked");
});

test("unverified or disabled reader cannot acquire through the promotion service", async () => {
  for (const profile of [
    { accountStatus: "active", emailVerified: false },
    { accountStatus: "disabled", emailVerified: true },
  ]) {
    const db = createMemoryDb({
      "reader_profiles/reader_uid": profile,
      "products/abk_free": freeProduct(),
    });
    await assert.rejects(() =>
      acquireReaderFreePublication(db, {
        readerUid: "reader_uid",
        tenantId: "studio_a",
        assetId: "abk_free",
        correlationId: "blocked-reader",
      })
    );
  }
});

test("free acquisition boundary has no Stripe, phone, SMS, or client Firestore dependency", async () => {
  const route = await readFile(
    new URL("app/api/reader/publications/free-acquire/route.ts", ROOT),
    "utf8"
  );
  const handler = await readFile(
    new URL("core/security/reader-free-acquisition-handler.ts", ROOT),
    "utf8"
  );
  const combined = `${route}\n${handler}`;
  assert.doesNotMatch(combined, /Stripe|TWILIO|sms-send|sms-verify|phoneNumber/);
  assert.doesNotMatch(combined, /firebase\/firestore|collection\(/);
  assert.match(combined, /resolveReaderIdentitySession/);
  assert.match(combined, /acquireReaderFreePublication/);
});
