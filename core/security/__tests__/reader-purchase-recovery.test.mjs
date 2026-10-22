import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sha256Id } from "../reader-contracts/common.ts";
import {
  ReaderPurchaseRecoveryError,
  recoverReaderPurchaseForAsset,
} from "../reader-purchase-recovery.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

const EMAIL = "reader@example.com";
const EMAIL_HASH = sha256Id("reader-purchase-email", EMAIL);
const ASSET_ID = "ebk_the-healing-journey";
const TENANT_ID = "KOBA-AUDIO-SHARON";

function claimId(purchaseId) {
  return sha256Id("pending-purchase-claim", purchaseId);
}

function seed(overrides = {}) {
  return createMemoryDb({
    "reader_profiles/reader_uid": {
      uid: "reader_uid",
      email: EMAIL,
      emailNormalized: EMAIL,
      emailVerified: true,
      accountStatus: "active",
    },
    [`products/${ASSET_ID}`]: {
      assetId: ASSET_ID,
      studioKey: TENANT_ID,
    },
    "reader_purchases/purchase_one": {
      id: "purchase_one",
      purchaseEmailHash: EMAIL_HASH,
      paymentStatus: "paid",
      disputeStatus: "none",
    },
    "reader_purchase_items/item_one": {
      id: "item_one",
      purchaseId: "purchase_one",
      tenantId: TENANT_ID,
      assetId: ASSET_ID,
      status: "paid",
    },
    [`pending_purchase_claims/${claimId("purchase_one")}`]: {
      id: claimId("purchase_one"),
      purchaseId: "purchase_one",
      purchaseEmailHash: EMAIL_HASH,
      status: "blocked",
      claimedUid: null,
      entitlementIds: [],
      manualReviewRequired: true,
      blockedReason: "verified_email_mismatch",
    },
    ...overrides,
  });
}

function recover(db, overrides = {}) {
  return recoverReaderPurchaseForAsset(db, {
    readerUid: "reader_uid",
    assetId: ASSET_ID,
    correlationId: "recovery-request",
    ...overrides,
  });
}

function entitlements(db) {
  return [...db.docs.entries()].filter(([path]) =>
    path.startsWith("reader_entitlements/")
  );
}

test("paid reader without entitlement recovers the existing blocked claim", async () => {
  const db = seed();
  const result = await recover(db);
  assert.equal(result.status, "claimed");
  assert.equal(result.entitlementIds.length, 1);
  assert.equal(entitlements(db).length, 1);
  const claim = db.docs.get(`pending_purchase_claims/${claimId("purchase_one")}`);
  assert.equal(claim.status, "claimed");
  assert.equal(claim.claimedUid, "reader_uid");
});

test("entitled reader bypasses purchase recovery and opens normally", async () => {
  const db = seed({
    "reader_entitlements/existing": {
      readerUid: "reader_uid",
      tenantId: TENANT_ID,
      assetId: ASSET_ID,
      status: "active",
    },
  });
  const result = await recover(db);
  assert.deepEqual(result, { status: "entitled", entitlementIds: [] });
  assert.equal(
    db.docs.get(`pending_purchase_claims/${claimId("purchase_one")}`).status,
    "blocked"
  );
});

test("wrong authenticated account receives account-switch guidance and cannot claim", async () => {
  const db = seed({
    "reader_profiles/wrong_uid": {
      uid: "wrong_uid",
      email: "wrong@gmail.com",
      emailNormalized: "wrong@gmail.com",
      emailVerified: true,
      accountStatus: "active",
    },
  });
  await assert.rejects(
    () => recover(db, { readerUid: "wrong_uid" }),
    (error) =>
      error instanceof ReaderPurchaseRecoveryError &&
      error.code === "READER_PURCHASE_ACCOUNT_SWITCH_REQUIRED"
  );
  assert.equal(entitlements(db).length, 0);
});

test("repeated recovery is idempotent and creates one entitlement", async () => {
  const db = seed();
  await recover(db);
  const replay = await recover(db);
  assert.equal(replay.status, "entitled");
  assert.equal(entitlements(db).length, 1);
});

test("ambiguous matching purchases fail safely", async () => {
  const secondClaimId = claimId("purchase_two");
  const db = seed({
    "reader_purchases/purchase_two": {
      id: "purchase_two",
      purchaseEmailHash: EMAIL_HASH,
      paymentStatus: "paid",
      disputeStatus: "none",
    },
    "reader_purchase_items/item_two": {
      id: "item_two",
      purchaseId: "purchase_two",
      tenantId: TENANT_ID,
      assetId: ASSET_ID,
      status: "paid",
    },
    [`pending_purchase_claims/${secondClaimId}`]: {
      id: secondClaimId,
      purchaseId: "purchase_two",
      purchaseEmailHash: EMAIL_HASH,
      status: "unclaimed",
      claimedUid: null,
      entitlementIds: [],
      manualReviewRequired: false,
      blockedReason: null,
    },
  });
  await assert.rejects(
    () => recover(db),
    (error) =>
      error instanceof ReaderPurchaseRecoveryError &&
      error.code === "READER_PURCHASE_RECOVERY_AMBIGUOUS"
  );
  assert.equal(entitlements(db).length, 0);
});

test("asset ID alone cannot manufacture a purchase or entitlement", async () => {
  const db = seed();
  db.docs.delete("reader_purchases/purchase_one");
  db.docs.delete("reader_purchase_items/item_one");
  db.docs.delete(`pending_purchase_claims/${claimId("purchase_one")}`);
  await assert.rejects(
    () => recover(db),
    (error) =>
      error instanceof ReaderPurchaseRecoveryError &&
      error.code === "READER_PURCHASE_ACCOUNT_SWITCH_REQUIRED"
  );
  assert.equal(entitlements(db).length, 0);
});

test("recovery UI preserves account switch and password-reset continuation without exposing internals", async () => {
  const [component, authForm, route] = await Promise.all([
    readFile(
      new URL("../../../components/reader/ReaderPurchaseRecovery.tsx", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../../../components/reader/ReaderAuthForm.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../../../app/api/reader/purchases/recover/route.ts", import.meta.url),
      "utf8"
    ),
  ]);
  assert.match(component, /switchReaderAccountForContinuation/);
  assert.match(component, /reader\/signin\?next=/);
  assert.match(authForm, /sendPasswordResetEmail[\s\S]*authHref\("\/reader\/signin"\)/);
  assert.match(route, /resolveReaderIdentitySession/);
  assert.doesNotMatch(component, /purchaseEmailHash|readerUid|studioKey|READER_MEDIA_ENTITLEMENT_REQUIRED/);
});
