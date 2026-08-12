import type Stripe from "stripe";

import { claimPendingPurchase } from "./services/purchase-claim-service.ts";
import { requireActiveVerifiedReader } from "./services/reader-profile-service.ts";
import type { ReaderPlatformDb } from "./services/service-support.ts";

const CHECKOUT_SESSION_PATTERN = /^cs_[A-Za-z0-9_]{12,}$/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const READER_PURCHASE_CLAIM_CODES = {
  checkoutSessionRequired: "CHECKOUT_SESSION_REQUIRED",
  checkoutNotFound: "READER_CHECKOUT_NOT_FOUND",
  checkoutInvalid: "READER_CHECKOUT_INVALID",
  paymentPending: "READER_PURCHASE_PAYMENT_PENDING",
  emailMismatch: "READER_PURCHASE_EMAIL_MISMATCH",
  alreadyClaimed: "READER_PURCHASE_ALREADY_CLAIMED",
  claimBlocked: "READER_PURCHASE_CLAIM_BLOCKED",
} as const;

type ReaderPurchaseClaimCode =
  (typeof READER_PURCHASE_CLAIM_CODES)[keyof typeof READER_PURCHASE_CLAIM_CODES];

export class ReaderPurchaseClaimError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: ReaderPurchaseClaimCode;

  constructor(
    status: 400 | 403 | 404 | 409,
    code: ReaderPurchaseClaimCode,
    message: string
  ) {
    super(message);
    this.name = "ReaderPurchaseClaimError";
    this.status = status;
    this.code = code;
  }
}

export interface ReaderPurchaseClaimDependencies {
  retrieveCheckoutSession: (
    sessionId: string,
    stripeAccountId: string | null
  ) => Promise<Stripe.Checkout.Session>;
  recordCanonicalPurchase: (
    session: Stripe.Checkout.Session,
    stripeAccountId: string | null
  ) => Promise<{ purchaseId: string; claimId: string; replay: boolean }>;
}

export async function claimReaderCheckoutPurchase(
  db: ReaderPlatformDb,
  input: {
    checkoutSessionId: string;
    readerUid: string;
    correlationId: string;
  },
  dependencies: ReaderPurchaseClaimDependencies
): Promise<
  | { status: "pending" }
  | {
      status: "claimed";
      purchaseId: string;
      entitlementIds: string[];
      replay: boolean;
    }
> {
  const checkoutSessionId = clean(input.checkoutSessionId);
  if (!CHECKOUT_SESSION_PATTERN.test(checkoutSessionId)) {
    throw new ReaderPurchaseClaimError(
      400,
      READER_PURCHASE_CLAIM_CODES.checkoutSessionRequired,
      "A valid Stripe checkout session is required."
    );
  }

  const profile = await requireActiveVerifiedReader(db, input.readerUid);
  const verifiedEmail = clean(profile.emailNormalized || profile.email).toLowerCase();

  const checkoutSnapshot = await db
    .collection("listener_checkout_sessions")
    .doc(checkoutSessionId)
    .get();
  if (!checkoutSnapshot.exists) {
    throw new ReaderPurchaseClaimError(
      404,
      READER_PURCHASE_CLAIM_CODES.checkoutNotFound,
      "This checkout could not be found."
    );
  }

  const checkout = checkoutSnapshot.data() || {};
  const paymentModel = clean(checkout.paymentModel);
  const connectedAccountId = clean(checkout.stripeConnectAccountId);
  const stripeAccountId =
    paymentModel === "author_direct" ? connectedAccountId : null;
  if (
    clean(checkout.stripeSessionId) !== checkoutSessionId ||
    !clean(checkout.checkoutReference) ||
    !clean(checkout.tenantKey) ||
    !["author_direct", "koba_managed"].includes(paymentModel) ||
    (paymentModel === "author_direct" && !connectedAccountId)
  ) {
    throw new ReaderPurchaseClaimError(
      409,
      READER_PURCHASE_CLAIM_CODES.checkoutInvalid,
      "The trusted checkout record is incomplete."
    );
  }

  const session = await dependencies.retrieveCheckoutSession(
    checkoutSessionId,
    stripeAccountId
  );
  if (session.id !== checkoutSessionId) {
    throw new ReaderPurchaseClaimError(
      409,
      READER_PURCHASE_CLAIM_CODES.checkoutInvalid,
      "Stripe returned a different checkout session."
    );
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return { status: "pending" };
  }

  const expectedAmount = Number(checkout.amountTotal);
  const expectedCurrency = clean(checkout.currency).toLowerCase();
  if (
    session.metadata?.checkoutType !== "listener_purchase" ||
    clean(session.metadata?.tenantKey) !== clean(checkout.tenantKey) ||
    clean(session.metadata?.checkoutReference) !==
      clean(checkout.checkoutReference) ||
    (Number.isFinite(expectedAmount) &&
      expectedAmount > 0 &&
      Number(session.amount_total) !== expectedAmount) ||
    (expectedCurrency &&
      clean(session.currency).toLowerCase() !== expectedCurrency)
  ) {
    throw new ReaderPurchaseClaimError(
      409,
      READER_PURCHASE_CLAIM_CODES.checkoutInvalid,
      "Stripe evidence does not match the trusted checkout record."
    );
  }

  const canonical = await dependencies.recordCanonicalPurchase(
    session,
    stripeAccountId
  );
  try {
    const claimed = await claimPendingPurchase(db, {
      claimId: canonical.claimId,
      readerUid: input.readerUid,
      verifiedEmail,
      emailVerified: profile.emailVerified === true,
      accountStatus: clean(profile.accountStatus),
      correlationId: input.correlationId,
    });
    return {
      status: "claimed",
      purchaseId: claimed.purchaseId,
      entitlementIds: claimed.entitlementIds,
      replay: canonical.replay || claimed.replay,
    };
  } catch (error: unknown) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PURCHASE_EMAIL_MISMATCH") {
      throw new ReaderPurchaseClaimError(
        403,
        READER_PURCHASE_CLAIM_CODES.emailMismatch,
        "Sign in with the verified email used for this purchase."
      );
    }
    if (code === "PURCHASE_ALREADY_CLAIMED") {
      throw new ReaderPurchaseClaimError(
        409,
        READER_PURCHASE_CLAIM_CODES.alreadyClaimed,
        "This purchase belongs to another reader account."
      );
    }
    if (code === "PURCHASE_CLAIM_BLOCKED") {
      throw new ReaderPurchaseClaimError(
        409,
        READER_PURCHASE_CLAIM_CODES.claimBlocked,
        "This purchase requires support review before it can be claimed."
      );
    }
    throw error;
  }
}
