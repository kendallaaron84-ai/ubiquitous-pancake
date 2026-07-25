import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import {
  accountTypeForModel,
  evaluateStripeAccount,
  isPaymentModel,
  readTenantPaymentProfile,
  type PaymentModel,
} from "@/core/security/stripe-connect";
import {
  createStripeClient,
  loadOwnedPaymentTenant,
  PaymentTenantError,
  persistStripeConnection,
} from "@/core/security/stripe-connect-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface OnboardBody { requestedModel?: unknown }

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json().catch(() => null)) as OnboardBody | null;
    if (!isPaymentModel(body?.requestedModel)) {
      return NextResponse.json(
        { success: false, error: "Choose how you want reader payments to be managed." },
        { status: 400 }
      );
    }
    const result = await createOnboardingLink(session, body.requestedModel);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const session = await requireSession();
    const tenant = await loadOwnedPaymentTenant(session);
    const profile = readTenantPaymentProfile(tenant.licenseData);
    if (!profile) throw new PaymentTenantError(409, "Start payment setup again from your dashboard.");
    const result = await createOnboardingLink(session, profile.paymentModel);
    return NextResponse.redirect(result.url, 303);
  } catch (error) {
    const base = resolveDashboardUrl();
    const message = error instanceof PaymentTenantError ? error.publicMessage : "Payment setup could not be resumed.";
    return NextResponse.redirect(`${base}/connect?stripe=error&message=${encodeURIComponent(message)}`, 303);
  }
}

async function createOnboardingLink(
  session: Awaited<ReturnType<typeof requireSession>>,
  requestedModel: PaymentModel
) {
  const tenant = await loadOwnedPaymentTenant(session);
  const stripe = createStripeClient();
  const existing = readTenantPaymentProfile(tenant.licenseData);
  if (existing && existing.paymentModel !== requestedModel) {
    throw new PaymentTenantError(
      409,
      "Your payment service is already configured. Contact KOBA-I support before changing financial responsibility."
    );
  }

  let account: Stripe.Account;
  if (existing) {
    account = await stripe.accounts.retrieve(existing.stripeConnectAccountId);
  } else {
    account = await stripe.accounts.create({
      type: accountTypeForModel(requestedModel),
      email: tenant.ownerEmail,
      metadata: {
        kobaStudioKey: tenant.studioKey,
        kobaAuthorUid: session.uid,
        kobaPaymentModel: requestedModel,
      },
    });
  }
  if (account.deleted) throw new PaymentTenantError(409, "The connected Stripe account is unavailable.");
  if (account.type !== accountTypeForModel(requestedModel)) {
    throw new PaymentTenantError(409, "The connected Stripe account type does not match your selected payment service.");
  }

  await persistStripeConnection({
    studioKey: tenant.studioKey,
    ownerEmail: tenant.ownerEmail,
    stripeConnectAccountId: account.id,
    paymentModel: requestedModel,
    readiness: evaluateStripeAccount(account),
  });

  const base = resolveDashboardUrl();
  const link = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${base}/api/stripe/connect/onboard`,
    return_url: `${base}/connect?stripe=return`,
    type: "account_onboarding",
    collection_options: { fields: "eventually_due" },
  });
  return { url: link.url, paymentModel: requestedModel };
}

async function requireSession() {
  const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
  if (!token) throw new PaymentTenantError(401, "Sign in to configure reader payments.");
  return verifyDashboardSession(token, resolveDashboardSessionSecret()).catch(() => {
    throw new PaymentTenantError(401, "Your dashboard session expired. Sign in again.");
  });
}

function resolveDashboardUrl(): string {
  const configured = process.env.KOBA_DASHBOARD_URL?.trim();
  if (!configured) throw new Error("KOBA_DASHBOARD_URL is required for Stripe Connect onboarding.");
  const url = new URL(configured);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Production Stripe Connect onboarding requires HTTPS.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid dashboard URL.");
  return url.origin;
}

function errorResponse(error: unknown) {
  if (error instanceof PaymentTenantError) {
    return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
  }
  console.error("Stripe Connect onboarding failed:", error);
  return NextResponse.json(
    { success: false, error: "Payment setup could not be started." },
    { status: 500 }
  );
}
