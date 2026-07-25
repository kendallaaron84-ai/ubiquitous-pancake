import type Stripe from "stripe";

export const PAYMENT_MODELS = ["author_direct", "koba_managed"] as const;

export type PaymentModel = (typeof PAYMENT_MODELS)[number];
export type StripeAccountType = "standard" | "express";
export type StripeConnectionStatus = "pending" | "active" | "action_required";

export interface TenantPaymentProfile {
  paymentModel: PaymentModel;
  stripeConnectAccountId: string;
  stripeAccountType: StripeAccountType;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  connectionStatus: StripeConnectionStatus;
}

export interface StripeAccountReadiness {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDue: string[];
  pastDue: string[];
  disabledReason: string | null;
  connectionStatus: StripeConnectionStatus;
}

export class StripeConnectConfigurationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;

  constructor(
    status: number,
    code: string,
    publicMessage: string
  ) {
    super(publicMessage);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function isPaymentModel(value: unknown): value is PaymentModel {
  return value === "author_direct" || value === "koba_managed";
}

export function accountTypeForModel(model: PaymentModel): StripeAccountType {
  return model === "author_direct" ? "standard" : "express";
}

export function readTenantPaymentProfile(
  value: Record<string, unknown>
): TenantPaymentProfile | null {
  const paymentModel = value.paymentModel;
  const stripeConnectAccountId = clean(value.stripeConnectAccountId);
  const stripeAccountType = value.stripeAccountType;
  const connectionStatus = value.connectionStatus;

  if (
    !isPaymentModel(paymentModel) ||
    !/^acct_[A-Za-z0-9]+$/.test(stripeConnectAccountId) ||
    (stripeAccountType !== "standard" && stripeAccountType !== "express") ||
    (connectionStatus !== "pending" &&
      connectionStatus !== "active" &&
      connectionStatus !== "action_required")
  ) {
    return null;
  }

  if (accountTypeForModel(paymentModel) !== stripeAccountType) {
    return null;
  }

  return {
    paymentModel,
    stripeConnectAccountId,
    stripeAccountType,
    chargesEnabled: value.chargesEnabled === true,
    payoutsEnabled: value.payoutsEnabled === true,
    detailsSubmitted: value.detailsSubmitted === true,
    connectionStatus,
  };
}

export function requireActiveTenantPaymentProfile(
  value: Record<string, unknown>
): TenantPaymentProfile {
  const profile = readTenantPaymentProfile(value);
  if (!profile) {
    throw new StripeConnectConfigurationError(
      422,
      "PAYMENT_CONFIGURATION_REQUIRED",
      "Purchases are not available until this author finishes payment setup."
    );
  }
  if (
    profile.connectionStatus !== "active" ||
    !profile.chargesEnabled ||
    !profile.payoutsEnabled ||
    !profile.detailsSubmitted
  ) {
    throw new StripeConnectConfigurationError(
      409,
      "PAYMENT_ACCOUNT_ACTION_REQUIRED",
      "Purchases are temporarily unavailable while this author's payment account is updated."
    );
  }
  return profile;
}

export function evaluateStripeAccount(
  account: Pick<
    Stripe.Account,
    "charges_enabled" | "payouts_enabled" | "details_submitted" | "requirements"
  >
): StripeAccountReadiness {
  const currentlyDue = stringList(account.requirements?.currently_due);
  const pastDue = stringList(account.requirements?.past_due);
  const disabledReason = clean(account.requirements?.disabled_reason) || null;
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const detailsSubmitted = account.details_submitted === true;
  const isActive =
    chargesEnabled &&
    payoutsEnabled &&
    detailsSubmitted &&
    currentlyDue.length === 0 &&
    pastDue.length === 0 &&
    disabledReason === null;

  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    currentlyDue,
    pastDue,
    disabledReason,
    connectionStatus: isActive
      ? "active"
      : detailsSubmitted || currentlyDue.length > 0 || pastDue.length > 0 || disabledReason
        ? "action_required"
        : "pending",
  };
}

export function resolvePlatformFeeAmount(
  amountInCents: number,
  model: PaymentModel,
  source: NodeJS.ProcessEnv = process.env
): number {
  const key = model === "author_direct"
    ? "KOBA_AUTHOR_DIRECT_FEE_BPS"
    : "KOBA_MANAGED_FEE_BPS";
  const raw = source[key]?.trim();
  if (!raw) return 0;

  const basisPoints = Number(raw);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints >= 10_000) {
    throw new StripeConnectConfigurationError(
      503,
      "INVALID_PLATFORM_FEE_CONFIGURATION",
      "Book checkout is temporarily unavailable."
    );
  }
  return Math.min(
    Math.max(0, Math.round((amountInCents * basisPoints) / 10_000)),
    Math.max(0, amountInCents - 1)
  );
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}
