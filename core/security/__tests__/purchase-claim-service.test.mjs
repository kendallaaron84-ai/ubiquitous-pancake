import assert from "node:assert/strict";
import test from "node:test";

import { sha256Id } from "../reader-contracts/common.ts";
import { deterministicAuditEventId } from "../services/audit-service.ts";
import { claimPendingPurchase } from "../services/purchase-claim-service.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

const PURCHASE_EMAIL = "reader@example.com";

function seeded() {
  return createMemoryDb({
    "pending_purchase_claims/c": {
      purchaseId: "p",
      purchaseEmailHash: sha256Id("reader-purchase-email", PURCHASE_EMAIL),
      status: "unclaimed",
      claimedUid: null,
      entitlementIds: [],
      manualReviewRequired: false,
      blockedReason: null,
    },
    "reader_purchase_items/i": {
      purchaseId: "p",
      tenantId: "t",
      assetId: "a",
      status: "paid",
    },
  });
}

function claimInput(overrides = {}) {
  return {
    claimId: "c",
    readerUid: "correct_uid",
    verifiedEmail: PURCHASE_EMAIL,
    emailVerified: true,
    accountStatus: "active",
    correlationId: "claim-request",
    ...overrides,
  };
}

function entitlementCount(db) {
  return [...db.docs.keys()].filter((key) =>
    key.startsWith("reader_entitlements/")
  ).length;
}

function auditEvents(db, eventType) {
  return [...db.docs.values()].filter((value) => value.eventType === eventType);
}

async function blockWithWrongReader(db) {
  await assert.rejects(
    () =>
      claimPendingPurchase(
        db,
        claimInput({
          readerUid: "wrong_gmail_uid",
          verifiedEmail: "wrong@gmail.com",
          correlationId: "initial-mismatch",
        })
      ),
    /PURCHASE_EMAIL_MISMATCH/
  );
}

test("purchase claim transaction creates one entitlement and replays safely", async () => {
  const db = seeded();
  const first = await claimPendingPurchase(db, claimInput());
  const second = await claimPendingPurchase(
    db,
    claimInput({ correlationId: "claim-repeat" })
  );
  assert.equal(first.entitlementIds.length, 1);
  assert.equal(second.replay, true);
  assert.equal(entitlementCount(db), 1);
});

test("original mismatched reader session blocks the claim", async () => {
  const db = seeded();
  await blockWithWrongReader(db);
  const claim = db.docs.get("pending_purchase_claims/c");
  assert.equal(claim.status, "blocked");
  assert.equal(claim.blockedReason, "verified_email_mismatch");
  assert.equal(claim.manualReviewRequired, true);
  assert.equal(entitlementCount(db), 0);
});

test("correct verified purchase-email account reconciles the blocked claim", async () => {
  const db = seeded();
  await blockWithWrongReader(db);
  const result = await claimPendingPurchase(
    db,
    claimInput({ correlationId: "correct-account-retry" })
  );
  const claim = db.docs.get("pending_purchase_claims/c");
  assert.equal(result.replay, false);
  assert.equal(result.entitlementIds.length, 1);
  assert.equal(claim.status, "claimed");
  assert.equal(claim.claimedUid, "correct_uid");
  assert.equal(claim.manualReviewRequired, false);
  assert.equal(claim.blockedReason, null);
  assert.equal(entitlementCount(db), 1);
  assert.equal(auditEvents(db, "purchase_claim.reconciled").length, 1);
});

test("original wrong Gmail account remains blocked", async () => {
  const db = seeded();
  await blockWithWrongReader(db);
  await assert.rejects(
    () =>
      claimPendingPurchase(
        db,
        claimInput({
          readerUid: "wrong_gmail_uid",
          verifiedEmail: "wrong@gmail.com",
          correlationId: "wrong-retry",
        })
      ),
    /PURCHASE_CLAIM_BLOCKED/
  );
  assert.equal(entitlementCount(db), 0);
});

test("reconciled claim cannot create duplicate entitlement or audit records", async () => {
  const db = seeded();
  await blockWithWrongReader(db);
  const first = await claimPendingPurchase(db, claimInput());
  const second = await claimPendingPurchase(
    db,
    claimInput({ correlationId: "later-retry" })
  );
  assert.equal(first.entitlementIds.length, 1);
  assert.equal(second.replay, true);
  assert.equal(entitlementCount(db), 1);
  assert.equal(auditEvents(db, "purchase_claim.reconciled").length, 1);
});

test("already-claimed purchase cannot be reconciled by another UID", async () => {
  const db = seeded();
  await claimPendingPurchase(db, claimInput());
  await assert.rejects(
    () =>
      claimPendingPurchase(
        db,
        claimInput({ readerUid: "other_uid", correlationId: "other-reader" })
      ),
    /PURCHASE_ALREADY_CLAIMED/
  );
  assert.equal(entitlementCount(db), 1);
  assert.equal(auditEvents(db, "purchase_claim.reconciled").length, 0);
});

test("unverified or inactive accounts cannot reconcile", async () => {
  for (const overrides of [
    { emailVerified: false },
    { accountStatus: "disabled" },
  ]) {
    const db = seeded();
    await blockWithWrongReader(db);
    await assert.rejects(
      () => claimPendingPurchase(db, claimInput(overrides)),
      /READER_(?:EMAIL_NOT_VERIFIED|ACCOUNT_NOT_ACTIVE)/
    );
    assert.equal(entitlementCount(db), 0);
  }
});

test("incorrect purchase email hash cannot reconcile", async () => {
  const db = seeded();
  await blockWithWrongReader(db);
  db.docs.get("pending_purchase_claims/c").purchaseEmailHash = sha256Id(
    "reader-purchase-email",
    "different@example.com"
  );
  await assert.rejects(
    () => claimPendingPurchase(db, claimInput()),
    /PURCHASE_CLAIM_BLOCKED/
  );
  assert.equal(entitlementCount(db), 0);
});

test("an existing purchase entitlement prevents reconciliation", async () => {
  const db = seeded();
  await blockWithWrongReader(db);
  db.docs.set("reader_entitlements/existing", {
    purchaseId: "p",
    readerUid: "another_uid",
    tenantId: "t",
    assetId: "a",
    status: "active",
  });
  await assert.rejects(
    () => claimPendingPurchase(db, claimInput()),
    /PURCHASE_CLAIM_BLOCKED/
  );
  assert.equal(entitlementCount(db), 1);
});

test("reconciliation audit ID is deterministic and append-only", async () => {
  const db = seeded();
  await blockWithWrongReader(db);
  await claimPendingPurchase(db, claimInput({ correlationId: "first-request" }));
  const expectedId = deterministicAuditEventId({
    eventType: "purchase_claim.reconciled",
    subjectId: "c",
    correlationId: "reconcile:c",
    idempotencyKey: "verified-email:correct_uid",
  });
  const auditPath = `reader_audit_events/${expectedId}`;
  const original = db.docs.get(auditPath);
  assert.equal(original.eventType, "purchase_claim.reconciled");

  const replay = await claimPendingPurchase(
    db,
    claimInput({ correlationId: "second-request" })
  );
  assert.equal(replay.replay, true);
  assert.equal(db.docs.get(auditPath), original);
  assert.equal(auditEvents(db, "purchase_claim.reconciled").length, 1);
});
