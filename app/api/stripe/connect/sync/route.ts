import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import { evaluateStripeAccount, readTenantPaymentProfile } from "@/core/security/stripe-connect";
import {
  createStripeClient,
  loadOwnedPaymentTenant,
  PaymentTenantError,
  persistStripeConnection,
} from "@/core/security/stripe-connect-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() { return synchronize(); }
export async function POST() { return synchronize(); }

async function synchronize() {
  try {
    const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    if (!token) throw new PaymentTenantError(401, "Sign in to view payment setup.");
    const session = await verifyDashboardSession(
      token,
      resolveDashboardSessionSecret()
    ).catch(() => {
      throw new PaymentTenantError(401, "Your dashboard session expired. Sign in again.");
    });
    const tenant = await loadOwnedPaymentTenant(session);
    const profile = readTenantPaymentProfile(tenant.licenseData);
    if (!profile) {
      return NextResponse.json({
        success: true,
        configured: false,
        connectionStatus: "not_configured",
      });
    }
    const account = await createStripeClient().accounts.retrieve(profile.stripeConnectAccountId);
    if (account.deleted) throw new PaymentTenantError(409, "Your connected Stripe account is unavailable.");
    if (account.metadata?.kobaStudioKey !== tenant.studioKey) {
      throw new PaymentTenantError(403, "Stripe account ownership validation failed.");
    }
    const readiness = evaluateStripeAccount(account);
    await persistStripeConnection({
      studioKey: tenant.studioKey,
      ownerEmail: tenant.ownerEmail,
      stripeConnectAccountId: account.id,
      paymentModel: profile.paymentModel,
      readiness,
    });
    return NextResponse.json({
      success: true,
      configured: true,
      paymentModel: profile.paymentModel,
      stripeAccountType: profile.stripeAccountType,
      ...readiness,
    });
  } catch (error) {
    if (error instanceof PaymentTenantError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("Stripe Connect synchronization failed:", error);
    return NextResponse.json({ success: false, error: "Payment status could not be refreshed." }, { status: 500 });
  }
}
