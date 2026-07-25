import assert from "node:assert/strict";
import test from "node:test";

import {
  createListenerPurchaseEntitlementProcessor,
} from "../listener-entitlement.ts";

function createHarness(options = {}) {
  const state = {
    entitlement: options.existingEntitlement || null,
    entitlementId: null,
    setCalls: [],
    updateCalls: [],
    timestampCounter: 0,
    checkout: options.checkout || {
      assetKey: "abk_test-book",
      tenantKey: "studio_123",
      checkoutReference: "checkout_ref_1",
      paymentModel: "koba_managed",
      stripeConnectAccountId: "acct_managed_1",
      amountTotal: 1997,
      status: "created",
    },
    checkoutUpdates: [],
  };
  const product = options.product || {
    studioKey: "studio_123",
    status: "published",
    price: 19.97,
  };
  const reference = { kind: "entitlement" };
  const checkoutReference = { kind: "checkout" };
  const transaction = {
    async get(target) {
      if (target === checkoutReference) {
        return {
          exists: options.checkoutExists !== false,
          data: () => state.checkout,
        };
      }
      return {
        exists: Boolean(state.entitlement),
        data: () => state.entitlement || undefined,
      };
    },
    set(target, payload) {
      if (target === checkoutReference) {
        state.checkoutUpdates.push(payload);
        state.checkout = { ...state.checkout, ...payload };
        return;
      }
      state.setCalls.push(payload);
      state.entitlement = payload;
    },
    update(_reference, payload) {
      state.updateCalls.push(payload);
      state.entitlement = { ...state.entitlement, ...payload };
    },
  };
  const dependencies = {
    async getProduct() {
      return {
        exists: options.productExists !== false,
        data: () => product,
      };
    },
    getEntitlementReference(entitlementId) {
      state.entitlementId = entitlementId;
      return reference;
    },
    getCheckoutReference() {
      return checkoutReference;
    },
    async runTransaction(updateFunction) {
      return updateFunction(transaction);
    },
    serverTimestamp() {
      state.timestampCounter += 1;
      return { serverTimestamp: state.timestampCounter };
    },
  };

  return {
    process: createListenerPurchaseEntitlementProcessor(dependencies),
    state,
  };
}

function createEvent(id = "evt_listener_1") {
  return { id, type: "checkout.session.completed", account: undefined };
}

function createSession(overrides = {}) {
  return {
    id: "cs_listener_1",
    status: "complete",
    payment_status: "paid",
    amount_total: 1997,
    currency: "usd",
    payment_intent: "pi_listener_1",
    customer_email: null,
    customer_details: {
      email: "reader@example.com",
      phone: "+1 (210) 687-8982",
    },
    metadata: {
      checkoutType: "listener_purchase",
      assetKey: "abk_test-book",
      tenantKey: "studio_123",
      paymentModel: "koba_managed",
      checkoutReference: "checkout_ref_1",
    },
    ...overrides,
  };
}

test("creates the canonical paid listener entitlement", async () => {
  const { process, state } = createHarness();
  const result = await process(createEvent(), createSession());

  assert.deepEqual(result, { success: true, status: "processed" });
  assert.equal(
    state.entitlementId,
    "studio_123_abk_test-book_2106878982"
  );
  assert.equal(state.setCalls.length, 1);
  assert.equal(state.updateCalls.length, 0);
  assert.equal(state.entitlement.studioKey, "studio_123");
  assert.equal(state.entitlement.assetKey, "abk_test-book");
  assert.equal(state.entitlement.phoneNumber, "2106878982");
  assert.equal(state.entitlement.stripeEventId, "evt_listener_1");
  assert.ok(state.entitlement.purchasedAt);
  assert.ok(state.entitlement.updatedAt);
  assert.equal(state.checkout.status, "processed");
});

test("accepts a server-recorded direct charge only from its connected account", async () => {
  const { process, state } = createHarness({
    checkout: {
      assetKey: "abk_test-book",
      tenantKey: "studio_123",
      checkoutReference: "checkout_ref_1",
      paymentModel: "author_direct",
      stripeConnectAccountId: "acct_author_1",
      amountTotal: 1997,
      status: "created",
    },
  });
  const result = await process(
    { ...createEvent(), account: "acct_author_1" },
    createSession({
      metadata: {
        checkoutType: "listener_purchase",
        assetKey: "abk_test-book",
        tenantKey: "studio_123",
        paymentModel: "author_direct",
        checkoutReference: "checkout_ref_1",
      },
    })
  );
  assert.deepEqual(result, { success: true, status: "processed" });
  assert.equal(state.setCalls.length, 1);
});

test("rejects a forged direct charge that has no server checkout record", async () => {
  const { process, state } = createHarness({ checkoutExists: false });
  const result = await process(
    { ...createEvent(), account: "acct_attacker" },
    createSession()
  );
  assert.deepEqual(result, { success: false, status: "ignored" });
  assert.equal(state.setCalls.length, 0);
});

test("treats a repeated Stripe event as an idempotent replay", async () => {
  const { process, state } = createHarness({
    existingEntitlement: {
      stripeEventId: "evt_listener_1",
      purchasedAt: { original: true },
    },
  });
  const result = await process(createEvent(), createSession());

  assert.deepEqual(result, { success: true, status: "replay" });
  assert.equal(state.setCalls.length, 0);
  assert.equal(state.updateCalls.length, 0);
});

test("updates a later settlement event without replacing purchasedAt", async () => {
  const purchasedAt = { original: true };
  const { process, state } = createHarness({
    existingEntitlement: {
      stripeEventId: "evt_completed",
      purchasedAt,
    },
  });
  const result = await process(
    createEvent("evt_async_succeeded"),
    createSession()
  );

  assert.deepEqual(result, { success: true, status: "processed" });
  assert.equal(state.updateCalls.length, 1);
  assert.equal("purchasedAt" in state.updateCalls[0], false);
  assert.equal(state.entitlement.purchasedAt, purchasedAt);
});

test("does not grant an entitlement before payment settles", async () => {
  const { process, state } = createHarness();
  const result = await process(
    createEvent(),
    createSession({ payment_status: "unpaid" })
  );

  assert.deepEqual(result, { success: true, status: "ignored" });
  assert.equal(state.setCalls.length, 0);
  assert.equal(state.updateCalls.length, 0);
});

test("rejects a tenant metadata mismatch", async () => {
  const { process, state } = createHarness();
  const result = await process(
    createEvent(),
    createSession({
      metadata: {
        checkoutType: "listener_purchase",
        assetKey: "abk_test-book",
        tenantKey: "wrong_tenant",
      },
    })
  );

  assert.deepEqual(result, { success: false, status: "ignored" });
  assert.equal(state.setCalls.length, 0);
  assert.equal(state.updateCalls.length, 0);
});

test("rejects a missing Stripe phone identity", async () => {
  const { process, state } = createHarness();
  const result = await process(
    createEvent(),
    createSession({
      customer_details: { email: "reader@example.com", phone: null },
    })
  );

  assert.deepEqual(result, { success: false, status: "ignored" });
  assert.equal(state.setCalls.length, 0);
  assert.equal(state.updateCalls.length, 0);
});
