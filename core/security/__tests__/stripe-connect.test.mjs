import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("allows MVP authors to reach only the approved Stripe Connect and Nexus context routes", async () => {
  const middleware = await readFile(new URL("../../../middleware.ts", import.meta.url), "utf8");
  const allowlistStart = middleware.indexOf("const MVP_API_EXACT_PATHS");
  const allowlistEnd = middleware.indexOf(");", allowlistStart);
  const allowlist = middleware.slice(allowlistStart, allowlistEnd);

  assert.ok(allowlistStart >= 0 && allowlistEnd > allowlistStart);
  for (const route of [
    "/api/stripe/connect/sync",
    "/api/stripe/connect/onboard",
    "/api/stripe/connect/dashboard",
    "/api/nexus/context",
  ]) {
    assert.match(allowlist, new RegExp(`"${route.replaceAll("/", "\\/")}"`));
  }

  assert.doesNotMatch(allowlist, /"\/api\/stripe\/connect"/);
  assert.doesNotMatch(allowlist, /"\/api\/nexus\/websites"/);
  assert.doesNotMatch(allowlist, /"\/api\/admin\/authors"/);
  assert.match(middleware, /MVP_API_EXACT_PATHS\.has\(pathname\)/);
  assert.match(middleware, /This feature is not available for your account\./);
});

test("preserves the approved Stripe Connect methods while Nexus context remains GET-only", async () => {
  const [syncRoute, onboardRoute, dashboardRoute, nexusContextRoute] = await Promise.all([
    readFile(new URL("../../../app/api/stripe/connect/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../app/api/stripe/connect/onboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../app/api/stripe/connect/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../app/api/nexus/context/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(syncRoute, /export async function GET\(\)/);
  assert.match(syncRoute, /export async function POST\(\)/);
  assert.match(onboardRoute, /export async function GET\(\)/);
  assert.match(onboardRoute, /export async function POST\(request: Request\)/);
  assert.match(dashboardRoute, /export async function POST\(\)/);
  assert.match(nexusContextRoute, /export async function GET\(\)/);
  assert.doesNotMatch(nexusContextRoute, /export async function POST\(/);
});

test("keeps Stripe Connect session and authoritative tenant ownership enforcement unchanged", async () => {
  const [syncRoute, onboardRoute, dashboardRoute, serverBoundary] = await Promise.all([
    readFile(new URL("../../../app/api/stripe/connect/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../app/api/stripe/connect/onboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../app/api/stripe/connect/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../stripe-connect-server.ts", import.meta.url), "utf8"),
  ]);

  for (const route of [syncRoute, onboardRoute, dashboardRoute]) {
    assert.match(route, /DASHBOARD_SESSION_COOKIE/);
    assert.match(route, /verifyDashboardSession/);
    assert.match(route, /loadOwnedPaymentTenant\(session\)/);
  }

  assert.match(serverBoundary, /const studioKey = session\.studioKey\?\.trim\(\) \|\| ""/);
  assert.match(serverBoundary, /collection\("plugin_licenses"\)\.doc\(studioKey\)/);
  assert.match(serverBoundary, /ownerEmail !== session\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(syncRoute, /account\.metadata\?\.kobaStudioKey !== tenant\.studioKey/);
});
