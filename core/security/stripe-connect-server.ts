import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";

import { adminDb } from "@/core/firebase-admin";
import type { DashboardSessionClaims } from "@/core/security/dashboard-session";
import {
  accountTypeForModel,
  evaluateStripeAccount,
  type PaymentModel,
  type StripeAccountReadiness,
} from "@/core/security/stripe-connect";

export function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("STRIPE_CONFIGURATION_MISSING");
  return new Stripe(secretKey);
}

export async function loadOwnedPaymentTenant(session: DashboardSessionClaims) {
  const studioKey = session.studioKey?.trim() || "";
  if (!studioKey) throw new PaymentTenantError(403, "Your account is not connected to a StudioKey.");

  const licenseRef = adminDb.collection("plugin_licenses").doc(studioKey);
  const licenseSnapshot = await licenseRef.get();
  if (!licenseSnapshot.exists) throw new PaymentTenantError(404, "Your active author license was not found.");
  const licenseData = licenseSnapshot.data() || {};
  const ownerEmail = clean(licenseData.authorEmail || licenseData.authorId).toLowerCase();
  if (!ownerEmail || ownerEmail !== session.email.trim().toLowerCase()) {
    throw new PaymentTenantError(403, "This StudioKey belongs to another author account.");
  }

  return {
    studioKey,
    ownerEmail,
    licenseRef,
    licenseData,
    userRef: adminDb.collection("users").doc(ownerEmail),
  };
}

export async function persistStripeConnection(input: {
  studioKey: string;
  ownerEmail: string;
  stripeConnectAccountId: string;
  paymentModel: PaymentModel;
  readiness: StripeAccountReadiness;
}) {
  const patch = {
    paymentModel: input.paymentModel,
    stripeConnectAccountId: input.stripeConnectAccountId,
    stripeAccountType: accountTypeForModel(input.paymentModel),
    chargesEnabled: input.readiness.chargesEnabled,
    payoutsEnabled: input.readiness.payoutsEnabled,
    detailsSubmitted: input.readiness.detailsSubmitted,
    connectionStatus: input.readiness.connectionStatus,
    stripeRequirementsCurrentlyDue: input.readiness.currentlyDue,
    stripeRequirementsPastDue: input.readiness.pastDue,
    stripeDisabledReason: input.readiness.disabledReason,
    stripeStatusUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await adminDb.runTransaction(async (transaction: any) => {
    transaction.set(
      adminDb.collection("plugin_licenses").doc(input.studioKey),
      patch,
      { merge: true }
    );
    transaction.set(
      adminDb.collection("users").doc(input.ownerEmail),
      patch,
      { merge: true }
    );
  });
  return patch;
}

export async function syncConnectedAccountFromWebhook(account: Stripe.Account) {
  const studioKey = clean(account.metadata?.kobaStudioKey);
  if (!studioKey) throw new Error("Connected Stripe account is missing its KOBA-I StudioKey metadata.");

  const licenseRef = adminDb.collection("plugin_licenses").doc(studioKey);
  const snapshot = await licenseRef.get();
  if (!snapshot.exists) throw new Error("Connected Stripe account references an unknown StudioKey.");
  const data = snapshot.data() || {};
  if (clean(data.stripeConnectAccountId) !== account.id) {
    throw new Error("Connected Stripe account does not match the stored tenant payment record.");
  }
  const paymentModel = data.paymentModel;
  if (paymentModel !== "author_direct" && paymentModel !== "koba_managed") {
    throw new Error("Tenant payment model is missing or invalid.");
  }
  const ownerEmail = clean(data.authorEmail || data.authorId).toLowerCase();
  if (!ownerEmail) throw new Error("Tenant payment record is missing its author email.");

  return persistStripeConnection({
    studioKey,
    ownerEmail,
    stripeConnectAccountId: account.id,
    paymentModel,
    readiness: evaluateStripeAccount(account),
  });
}

export class PaymentTenantError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(status: number, publicMessage: string) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
