import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore"
import type Stripe from "stripe"

type SubscriptionPlan = "starter" | "pro"

export interface AuthorSubscriptionDependencies {
  getLicenseReference(studioKey: string): Promise<DocumentReference<DocumentData>>
  getUserReference(email: string): Promise<DocumentReference<DocumentData>>
  getFulfillmentReference(sessionId: string): Promise<DocumentReference<DocumentData>>
  runTransaction<T>(updateFunction: (transaction: Transaction) => Promise<T>): Promise<T>
  serverTimestamp(): FieldValue
}

const defaultDependencies: AuthorSubscriptionDependencies = {
  getLicenseReference: async (studioKey) => {
    const { adminDb } = await import("@/core/firebase-admin")
    return adminDb.collection("plugin_licenses").doc(studioKey)
  },
  getUserReference: async (email) => {
    const { adminDb } = await import("@/core/firebase-admin")
    return adminDb.collection("users").doc(email)
  },
  getFulfillmentReference: async (sessionId) => {
    const { adminDb } = await import("@/core/firebase-admin")
    return adminDb.collection("author_subscription_fulfillments").doc(sessionId)
  },
  runTransaction: async (updateFunction) => {
    const { adminDb } = await import("@/core/firebase-admin")
    return adminDb.runTransaction(updateFunction)
  },
  serverTimestamp: () => FieldValue.serverTimestamp(),
}

export function createAuthorSubscriptionPaymentProcessor(
  dependencies: AuthorSubscriptionDependencies = defaultDependencies
) {
  return async function processAuthorSubscriptionPayment(
    event: Stripe.Event,
    session: Stripe.Checkout.Session
  ): Promise<{ status: "created" | "existing"; plan: SubscriptionPlan }> {
  if (session.metadata?.checkoutType !== "author_subscription") {
    throw new Error("Stripe session is not an author subscription checkout.")
  }
  if (event.type !== "checkout.session.completed") {
    throw new Error("Author subscriptions are fulfilled from completed checkout sessions only.")
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    throw new Error("Author subscription access requires a completed, paid session.")
  }

  const plan = normalizePlan(session.metadata.plan)
  const metadataEmail = clean(session.metadata.authorEmail).toLowerCase()
  const stripeEmail = clean(
    session.customer_details?.email || session.customer_email
  ).toLowerCase()
  const studioKey = clean(session.metadata.studioKey)
  if (!metadataEmail || !stripeEmail || metadataEmail !== stripeEmail) {
    throw new Error("Stripe customer identity does not match the subscription workspace.")
  }
  if (!studioKey) {
    throw new Error("Author subscription checkout is missing its StudioKey.")
  }

  const [licenseRef, userRef, fulfillmentRef] = await Promise.all([
    dependencies.getLicenseReference(studioKey),
    dependencies.getUserReference(metadataEmail),
    dependencies.getFulfillmentReference(session.id),
  ])
  const subscriptionId = stripeObjectId(session.subscription)
  const customerId = stripeObjectId(session.customer)
  let status: "created" | "existing" = "created"

  await dependencies.runTransaction(async (transaction: Transaction) => {
    const [fulfillmentSnapshot, licenseSnapshot] = await Promise.all([
      transaction.get(fulfillmentRef),
      transaction.get(licenseRef),
    ])
    if (fulfillmentSnapshot.exists) {
      status = "existing"
      return
    }

    const licenseData = licenseSnapshot.data() || {}
    if (
      !licenseSnapshot.exists ||
      licenseData.status !== "active" ||
      clean(licenseData.authorEmail).toLowerCase() !== metadataEmail
    ) {
      throw new Error("The paid subscription is not linked to an active author license.")
    }

    const timestamp = dependencies.serverTimestamp()
    const accessPatch = {
      plan,
      subscriptionTier: plan,
      hasContentEngineAccess: true,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      subscriptionStatus: "active",
      updatedAt: timestamp,
    }

    transaction.set(userRef, { email: metadataEmail, studioKey, ...accessPatch }, { merge: true })
    transaction.set(licenseRef, accessPatch, { merge: true })
    transaction.create(fulfillmentRef, {
      stripeEventId: event.id,
      stripeSessionId: session.id,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      authorEmail: metadataEmail,
      studioKey,
      plan,
      status: "fulfilled",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  })

  return { status, plan }
  }
}

export const processAuthorSubscriptionPayment =
  createAuthorSubscriptionPaymentProcessor()

function normalizePlan(value: unknown): SubscriptionPlan {
  if (value === "starter" || value === "pro") return value
  throw new Error("Stripe subscription checkout contains an invalid plan.")
}

function stripeObjectId(value: string | { id: string } | null): string | null {
  if (typeof value === "string") return value
  return value && typeof value.id === "string" ? value.id : null
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
