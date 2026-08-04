import type { Timestamp } from "firebase-admin/firestore";

export * from "./reader-contracts";

export type PrincipalType =
  | "wordpress_user"
  | "platform_user"
  | "verified_phone"
  | "verified_email";

export type CheckoutStatus =
  | "created"
  | "awaiting_payment"
  | "awaiting_verification"
  | "ready"
  | "cancelled"
  | "expired";

export type PaymentStatus =
  | "not_required"
  | "pending"
  | "confirmed"
  | "failed"
  | "refunded";

export type VerificationStatus =
  | "not_required"
  | "pending"
  | "verified"
  | "locked"
  | "expired";

export type OtpProvider = "mock" | "twilio_verify";

export interface EntitlementIdempotencyKey {
  id: string;
  tenantId: string;
  principalId: string;
  assetKey: string;
  currentEntitlementId: string;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CanonicalEntitlement {
  id: string;
  tenantId: string;
  assetKey: string;
  principalId: string;
  principalType: PrincipalType;
  phoneHash: string | null;
  userEmailHash: string | null;
  identityHashVersion: number;
  status: "active" | "revoked" | "refunded";
  source: "purchase" | "grant" | "promotion";
  checkoutSessionId: string;
  stripePaymentIntentId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CheckoutSession {
  id: string;
  checkoutClientSecretDigest: string;
  tenantId: string;
  assetKey: string;
  principalId: string | null;
  principalType: PrincipalType | null;
  phoneE164: string | null;
  phoneHash: string | null;
  identityHashVersion: number;
  checkoutStatus: CheckoutStatus;
  paymentStatus: PaymentStatus;
  verificationStatus: VerificationStatus;
  paymentProvider: "none" | "mock" | "stripe";
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  lastStripeEventId: string | null;
  productPriceId: string | null;
  productVersion: string | null;
  unitAmountMinor: number;
  currency: string;
  activeVerificationSessionId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
}

/**
 * Twilio Verify owns production OTP material. mockOtpDigest is populated only
 * by the explicitly selected local mock provider and must remain null when
 * provider is twilio_verify.
 */
export interface SecureVerificationSession {
  id: string;
  checkoutSessionId: string;
  tenantId: string;
  assetKey: string;
  phoneHash: string;
  provider: OtpProvider;
  providerVerificationSid: string | null;
  mockOtpDigest: string | null;
  dispatchAttemptId: string;
  status:
    | "pending_dispatch"
    | "pending"
    | "checking"
    | "consumed"
    | "locked"
    | "expired"
    | "delivery_failed";
  attemptCount: number;
  maxAttempts: number;
  activeCheckAttemptId: string | null;
  checkStartedAt: Timestamp | null;
  createdAt: Timestamp;
  sentAt: Timestamp | null;
  expiresAt: Timestamp;
  verifiedAt: Timestamp | null;
  consumedAt: Timestamp | null;
}

/**
 * Global, privacy-preserving SMS cost-control window. The document ID is the
 * already-keyed phoneHash, never a plaintext telephone number.
 */
export interface VerificationDispatchLimit {
  id: string;
  phoneHash: string;
  dispatchCount: number;
  windowStartedAt: Timestamp;
  lastDispatchedAt: Timestamp;
  blockedUntil: Timestamp | null;
  expiresAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MediaAccessGrant {
  id: string;
  checkoutSessionId: string;
  entitlementId: string;
  principalId: string;
  tenantId: string;
  assetKey: string;
  status: "active" | "expired" | "revoked";
  grantClientSecretDigest: string;
  tokenVersion: number;
  createdAt: Timestamp;
  lastTokenIssuedAt: Timestamp | null;
  revokedAt: Timestamp | null;
  expiresAt: Timestamp;
}
