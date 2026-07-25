import assert from "node:assert/strict"
import test from "node:test"

import { createAuthorSubscriptionPaymentProcessor } from "../author-subscription.ts"

function createHarness(options = {}) {
  const references = {
    license: { kind: "license" },
    user: { kind: "user" },
    fulfillment: { kind: "fulfillment" },
  }
  const state = {
    license: options.license || {
      status: "active",
      authorEmail: "author@example.com",
    },
    user: {},
    fulfillment: options.fulfillment || null,
    writes: [],
    timestamp: 0,
  }
  const transaction = {
    async get(reference) {
      const value = state[reference.kind]
      return {
        exists: Boolean(value),
        data: () => value || undefined,
      }
    },
    set(reference, payload) {
      state[reference.kind] = { ...(state[reference.kind] || {}), ...payload }
      state.writes.push({ operation: "set", target: reference.kind, payload })
    },
    create(reference, payload) {
      state[reference.kind] = payload
      state.writes.push({ operation: "create", target: reference.kind, payload })
    },
  }
  const dependencies = {
    async getLicenseReference() { return references.license },
    async getUserReference() { return references.user },
    async getFulfillmentReference() { return references.fulfillment },
    async runTransaction(updateFunction) { return updateFunction(transaction) },
    serverTimestamp() {
      state.timestamp += 1
      return { serverTimestamp: state.timestamp }
    },
  }
  return {
    process: createAuthorSubscriptionPaymentProcessor(dependencies),
    state,
  }
}

function createEvent(overrides = {}) {
  return {
    id: "evt_subscription_1",
    type: "checkout.session.completed",
    ...overrides,
  }
}

function createSession(overrides = {}) {
  return {
    id: "cs_subscription_1",
    status: "complete",
    payment_status: "paid",
    subscription: "sub_1",
    customer: "cus_1",
    customer_email: "author@example.com",
    customer_details: { email: "author@example.com" },
    metadata: {
      checkoutType: "author_subscription",
      authorEmail: "author@example.com",
      studioKey: "KOBA-AUDIO-TEST",
      plan: "starter",
    },
    ...overrides,
  }
}

test("grants paid Blog Engine access to the author and active license", async () => {
  const { process, state } = createHarness()
  const result = await process(createEvent(), createSession())

  assert.deepEqual(result, { status: "created", plan: "starter" })
  assert.equal(state.user.hasContentEngineAccess, true)
  assert.equal(state.license.hasContentEngineAccess, true)
  assert.equal(state.user.plan, "starter")
  assert.equal(state.fulfillment.stripeSessionId, "cs_subscription_1")
  assert.equal(state.writes.filter((write) => write.operation === "create").length, 1)
})

test("treats repeated Stripe delivery as an idempotent fulfillment", async () => {
  const { process, state } = createHarness({
    fulfillment: { stripeSessionId: "cs_subscription_1", status: "fulfilled" },
  })
  const result = await process(createEvent(), createSession())

  assert.deepEqual(result, { status: "existing", plan: "starter" })
  assert.equal(state.writes.length, 0)
})

test("rejects unpaid subscription sessions without granting access", async () => {
  const { process, state } = createHarness()

  await assert.rejects(
    process(createEvent(), createSession({ payment_status: "unpaid" })),
    /completed, paid session/
  )
  assert.equal(state.writes.length, 0)
})

test("rejects a Stripe customer identity mismatch", async () => {
  const { process, state } = createHarness()

  await assert.rejects(
    process(
      createEvent(),
      createSession({ customer_details: { email: "different@example.com" } })
    ),
    /identity does not match/
  )
  assert.equal(state.writes.length, 0)
})
