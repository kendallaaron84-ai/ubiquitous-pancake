export type ProtectedMediaType = "audiobook" | "ebook";

export interface ProductPolicyInput {
  assetKey: unknown;
  tenantId: unknown;
  status?: unknown;
  isPublished?: unknown;
  type?: unknown;
  assetType?: unknown;
  unitAmountMinor?: unknown;
  price?: unknown;
  currency?: unknown;
  productPriceId?: unknown;
  productVersion?: unknown;
}

export interface ResolvedProductPolicy {
  assetKey: string;
  tenantId: string;
  mediaType: ProtectedMediaType;
  unitAmountMinor: number;
  currency: string;
  productPriceId: string | null;
  productVersion: string | null;
  requiresPayment: boolean;
}

export class ProductPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductPolicyError";
  }
}

export function resolveProductPolicy(
  input: ProductPolicyInput
): ResolvedProductPolicy {
  const assetKey = requiredString(input.assetKey, "assetKey");
  const tenantId = requiredString(input.tenantId, "tenantId");
  const status = optionalString(input.status)?.toLowerCase() || "";
  const isPublished =
    input.isPublished === true ||
    ["published", "publish", "active"].includes(status);

  if (!isPublished) {
    throw new ProductPolicyError(
      "Publication is not available for checkout."
    );
  }

  const mediaType = resolveMediaType(
    assetKey,
    optionalString(input.type) ||
      optionalString(input.assetType) ||
      ""
  );
  const unitAmountMinor = resolveUnitAmountMinor(
    input.unitAmountMinor,
    input.price
  );
  const currency = (
    optionalString(input.currency) || "usd"
  ).toLowerCase();

  if (!/^[a-z]{3}$/.test(currency)) {
    throw new ProductPolicyError(
      "Product currency must be a three-letter ISO code."
    );
  }

  return {
    assetKey,
    tenantId,
    mediaType,
    unitAmountMinor,
    currency,
    productPriceId: optionalString(input.productPriceId),
    productVersion: optionalString(input.productVersion),
    requiresPayment: unitAmountMinor > 0,
  };
}

function resolveMediaType(
  assetKey: string,
  rawType: string
): ProtectedMediaType {
  const normalizedType = rawType.toLowerCase();

  if (
    normalizedType === "audiobook" ||
    normalizedType === "audio" ||
    assetKey.startsWith("abk_") ||
    assetKey.startsWith("aud_")
  ) {
    return "audiobook";
  }

  if (
    normalizedType === "ebook" ||
    normalizedType === "e-book" ||
    assetKey.startsWith("ebk_")
  ) {
    return "ebook";
  }

  throw new ProductPolicyError(
    "Publication media type is unsupported."
  );
}

function resolveUnitAmountMinor(
  explicitMinor: unknown,
  legacyPrice: unknown
): number {
  if (explicitMinor !== undefined && explicitMinor !== null) {
    if (
      typeof explicitMinor !== "number" ||
      !Number.isSafeInteger(explicitMinor) ||
      explicitMinor < 0
    ) {
      throw new ProductPolicyError(
        "unitAmountMinor must be a non-negative safe integer."
      );
    }

    return explicitMinor;
  }

  if (legacyPrice === undefined || legacyPrice === null) {
    return 0;
  }

  return parseLegacyPriceToMinorUnits(legacyPrice);
}

function parseLegacyPriceToMinorUnits(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new ProductPolicyError("Legacy price is invalid.");
  }

  const normalized = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);

  if (!match) {
    throw new ProductPolicyError(
      "Legacy price must have no more than two decimal places."
    );
  }

  const whole = Number.parseInt(match[1], 10);
  const fractional = (match[2] || "").padEnd(2, "0");
  const minor = whole * 100 + Number.parseInt(fractional || "0", 10);

  if (!Number.isSafeInteger(minor)) {
    throw new ProductPolicyError(
      "Legacy price exceeds the supported range."
    );
  }

  return minor;
}

function requiredString(value: unknown, name: string): string {
  const normalized = optionalString(value);

  if (!normalized) {
    throw new ProductPolicyError(`${name} is required.`);
  }

  return normalized;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}
