import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminServices,
} from "@/core/firebase-admin";
import {
  ReaderAuthError,
  resolveReaderIdentitySession,
} from "@/core/security/reader-auth";
import {
  claimReaderCheckoutPurchase,
  ReaderPurchaseClaimError,
} from "@/core/security/reader-purchase-claim";
import { createCanonicalReaderPurchaseProcessor } from "@/core/security/reader-platform-stripe";
import { readReaderSessionCookie } from "@/core/security/reader-session-cookie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeFailure(status: number, code: string, error: string) {
  return NextResponse.json(
    { success: false, code, error },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: Request) {
  let body: { checkoutSessionId?: unknown };
  try {
    body = (await request.json()) as { checkoutSessionId?: unknown };
  } catch {
    return safeFailure(
      400,
      "READER_CLAIM_PAYLOAD_INVALID",
      "A valid purchase claim request is required."
    );
  }

  let services;
  try {
    services = getFirebaseAdminServices();
  } catch (error: unknown) {
    console.error("Reader purchase claim configuration failed.", {
      code: "FIREBASE_ADMIN_NOT_CONFIGURED",
      missingVariables:
        error instanceof FirebaseAdminConfigurationError
          ? error.missingVariables
          : [],
    });
    return safeFailure(
      500,
      "FIREBASE_ADMIN_NOT_CONFIGURED",
      "Reader purchase claiming is not configured on this server."
    );
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return safeFailure(
      503,
      "STRIPE_CONFIGURATION_MISSING",
      "Reader purchase claiming is temporarily unavailable."
    );
  }

  try {
    const reader = await resolveReaderIdentitySession(
      services.db,
      readReaderSessionCookie(request.headers.get("cookie"))
    );
    const stripe = new Stripe(stripeSecret);
    const canonicalProcessor = createCanonicalReaderPurchaseProcessor({
      db: services.db,
      listLineItems: (sessionId, stripeAccountId) =>
        stripe.checkout.sessions.listLineItems(
          sessionId,
          { limit: 100, expand: ["data.price.product"] },
          stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
        ),
    });
    const result = await claimReaderCheckoutPurchase(
      services.db,
      {
        checkoutSessionId:
          typeof body.checkoutSessionId === "string"
            ? body.checkoutSessionId
            : "",
        readerUid: reader.readerUid,
        correlationId:
          request.headers.get("x-request-id")?.trim() || randomUUID(),
      },
      {
        retrieveCheckoutSession: (sessionId, stripeAccountId) =>
          stripe.checkout.sessions.retrieve(
            sessionId,
            { expand: ["customer", "payment_intent"] },
            stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
          ),
        recordCanonicalPurchase: (session, stripeAccountId) =>
          canonicalProcessor(
            {
              id: `checkout-reconciliation:${session.id}`,
              object: "event",
              api_version: null,
              created: session.created,
              data: { object: session },
              livemode: session.livemode,
              pending_webhooks: 0,
              request: null,
              type: "checkout.session.completed",
              ...(stripeAccountId ? { account: stripeAccountId } : {}),
            } as Stripe.Event,
            session
          ),
      }
    );

    if (result.status === "pending") {
      return NextResponse.json(
        {
          success: false,
          pending: true,
          code: "READER_PURCHASE_PAYMENT_PENDING",
          error:
            "Stripe is still confirming this payment. Retry in a moment.",
        },
        {
          status: 202,
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": "3",
          },
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        purchaseId: result.purchaseId,
        entitlementIds: result.entitlementIds,
        entitlementCount: result.entitlementIds.length,
        replay: result.replay,
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: unknown) {
    if (error instanceof ReaderAuthError) {
      return safeFailure(error.status, error.code, error.message);
    }
    if (error instanceof ReaderPurchaseClaimError) {
      return safeFailure(error.status, error.code, error.message);
    }
    console.error("Reader purchase claim failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof Error ? error.message : "UNKNOWN",
    });
    return safeFailure(
      500,
      "READER_PURCHASE_CLAIM_FAILED",
      "KOBA-I could not complete this purchase claim."
    );
  }
}
