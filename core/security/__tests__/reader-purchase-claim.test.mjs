import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { establishReaderIdentity } from "../reader-auth.ts";
import {
  claimReaderCheckoutPurchase,
  ReaderPurchaseClaimError,
} from "../reader-purchase-claim.ts";
import { createCanonicalReaderPurchaseProcessor } from "../reader-platform-stripe.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

const checkoutRouteSource = readFileSync(
  new URL("../../../app/api/checkout/listener-session/route.ts", import.meta.url),
  "utf8"
);

const sessionId = "cs_test_1234567890abcdef";
const readerEmail = "reader@example.com";
const checkoutReference = "checkout-reference-1";

function seedDb({ email = readerEmail, verified = true } = {}) {
  return createMemoryDb({
    "reader_profiles/reader_uid": {
      uid: "reader_uid",
      email,
      emailNormalized: email,
      emailVerified: verified,
      accountStatus: "active",
      authProvider: "password",
    },
    [`listener_checkout_sessions/${sessionId}`]: {
      stripeSessionId: sessionId,
      checkoutReference,
      assetKey: "asset_one",
      tenantKey: "KOBA-AUDIO-TEST",
      paymentModel: "koba_managed",
      stripeConnectAccountId: "acct_author",
      amountTotal: 3000,
      currency: "usd",
    },
  });
}

function checkoutSession({
  paid = true,
  email = readerEmail,
  includePhone = false,
} = {}) {
  return {
    id: sessionId,
    object: "checkout.session",
    created: 1_800_000_000,
    livemode: false,
    status: paid ? "complete" : "open",
    payment_status: paid ? "paid" : "unpaid",
    amount_total: 3000,
    currency: "usd",
    customer: "cus_reader",
    customer_email: email,
    customer_details: {
      email,
      ...(includePhone ? { phone: "+12105550123" } : {}),
    },
    payment_intent: "pi_reader",
    metadata: {
      checkoutType: "listener_purchase",
      tenantKey: "KOBA-AUDIO-TEST",
      assetKey: "asset_one",
      checkoutReference,
    },
  };
}

function lines(assetIds = ["asset_one"]) {
  const amount = Math.floor(3000 / assetIds.length);
  return {
    object: "list",
    has_more: false,
    url: "/v1/checkout/sessions/line_items",
    data: assetIds.map((assetId, index) => ({
      id: `li_${index + 1}`,
      object: "item",
      amount_total: amount,
      currency: "usd",
      quantity: 1,
      price: {
        id: `price_${index + 1}`,
        object: "price",
        metadata: {},
        product: {
          id: `prod_${index + 1}`,
          object: "product",
          metadata: {
            tenantId: "KOBA-AUDIO-TEST",
            assetId,
          },
        },
      },
    })),
  };
}

function dependencies(db, state = { paid: true }, assetIds = ["asset_one"]) {
  const processor = createCanonicalReaderPurchaseProcessor({
    db,
    listLineItems: async () => lines(assetIds),
  });
  return {
    retrieveCheckoutSession: async () =>
      checkoutSession({ paid: state.paid, email: state.email || readerEmail }),
    recordCanonicalPurchase: (session, stripeAccountId) =>
      processor(
        {
          id: `evt_reconcile_${session.id}`,
          object: "event",
          api_version: null,
          created: session.created,
          data: { object: session },
          livemode: false,
          pending_webhooks: 0,
          request: null,
          type: "checkout.session.completed",
          ...(stripeAccountId ? { account: stripeAccountId } : {}),
        },
        session
      ),
  };
}

test("new verified Phase 5A reader claims a paid purchase without a phone number", async () => {
  const db = createMemoryDb({
    [`listener_checkout_sessions/${sessionId}`]: {
      stripeSessionId: sessionId,
      checkoutReference,
      assetKey: "asset_one",
      tenantKey: "KOBA-AUDIO-TEST",
      paymentModel: "koba_managed",
      stripeConnectAccountId: "acct_author",
      amountTotal: 3000,
      currency: "usd",
    },
  });
  const identity = await establishReaderIdentity(
    db,
    {
      uid: "reader_uid",
      email: readerEmail,
      email_verified: true,
      firebase: { sign_in_provider: "password", identities: {} },
      aud: "project",
      auth_time: 1,
      exp: 2,
      iat: 1,
      iss: "issuer",
      sub: "reader_uid",
    },
    "phase5a-to-5b"
  );
  const result = await claimReaderCheckoutPurchase(
    db,
    {
      checkoutSessionId: sessionId,
      readerUid: identity.readerUid,
      correlationId: "claim-new-reader",
    },
    dependencies(db)
  );
  assert.equal(result.status, "claimed");
  assert.equal(result.entitlementIds.length, 1);
  assert.equal(checkoutSession().customer_details.phone, undefined);
});

