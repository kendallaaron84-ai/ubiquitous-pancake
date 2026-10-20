import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  DashboardRequestAuthError,
  requireDashboardRequestSession,
} from "@/core/security/dashboard-request-auth";
import { adminDb } from "@/core/firebase-admin";
import { loadContentEngineAccess } from "@/core/security/content-engine-access";
import { processAuthorSubscriptionPayment } from "@/core/security/author-subscription";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CompletionRequestBody = {
  sessionId?: unknown;
};

export async function POST(request: Request) {
  try {
    let dashboardSession;
    try {
      dashboardSession = await requireDashboardRequestSession(request);
    } catch (error) {
      const authError = error instanceof DashboardRequestAuthError ? error : null;
      return NextResponse.json(
        {
          success: false,
          code: authError?.code || "DASHBOARD_AUTHENTICATION_FAILED",
          error: authError?.publicMessage || "Sign in to finish activating your purchase.",
        },
        { status: authError?.status || 401 }
      );
    }

    const access = await loadContentEngineAccess(adminDb, dashboardSession);
    if (!access.hasOwnedActiveLicense) {
      return NextResponse.json(
        { success: false, code: "STUDIO_KEY_OWNERSHIP_MISMATCH", error: "The signed-in identity does not own this author workspace." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as CompletionRequestBody | null;
    const sessionId =
      typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
      return NextResponse.json(
        { success: false, error: "The Stripe Checkout reference is invalid." },
        { status: 400 }
      );
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeSecretKey) {
      return NextResponse.json(
        { success: false, error: "Checkout verification is temporarily unavailable." },
        { status: 503 }
      );
    }

    const stripe = new Stripe(stripeSecretKey);
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
    const metadataEmail = checkoutSession.metadata?.authorEmail?.trim().toLowerCase();
    const metadataStudioKey = checkoutSession.metadata?.studioKey?.trim();
    const signedInEmail = dashboardSession.email.trim().toLowerCase();
    const signedInStudioKey = dashboardSession.studioKey?.trim();

    if (
      checkoutSession.metadata?.checkoutType !== "author_subscription" ||
      !metadataEmail ||
      metadataEmail !== signedInEmail ||
      !metadataStudioKey ||
      metadataStudioKey !== signedInStudioKey
    ) {
      return NextResponse.json(
        { success: false, error: "This purchase does not belong to the signed-in workspace." },
        { status: 403 }
      );
    }

    const result = await processAuthorSubscriptionPayment(
      {
        id: `checkout-return:${checkoutSession.id}`,
        type: "checkout.session.completed",
      },
      checkoutSession
    );

    return NextResponse.json(
      { success: true, ...result },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error(
      "Unable to reconcile completed author subscription checkout.",
      error instanceof Error ? error.message : "Unknown completion failure."
    );
    return NextResponse.json(
      {
        success: false,
        error: "Your payment is safe, but access activation could not be confirmed yet.",
      },
      { status: 500 }
    );
  }
}
