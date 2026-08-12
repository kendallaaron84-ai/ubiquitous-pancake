import {
  normalizeReaderEmail,
  sha256Id,
} from "./reader-contracts/index.ts";
import { authorizeReaderAsset } from "./services/entitlement-service.ts";
import { claimPendingPurchase } from "./services/purchase-claim-service.ts";
import { requireActiveVerifiedReader } from "./services/reader-profile-service.ts";
import {
  readerPlatformCollections,
  type ReaderPlatformDb,
} from "./services/service-support.ts";

const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;
const MAX_EMAIL_PURCHASES = 50;

export const READER_PURCHASE_RECOVERY_CODES = {
  requestInvalid: "READER_PURCHASE_RECOVERY_REQUEST_INVALID",
  publicationNotFound: "READER_PURCHASE_RECOVERY_PUBLICATION_NOT_FOUND",
  accountSwitchRequired: "READER_PURCHASE_ACCOUNT_SWITCH_REQUIRED",
  ambiguous: "READER_PURCHASE_RECOVERY_AMBIGUOUS",
} as const;

type ReaderPurchaseRecoveryCode =
  (typeof READER_PURCHASE_RECOVERY_CODES)[keyof typeof READER_PURCHASE_RECOVERY_CODES];

export class ReaderPurchaseRecoveryError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: ReaderPurchaseRecoveryCode;

  constructor(
    status: ReaderPurchaseRecoveryError["status"],
    code: ReaderPurchaseRecoveryCode,
    message: string
  ) {
    super(message);
    this.name = "ReaderPurchaseRecoveryError";
    this.status = status;
    this.code = code;
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function eligibleClaim(claim: Record<string, unknown>, emailHash: string): boolean {
  const entitlementIds = Array.isArray(claim.entitlementIds)
    ? claim.entitlementIds.filter(Boolean)
    : [];
  const unclaimed =
    claim.status === "unclaimed" && !clean(claim.claimedUid) && entitlementIds.length === 0;
  const recoverableMismatch =
    claim.status === "blocked" &&
    claim.blockedReason === "verified_email_mismatch" &&
    claim.manualReviewRequired === true &&
    !clean(claim.claimedUid) &&
    entitlementIds.length === 0;
  return (unclaimed || recoverableMismatch) && claim.purchaseEmailHash === emailHash;
}

export async function recoverReaderPurchaseForAsset(
  db: ReaderPlatformDb,
  input: {
    readerUid: string;
    assetId: string;
    correlationId: string;
  }
): Promise<{
  status: "entitled" | "claimed";
  entitlementIds: string[];
}> {
  const assetId = clean(input.assetId);
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new ReaderPurchaseRecoveryError(
      400,
      READER_PURCHASE_RECOVERY_CODES.requestInvalid,
      "A valid publication is required."
    );
  }

  const profile = await requireActiveVerifiedReader(db, input.readerUid);
  const verifiedEmail = clean(profile.emailNormalized || profile.email).toLowerCase();
  const emailHash = sha256Id(
    "reader-purchase-email",
    normalizeReaderEmail(verifiedEmail)
  );

  const productSnapshot = await db.collection("products").doc(assetId).get();
  if (!productSnapshot.exists) {
    throw new ReaderPurchaseRecoveryError(
      404,
      READER_PURCHASE_RECOVERY_CODES.publicationNotFound,
      "This publication could not be found."
    );
  }
  const product = productSnapshot.data() || {};
  const storedAssetId = clean(product.assetId || product.assetKey);
  const tenantId = clean(product.studioKey || product.wpStudioKey);
  if (
    (storedAssetId && storedAssetId !== assetId) ||
    !TENANT_ID_PATTERN.test(tenantId)
  ) {
    throw new ReaderPurchaseRecoveryError(
      404,
      READER_PURCHASE_RECOVERY_CODES.publicationNotFound,
      "This publication could not be found."
    );
  }

  if (await authorizeReaderAsset(db, input.readerUid, tenantId, assetId)) {
    return { status: "entitled", entitlementIds: [] };
  }

  const purchases = await db
    .collection(readerPlatformCollections.purchases)
    .where("purchaseEmailHash", "==", emailHash)
    .limit(MAX_EMAIL_PURCHASES)
    .get();
  const paidPurchases = purchases.docs.filter((document) => {
    const purchase = document.data() || {};
    return purchase.paymentStatus === "paid" && purchase.disputeStatus !== "lost";
  });

  const itemSnapshots = await Promise.all(
    paidPurchases.map((purchase) =>
      db
        .collection(readerPlatformCollections.purchaseItems)
        .where("purchaseId", "==", purchase.id)
        .where("status", "==", "paid")
        .get()
    )
  );
  const matchingPurchaseIds = paidPurchases
    .filter((purchase, index) =>
      itemSnapshots[index].docs.some((document) => {
        const item = document.data() || {};
        return item.assetId === assetId && item.tenantId === tenantId;
      })
    )
    .map((purchase) => purchase.id);

  const claimReferences = matchingPurchaseIds.map((purchaseId) =>
    db
      .collection(readerPlatformCollections.claims)
      .doc(sha256Id("pending-purchase-claim", purchaseId))
  );
  const claims = claimReferences.length
    ? await db.getAll(...claimReferences)
    : [];
  const candidates = claims.filter(
    (claim) => claim.exists && eligibleClaim(claim.data() || {}, emailHash)
  );

  if (candidates.length === 0) {
    throw new ReaderPurchaseRecoveryError(
      409,
      READER_PURCHASE_RECOVERY_CODES.accountSwitchRequired,
      "Sign in with the email used at checkout to add this purchase to the correct Bookshelf."
    );
  }
  if (candidates.length !== 1) {
    throw new ReaderPurchaseRecoveryError(
      409,
      READER_PURCHASE_RECOVERY_CODES.ambiguous,
      "More than one purchase may match this publication. Please contact KOBA-I support."
    );
  }

  const claimed = await claimPendingPurchase(db, {
    claimId: candidates[0].id,
    readerUid: input.readerUid,
    verifiedEmail,
    emailVerified: profile.emailVerified === true,
    accountStatus: clean(profile.accountStatus),
    correlationId: input.correlationId,
  });
  return { status: "claimed", entitlementIds: claimed.entitlementIds };
}
