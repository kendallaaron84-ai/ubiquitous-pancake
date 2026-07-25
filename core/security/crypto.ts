import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const SHA256_BYTE_LENGTH = 32;
const ID_PREFIX_PATTERN = /^[a-z][a-z0-9]{1,15}$/;

export function createOpaqueId(prefix: string): string {
  if (!ID_PREFIX_PATTERN.test(prefix)) {
    throw new TypeError("Opaque ID prefix is invalid.");
  }

  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function createClientSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function createMockOtp(): string {
  return randomInt(100000, 1_000_000).toString();
}

export function hmacHex(secret: string, value: string): string {
  if (!secret) {
    throw new TypeError("HMAC secret is required.");
  }

  return createHmac("sha256", secret)
    .update(value, "utf8")
    .digest("hex");
}

/**
 * Compares fixed-width SHA-256 hex digests. Invalid values are converted to
 * fixed-width zero buffers so timingSafeEqual is still invoked with equal
 * buffer lengths; validity is applied only after the comparison completes.
 */
export function safeEqualHex(
  expectedHex: string,
  actualHex: string
): boolean {
  const expectedIsValid = SHA256_HEX_PATTERN.test(expectedHex);
  const actualIsValid = SHA256_HEX_PATTERN.test(actualHex);

  const expectedBuffer = expectedIsValid
    ? Buffer.from(expectedHex, "hex")
    : Buffer.alloc(SHA256_BYTE_LENGTH);
  const actualBuffer = actualIsValid
    ? Buffer.from(actualHex, "hex")
    : Buffer.alloc(SHA256_BYTE_LENGTH);

  const digestsMatch = timingSafeEqual(
    expectedBuffer,
    actualBuffer
  );

  return expectedIsValid && actualIsValid && digestsMatch;
}

export function normalizePhoneE164(
  value: string,
  defaultCountryCallingCode?: string
): string {
  const trimmed = value.trim();
  const hasInternationalPrefix = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  const candidate = hasInternationalPrefix
    ? `+${digits}`
    : defaultCountryCallingCode
      ? `+${defaultCountryCallingCode.replace(/\D/g, "")}${digits}`
      : "";

  if (!/^\+[1-9]\d{7,14}$/.test(candidate)) {
    throw new TypeError("Phone number must resolve to valid E.164 format.");
  }

  return candidate;
}