test("existing verified reader claim and duplicate browser submit are idempotent", async () => {
  const db = seedDb();
  const first = await claimReaderCheckoutPurchase(
    db,
    {
      checkoutSessionId: sessionId,
      readerUid: "reader_uid",
      correlationId: "claim-first",
    },
    dependencies(db)
  );
  const second = await claimReaderCheckoutPurchase(
    db,
    {
      checkoutSessionId: sessionId,
      readerUid: "reader_uid",
      correlationId: "claim-repeat",
    },
    dependencies(db)
  );
  assert.equal(first.status, "claimed");
  assert.equal(second.status, "claimed");
  assert.equal(second.replay, true);
  assert.equal(
    [...db.docs.keys()].filter((key) =>
      key.startsWith("reader_entitlements/")
    ).length,
    1
  );
});

test("unverified reader cannot claim", async () => {
  const db = seedDb({ verified: false });
  let retrieved = false;
  await assert.rejects(
    () =>
      claimReaderCheckoutPurchase(
        db,
        {
          checkoutSessionId: sessionId,
          readerUid: "reader_uid",
          correlationId: "claim-unverified",
        },
        {
          ...dependencies(db),
          retrieveCheckoutSession: async () => {
            retrieved = true;
            return checkoutSession();
          },
        }
      ),
    /READER_EMAIL_NOT_VERIFIED/
  );
  assert.equal(retrieved, false);
});

test("verified reader with wrong email cannot claim another purchase", async () => {
  const db = seedDb({ email: "other@example.com" });
  await assert.rejects(
    () =>
      claimReaderCheckoutPurchase(
        db,
        {
          checkoutSessionId: sessionId,
          readerUid: "reader_uid",
          correlationId: "claim-wrong-email",
        },
        dependencies(db)
      ),
    (error) =>
      error instanceof ReaderPurchaseClaimError &&
      error.code === "READER_PURCHASE_EMAIL_MISMATCH"
  );
  assert.equal(
    [...db.docs.keys()].filter((key) =>
      key.startsWith("reader_entitlements/")
    ).length,
    0
  );
});

test("webhook-first canonical recording is safely consumed by browser claim", async () => {
  const db = seedDb();
  const deps = dependencies(db);
  await deps.recordCanonicalPurchase(checkoutSession(), null);
  const result = await claimReaderCheckoutPurchase(
    db,
    {
      checkoutSessionId: sessionId,
      readerUid: "reader_uid",
      correlationId: "claim-after-webhook",
    },
    deps
  );
  assert.equal(result.status, "claimed");
  assert.equal(result.replay, true);
});

test("browser-first waits for Stripe then reconciles and survives reload", async () => {
  const db = seedDb();
  const state = { paid: false };
  const deps = dependencies(db, state);
  const pending = await claimReaderCheckoutPurchase(
    db,
    {
      checkoutSessionId: sessionId,
      readerUid: "reader_uid",
      correlationId: "claim-pending",
    },
    deps
  );
  assert.deepEqual(pending, { status: "pending" });
  assert.equal(
    [...db.docs.keys()].some((key) => key.startsWith("reader_purchases/")),
    false
  );
  state.paid = true;
  const claimed = await claimReaderCheckoutPurchase(
    db,
    {
      checkoutSessionId: sessionId,
      readerUid: "reader_uid",
      correlationId: "claim-reloaded",
    },
    deps
  );
  assert.equal(claimed.status, "claimed");
});

test("multi-asset checkout produces one entitlement per eligible line item", async () => {
  const db = seedDb();
  const result = await claimReaderCheckoutPurchase(
    db,
    {
      checkoutSessionId: sessionId,
      readerUid: "reader_uid",
      correlationId: "claim-bundle",
    },
    dependencies(db, { paid: true }, ["asset_one", "asset_two"])
  );
  assert.equal(result.status, "claimed");
  assert.equal(result.entitlementIds.length, 2);
  assert.equal(
    [...db.docs.keys()].filter((key) =>
      key.startsWith("reader_purchase_items/")
    ).length,
    2
  );
});

test("trusted checkout mismatch fails closed before entitlement creation", async () => {
  const db = seedDb();
  db.docs.get(`listener_checkout_sessions/${sessionId}`).checkoutReference =
    "different-reference";
  await assert.rejects(
    () =>
      claimReaderCheckoutPurchase(
        db,
        {
          checkoutSessionId: sessionId,
          readerUid: "reader_uid",
          correlationId: "claim-mismatch",
        },
        dependencies(db)
      ),
    (error) =>
      error instanceof ReaderPurchaseClaimError &&
      error.code === "READER_CHECKOUT_INVALID"
  );
});
test("active listener checkout returns to central claim and does not depend on SMS", () => {
  assert.match(
    checkoutRouteSource,
    /success_url: `\$\{dashboardOrigin\}\/reader\/claim\?session_id=\{CHECKOUT_SESSION_ID\}`/
  );
  assert.doesNotMatch(checkoutRouteSource, /api\/auth\/sms-(?:send|verify)/);
});