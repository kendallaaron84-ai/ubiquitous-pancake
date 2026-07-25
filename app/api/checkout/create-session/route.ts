import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import Stripe from "stripe";

import { adminDb } from "@/core/firebase-admin";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import { loadContentEngineAccess } from "@/core/security/content-engine-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubscriptionPlan = "starter" | "pro";

type CheckoutRequestBody = {
  plan?: unknown;
};

const STRIPE_PRICE_BY_PLAN: Readonly<
  Record<SubscriptionPlan, string | undefined>
> = Object.freeze({
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
});

function resolvePriceId(plan: SubscriptionPlan): string | null {
  const priceId = STRIPE_PRICE_BY_PLAN[plan];
  return priceId?.trim() || null;
}

function resolveApplicationUrl(request: Request): string {
  const configuredUrl = process.env.KOBA_DASHBOARD_URL?.trim();
  const candidate = configuredUrl || new URL(request.url).origin;
  const parsedUrl = new URL(candidate);

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Application URL must use HTTP or HTTPS.");
  }

  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("Production checkout redirects require HTTPS.");
  }

  return parsedUrl.origin;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CheckoutRequestBody | null;
    const plan = body?.plan;

    const sessionToken = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Sign in before choosing a Blog Engine plan." },
        { status: 401 }
      );
    }

    let dashboardSession;
    try {
      dashboardSession = await verifyDashboardSession(
        sessionToken,
        resolveDashboardSessionSecret()
      );
    } catch {
      return NextResponse.json(
        { success: false, error: "Your session expired. Sign in again." },
        { status: 401 }
      );
    }

    const authorEmail = dashboardSession.email.trim().toLowerCase();
    const studioKey = dashboardSession.studioKey?.trim();
    if (!studioKey) {
      return NextResponse.json(
        { success: false, error: "Your author account is not linked to a StudioKey yet." },
        { status: 409 }
      );
    }

    const { hasContentEngineAccess } = await loadContentEngineAccess(
      adminDb,
      dashboardSession
    );
    if (hasContentEngineAccess) {
      return NextResponse.json(
        {
          success: false,
          code: "CONTENT_ENGINE_ALREADY_ACTIVE",
          error: "Your Blog Engine access is already active.",
          redirectUrl: "/nexus-engine",
        },
        { status: 409 }
      );
    }

    if (plan !== "starter" && plan !== "pro") {
      return NextResponse.json(
        { success: false, error: "Select a valid subscription plan." },
        { status: 400 }
      );
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
    const priceId = resolvePriceId(plan);

    if (!stripeSecretKey || !priceId) {
      console.error("Stripe checkout configuration is incomplete.", {
        hasSecretKey: Boolean(stripeSecretKey),
        configuredPlan: plan,
        hasPriceId: Boolean(priceId),
      });

      return NextResponse.json(
        { success: false, error: "Subscription checkout is temporarily unavailable." },
        { status: 503 }
      );
    }

    const applicationUrl = resolveApplicationUrl(request);
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: authorEmail,
      client_reference_id: authorEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        checkoutType: "author_subscription",
        authorEmail,
        studioKey,
        plan,
      },
      subscription_data: {
        metadata: {
          checkoutType: "author_subscription",
          authorEmail,
          studioKey,
          plan,
        },
      },
      success_url: `${applicationUrl}/visibility-cure?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${applicationUrl}/visibility-cure?checkout=cancelled`,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a hosted checkout URL.");
    }

    return NextResponse.json({
      success: true,
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error("Unable to create Stripe subscription checkout session.", error);

    return NextResponse.json(
      { success: false, error: "Unable to start subscription checkout." },
      { status: 500 }
    );
  }
}
