import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import { readTenantPaymentProfile } from "@/core/security/stripe-connect";
import {
  createStripeClient,
  loadOwnedPaymentTenant,
  PaymentTenantError,
} from "@/core/security/stripe-connect-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    if (!token) throw new PaymentTenantError(401, "Sign in to manage reader payments.");
    const session = await verifyDashboardSession(
      token,
      resolveDashboardSessionSecret()
    ).catch(() => {
      throw new PaymentTenantError(401, "Your dashboard session expired. Sign in again.");
    });
    const tenant = await loadOwnedPaymentTenant(session);
    const profile = readTenantPaymentProfile(tenant.licenseData);
    if (!profile || profile.connectionStatus !== "active") {
      throw new PaymentTenantError(
        409,
        "Complete Stripe setup before opening payment management."
      );
    }

    if (profile.stripeAccountType === "standard") {
      return NextResponse.json({
        success: true,
        url: "https://dashboard.stripe.com/",
      });
    }

    const loginLink = await createStripeClient().accounts.createLoginLink(
      profile.stripeConnectAccountId
    );
    return NextResponse.json({ success: true, url: loginLink.url });
  } catch (error: unknown) {
    if (error instanceof PaymentTenantError) {
      return NextResponse.json(
        { success: false, error: error.publicMessage },
        { status: error.status }
      );
    }
    console.error("Stripe dashboard access failed:", error);
    return NextResponse.json(
      { success: false, error: "Stripe account management could not be opened." },
      { status: 500 }
    );
  }
}
