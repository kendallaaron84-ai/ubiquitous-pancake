import { appendReaderAuditEvent } from "./services/audit-service.ts";
import {
  createEntitlementInTransaction,
  deterministicEntitlementId,
} from "./services/entitlement-service.ts";
import { requireActiveVerifiedReader } from "./services/reader-profile-service.ts";
import {
  readerPlatformCollections,
  type ReaderPlatformDb,
} from "./services/service-support.ts";

const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;

export const READER_FREE_ACQUISITION_ERROR_CODES = {
  requestInvalid: "FREE_PUBLICATION_REQUEST_INVALID",
  assetInvalid: "FREE_PUBLICATION_ASSET_INVALID",
  tenantInvalid: "FREE_PUBLICATION_TENANT_INVALID",
  notFound: "FREE_PUBLICATION_NOT_FOUND",
  disabled: "FREE_PUBLICATION_DISABLED",
  unpublished: "FREE_PUBLICATION_UNPUBLISHED",
  notDeployed: "FREE_PUBLICATION_NOT_DEPLOYED",
  notEligible: "FREE_PUBLICATION_NOT_ELIGIBLE",
  tenantMismatch: "FREE_PUBLICATION_TENANT_MISMATCH",
  assetMismatch: "FREE_PUBLICATION_ASSET_MISMATCH",
  entitlementInactive: "FREE_PUBLICATION_ENTITLEMENT_INACTIVE",
  entitlementConflict: "FREE_PUBLICATION_ENTITLEMENT_CONFLICT",
} as const;

type ReaderFreeAcquisitionErrorCode =
  (typeof READER_FREE_ACQUISITION_ERROR_CODES)[keyof typeof READER_FREE_ACQUISITION_ERROR_CODES];

export class ReaderFreeAcquisitionError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: ReaderFreeAcquisitionErrorCode;

  constructor(
    status: 400 | 403 | 404 | 409,
    code: ReaderFreeAcquisitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ReaderFreeAcquisitionError";
    this.status = status;
    this.code = code;
  }
}

export interface ReaderFreeAcquisitionResult {
  entitlementId: string;
  assetId: string;
  acquired: boolean;
  replay: boolean;
}

function requiredIdentifier(
  value: string,
  pattern: RegExp,
  code:
    | typeof READER_FREE_ACQUISITION_ERROR_CODES.assetInvalid
    | typeof READER_FREE_ACQUISITION_ERROR_CODES.tenantInvalid,
  label: string
): string {
  const normalized = value.trim();
  if (!pattern.test(normalized)) {
    throw new ReaderFreeAcquisitionError(
      400,
      code,
      `A valid ${label} is required.`
    );
  }
  return normalized;
}

function productTenantId(product: Record<string, unknown>): string {
  return String(product.studioKey || product.wpStudioKey || "").trim();
}

function isExplicitlyFree(product: Record<string, unknown>): boolean {
  if (product.isFree === true) return true;
  const accessType = String(product.accessType || "").trim().toLowerCase();
  if (["free", "promotion", "public"].includes(accessType)) return true;

  const rawPrice = product.price ?? product.unitPrice;
  if (rawPrice === null || rawPrice === undefined || rawPrice === "") return false;
  const numericPrice = Number(rawPrice);
  return Number.isFinite(numericPrice) && numericPrice === 0;
}

