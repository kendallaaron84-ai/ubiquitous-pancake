import type { DashboardSessionClaims } from "@/core/security/dashboard-session"

type RecordData = Record<string, unknown>

const PAID_CONTENT_ENGINE_PLANS = new Set([
  "starter",
  "pro",
  "studio",
  "enterprise",
  "content_engine",
  "blog_engine",
  "nexus_engine",
])

export interface ContentEngineAccessResult {
  hasContentEngineAccess: boolean
  userData: RecordData
  licenseData: RecordData
}

export async function loadContentEngineAccess(
  database: FirebaseFirestore.Firestore,
  session: DashboardSessionClaims
): Promise<ContentEngineAccessResult> {
  const email = session.email.trim().toLowerCase()
  const studioKey = clean(session.studioKey)
  const canonicalUserRef = database.collection("users").doc(email)
  const uidUserRef = database.collection("users").doc(session.uid)
  const licenseRef = studioKey
    ? database.collection("plugin_licenses").doc(studioKey)
    : null

  const [canonicalUserSnapshot, uidUserSnapshot, licenseSnapshot] =
    await Promise.all([
      canonicalUserRef.get(),
      uidUserRef.get(),
      licenseRef?.get() ?? Promise.resolve(null),
    ])

  const userData = canonicalUserSnapshot.exists
    ? canonicalUserSnapshot.data() || {}
    : uidUserSnapshot.data() || {}
  const rawLicenseData = licenseSnapshot?.data() || {}
  const licenseBelongsToSession =
    licenseSnapshot?.exists === true &&
    rawLicenseData.status === "active" &&
    clean(rawLicenseData.authorEmail).toLowerCase() === email
  const licenseData = licenseBelongsToSession ? rawLicenseData : {}

  return {
    hasContentEngineAccess: resolveContentEngineAccess(
      session,
      userData,
      licenseData
    ),
    userData,
    licenseData,
  }
}

export function resolveContentEngineAccess(
  _session: DashboardSessionClaims,
  userData: RecordData,
  licenseData: RecordData
): boolean {
  if (
    userData.hasContentEngineAccess === true ||
    licenseData.hasContentEngineAccess === true
  ) {
    return true
  }

  const plans = [
    userData.tier,
    userData.plan,
    userData.subscriptionTier,
    licenseData.tier,
    licenseData.plan,
  ].map((value) => clean(value).toLowerCase())

  const hasPaidPlan = plans.some((plan) => PAID_CONTENT_ENGINE_PLANS.has(plan))
  const hasActiveStripeSubscription =
    [userData, licenseData].some(
      (record) =>
        clean(record.subscriptionStatus).toLowerCase() === "active" &&
        clean(record.stripeSubscriptionId).startsWith("sub_")
    )

  return hasPaidPlan && hasActiveStripeSubscription
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
