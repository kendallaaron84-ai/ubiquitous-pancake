import assert from "node:assert/strict";
import test from "node:test";

import {
  accountTypeForModel,
  evaluateStripeAccount,
  readTenantPaymentProfile,
  requireActiveTenantPaymentProfile,
  resolvePlatformFeeAmount,
} from "../stripe-connect.ts";

test("maps explicit payment models to their locked Stripe account types", () => {
  assert.equal(accountTypeForModel("author_direct"), "standard");
  assert.equal(accountTypeForModel("koba_managed"), "express");
});

test("only marks a Stripe account active when every readiness gate passes", () => {
  const ready = evaluateStripeAccount({
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
  });
  assert.equal(ready.connectionStatus, "active");

  const blocked = evaluateStripeAccount({
    charges_enabled: true,
    payouts_enabled: false,
    details_submitted: true,
    requirements: { currently_due: ["external_account"], past_due: [], disabled_reason: null },
  });
  assert.equal(blocked.connectionStatus, "action_required");
});

test("rejects mismatched payment model and account type records", () => {
  assert.equal(readTenantPaymentProfile({
    paymentModel: "author_direct",
    stripeConnectAccountId: "acct_valid123",
    stripeAccountType: "express",
    connectionStatus: "active",
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  }), null);
});

test("fails closed when a tenant payment account needs action", () => {
  assert.throws(() => requireActiveTenantPaymentProfile({
    paymentModel: "author_direct",
    stripeConnectAccountId: "acct_valid123",
    stripeAccountType: "standard",
    connectionStatus: "action_required",
    chargesEnabled: true,
    payoutsEnabled: false,
    detailsSubmitted: true,
  }), /temporarily unavailable/i);
});

test("calculates optional platform fees from explicit basis-point configuration", () => {
  assert.equal(resolvePlatformFeeAmount(1997, "author_direct", {
    KOBA_AUTHOR_DIRECT_FEE_BPS: "500",
  }), 100);
  assert.equal(resolvePlatformFeeAmount(1997, "koba_managed", {}), 0);
});
