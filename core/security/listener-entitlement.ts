import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import Stripe from "stripe";

type ListenerEntitlementResult = {
  success: boolean;
  status: "processed" | "replay" | "ignored";
};

export interface ListenerEntitlementDependencies {
  getProduct(
    assetKey: string
  ): Promise<Pick<DocumentSnapshot<DocumentData>, "exists" | "data">>;
  getEntitlementReference(
    entitlementId: string
  ): Promise<DocumentReference<DocumentData>>;
  getCheckoutReference(
    stripeSessionId: string
  ): Promise<DocumentReference<DocumentData>>;
  runTransaction<T>(
    updateFunction: (transaction: Transaction) => Promise<T>
  ): Promise<T>;
  serverTimestamp(): FieldValue;
}

function normalizePhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const defaultDependencies: ListenerEntitlementDependencies = {
  getProduct: async (assetKey) => {
    const { adminDb } = await import("@/core/firebase-admin");
    return adminDb.collection("products").doc(assetKey).get();
  },
  getEntitlementReference: async (entitlementId) => {
    const { adminDb } = await import("@/core/firebase-admin");
    return adminDb.collection("entitlements").doc(entitlementId);
  },
  getCheckoutReference: async (stripeSessionId) => {
    const { adminDb } = await import("@/core/firebase-admin");
    return adminDb.collection("listener_checkout_sessions").doc(stripeSessionId);
  },
  runTransaction: async (updateFunction) => {
    const { adminDb } = await import("@/core/firebase-admin");
    return adminDb.runTransaction(updateFunction);
  },
  serverTimestamp: () => FieldValue.serverTimestamp(),
};

export function createListenerPurchaseEntitlementProcessor(
  dependencies: ListenerEntitlementDependencies = defaultDependencies
) {
  return async function processListenerPurchaseEntitlement(
    event: Stripe.Event,
    session: Stripe.Checkout.Session
  ): Promise<ListenerEntitlementResult> {
    if (
      session.status !== "complete" ||
      session.payment_status !== "paid"
    ) {
      return { success: true, status: "ignored" };
    }

    const assetKey = cleanString(
      session.metadata?.assetKey || session.metadata?.assetId
    );
    const metadataTenantKey = cleanString(session.metadata?.tenantKey);
    if (!assetKey || !metadataTenantKey) {
      return { success: false, status: "ignored" };
    }

    const productSnapshot = await dependencies.getProduct(assetKey);
    if (!productSnapshot.exists) {
      return { success: false, status: "ignored" };
    }

    const productData = productSnapshot.data() || {};
    const tenantKey =
      cleanString(productData.studioKey) ||
      cleanString(productData.wpStudioKey);
    const productStatus = cleanString(productData.status).toLowerCase();
    const isPublished =
      productData.isPublished === true ||
      ["active", "publish", "published"].includes(productStatus);
    const unitPrice = Number(productData.price ?? productData.unitPrice ?? 0);

    if (
      !tenantKey ||
      metadataTenantKey !== tenantKey ||
      !isPublished ||
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0
    ) {
      return { success: false, status: "ignored" };
    }

    const normalizedPhone = normalizePhoneDigits(
      session.customer_details?.phone || ""
    );
    if (normalizedPhone.length !== 10) {
      return { success: false, status: "ignored" };
    }

    const entitlementId = `${tenantKey}_${assetKey}_${normalizedPhone}`;
    const entitlementReference =
      await dependencies.getEntitlementReference(entitlementId);
    const checkoutReference =
      await dependencies.getCheckoutReference(session.id);
    const customerEmail = cleanString(
      session.customer_details?.email || session.customer_email
    ).toLowerCase();
    const paymentIntent = session.payment_intent;
    const paymentIntentId =
      typeof paymentIntent === "string"
        ? paymentIntent
        : paymentIntent && typeof paymentIntent === "object"
          ? cleanString(paymentIntent.id) || null
          : null;

    return dependencies.runTransaction(async (transaction: Transaction) => {
      const [checkoutSnapshot, entitlementSnapshot] = await Promise.all([
        transaction.get(checkoutReference),
        transaction.get(entitlementReference),
      ]);

      if (!checkoutSnapshot.exists) {
        return { success: false, status: "ignored" as const };
      }
      const checkout = checkoutSnapshot.data() || {};
      const checkoutReferenceValue = cleanString(session.metadata?.checkoutReference);
      const paymentModel = cleanString(checkout.paymentModel);
      const connectedAccountId = cleanString(checkout.stripeConnectAccountId);
      const eventAccountId = cleanString(event.account);
      if (
        cleanString(checkout.assetKey) !== assetKey ||
        cleanString(checkout.tenantKey) !== tenantKey ||
        cleanString(checkout.checkoutReference) !== checkoutReferenceValue ||
        Number(checkout.amountTotal) !== Number(session.amount_total) ||
        (paymentModel !== "author_direct" && paymentModel !== "koba_managed") ||
        !connectedAccountId ||
        (paymentModel === "author_direct" && eventAccountId !== connectedAccountId) ||
        (paymentModel === "koba_managed" && eventAccountId !== "")
      ) {
        return { success: false, status: "ignored" as const };
      }

      if (
        entitlementSnapshot.exists &&
        entitlementSnapshot.data()?.stripeEventId === event.id
      ) {
        return { success: true, status: "replay" as const };
      }

      transaction.set(checkoutReference, {
        status: "processed",
        stripeEventId: event.id,
        updatedAt: dependencies.serverTimestamp(),
      }, { merge: true });

      const updatePayload: Record<string, unknown> = {
        tenantKey,
        studioKey: tenantKey,
        assetId: assetKey,
        assetKey,
        customerPhone: normalizedPhone,
        phoneNumber: normalizedPhone,
        customerEmail: customerEmail || null,
        stripeSessionId: session.id,
        stripeEventId: event.id,
        stripePaymentIntentId: paymentIntentId,
        status: "active",
        purchaseType: "stripe_listener_purchase",
        amountTotal: session.amount_total,
        currency: session.currency,
        updatedAt: dependencies.serverTimestamp(),
      };

      if (!entitlementSnapshot.exists) {
        updatePayload.purchasedAt = dependencies.serverTimestamp();
        transaction.set(entitlementReference, updatePayload);
      } else {
        transaction.update(entitlementReference, updatePayload);
      }

      return { success: true, status: "processed" as const };
    });
  };
}

export const processListenerPurchaseEntitlement =
  createListenerPurchaseEntitlementProcessor();