function validateEligibleProduct(
  product: Record<string, unknown>,
  expectedTenantId: string,
  expectedAssetId: string
): void {
  if (
    product.disabled === true ||
    product.isActive === false ||
    product.status === "disabled"
  ) {
    throw new ReaderFreeAcquisitionError(
      409,
      READER_FREE_ACQUISITION_ERROR_CODES.disabled,
      "This publication is disabled."
    );
  }
  if (!(product.status === "published" || product.isPublished === true)) {
    throw new ReaderFreeAcquisitionError(
      409,
      READER_FREE_ACQUISITION_ERROR_CODES.unpublished,
      "This publication is not available yet."
    );
  }
  const deployment = product.wordpressDeployment as
    | Record<string, unknown>
    | undefined;
  if (deployment?.status !== "deployed") {
    throw new ReaderFreeAcquisitionError(
      409,
      READER_FREE_ACQUISITION_ERROR_CODES.notDeployed,
      "This publication has not completed deployment."
    );
  }
  if (!isExplicitlyFree(product)) {
    throw new ReaderFreeAcquisitionError(
      403,
      READER_FREE_ACQUISITION_ERROR_CODES.notEligible,
      "This publication is not eligible for free acquisition."
    );
  }
  if (productTenantId(product) !== expectedTenantId) {
    throw new ReaderFreeAcquisitionError(
      403,
      READER_FREE_ACQUISITION_ERROR_CODES.tenantMismatch,
      "The publication does not belong to the requested author storefront."
    );
  }
  const storedAssetId = String(product.assetId || product.assetKey || "").trim();
  if (storedAssetId && storedAssetId !== expectedAssetId) {
    throw new ReaderFreeAcquisitionError(
      403,
      READER_FREE_ACQUISITION_ERROR_CODES.assetMismatch,
      "The publication asset does not match the requested asset."
    );
  }
}

export async function acquireReaderFreePublication(
  db: ReaderPlatformDb,
  input: {
    readerUid: string;
    tenantId: string;
    assetId: string;
    correlationId: string;
  }
): Promise<ReaderFreeAcquisitionResult> {
  const readerUid = input.readerUid.trim();
  const tenantId = requiredIdentifier(
    input.tenantId,
    TENANT_ID_PATTERN,
    READER_FREE_ACQUISITION_ERROR_CODES.tenantInvalid,
    "tenant ID"
  );
  const assetId = requiredIdentifier(
    input.assetId,
    ASSET_ID_PATTERN,
    READER_FREE_ACQUISITION_ERROR_CODES.assetInvalid,
    "asset ID"
  );
  await requireActiveVerifiedReader(db, readerUid);

  const entitlementId = deterministicEntitlementId(
    readerUid,
    tenantId,
    assetId
  );
  const productReference = db.collection("products").doc(assetId);
  const entitlementReference = db
    .collection(readerPlatformCollections.entitlements)
    .doc(entitlementId);
  let replay = false;

  await db.runTransaction(async (transaction) => {
    const [productSnapshot, entitlementSnapshot] = await Promise.all([
      transaction.get(productReference),
      transaction.get(entitlementReference),
    ]);
    if (!productSnapshot.exists) {
      throw new ReaderFreeAcquisitionError(
        404,
        READER_FREE_ACQUISITION_ERROR_CODES.notFound,
        "The requested publication was not found."
      );
    }
    validateEligibleProduct(productSnapshot.data() || {}, tenantId, assetId);

    if (entitlementSnapshot.exists) {
      const existing = entitlementSnapshot.data() || {};
      if (
        existing.readerUid !== readerUid ||
        existing.tenantId !== tenantId ||
        existing.assetId !== assetId ||
        existing.source !== "promotion"
      ) {
        throw new ReaderFreeAcquisitionError(
          409,
          READER_FREE_ACQUISITION_ERROR_CODES.entitlementConflict,
          "An incompatible publication entitlement already exists."
        );
      }
      if (existing.status !== "active") {
        throw new ReaderFreeAcquisitionError(
          409,
          READER_FREE_ACQUISITION_ERROR_CODES.entitlementInactive,
          "This publication entitlement is no longer active."
        );
      }
      replay = true;
      return;
    }

    await createEntitlementInTransaction(
      db,
      transaction,
      {
        readerUid,
        tenantId,
        assetId,
        source: "promotion",
        correlationId: input.correlationId,
      },
      entitlementSnapshot
    );
    await appendReaderAuditEvent(
      db,
      {
        eventType: "promotion.acquired",
        actorType: "reader",
        actorId: readerUid,
        subjectType: "entitlement",
        subjectId: entitlementId,
        correlationId: input.correlationId,
        idempotencyKey: `promotion-acquired:${entitlementId}`,
        metadata: { tenantId, assetId },
      },
      transaction
    );
  });

  return {
    entitlementId,
    assetId,
    acquired: !replay,
    replay,
  };
}
