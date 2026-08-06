import assert from "node:assert/strict";
import test from "node:test";

import { processReaderPurchaseWebhook } from "../reader-purchase-webhook.ts";

const event = { id: "evt_paid" };
const session = { id: "cs_paid" };

test("legacy listener failure cannot prevent canonical purchase recording", async () => {
  let canonicalCalls = 0;
  const result = await processReaderPurchaseWebhook(event, session, {
    recordCanonicalPurchase: async () => {
      canonicalCalls += 1;
      return { purchaseId: "purchase", claimId: "claim", replay: false };
    },
    fulfillLegacyPurchase: async () => {
      throw new Error("LEGACY_PHONE_FULFILLMENT_FAILED");
    },
  });
  assert.equal(canonicalCalls, 1);
  assert.equal(result.canonical.purchaseId, "purchase");
  assert.deepEqual(result.legacy, {
    success: false,
    status: "failed_nonblocking",
  });
});

test("canonical failure remains retryable and prevents legacy side effects", async () => {
  let legacyCalls = 0;
  await assert.rejects(
    () =>
      processReaderPurchaseWebhook(event, session, {
        recordCanonicalPurchase: async () => {
          throw new Error("CANONICAL_WRITE_FAILED");
        },
        fulfillLegacyPurchase: async () => {
          legacyCalls += 1;
          return { success: true };
        },
      }),
    /CANONICAL_WRITE_FAILED/
  );
  assert.equal(legacyCalls, 0);
});

test("duplicate canonical webhook replay remains successful", async () => {
  const result = await processReaderPurchaseWebhook(event, session, {
    recordCanonicalPurchase: async () => ({
      purchaseId: "purchase",
      claimId: "claim",
      replay: true,
    }),
    fulfillLegacyPurchase: async () => ({
      success: true,
      status: "already_processed",
    }),
  });
  assert.equal(result.canonical.replay, true);
  assert.equal(result.legacy.success, true);
});
