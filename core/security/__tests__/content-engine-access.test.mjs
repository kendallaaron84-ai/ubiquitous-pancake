import assert from "node:assert/strict"
import test from "node:test"

import { resolveContentEngineAccess } from "../content-engine-access.ts"

const fullSession = {
  uid: "owner-uid",
  email: "owner@example.com",
  studioKey: "KOBA-AUDIO-OWNER",
  accessScope: "full",
}

test("administrative full scope does not grant paid Content Engine access", () => {
  assert.equal(resolveContentEngineAccess(fullSession, {}, {}), false)
})

test("an explicit Content Engine grant enables access", () => {
  assert.equal(
    resolveContentEngineAccess(fullSession, { hasContentEngineAccess: true }, {}),
    true
  )
})

test("a legacy plan label by itself does not unlock the paid feature", () => {
  assert.equal(resolveContentEngineAccess(fullSession, { plan: "pro" }, {}), false)
})

test("an active Stripe-backed Content Engine plan enables access", () => {
  assert.equal(
    resolveContentEngineAccess(
      fullSession,
      {
        plan: "pro",
        subscriptionStatus: "active",
        stripeSubscriptionId: "sub_123",
      },
      {}
    ),
    true
  )
})

test("audiobook and e-reader plugin ownership do not unlock Blog Engine", () => {
  assert.equal(
    resolveContentEngineAccess(
      fullSession,
      {},
      {
        entitlements: ["audiobook_plugin", "ereader_plugin"],
        features: ["audiobook_plugin", "ereader_plugin"],
      }
    ),
    false
  )
})
