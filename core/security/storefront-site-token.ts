import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";

const ALGORITHM = "RS256";
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export type StorefrontLicenseCollection = "plugin_licenses" | "licenses";

export interface StorefrontSiteTokenInput {
  pluginLicenseKey: string;
  licenseCollection: StorefrontLicenseCollection;
  websiteConnectionId: string;
  origin: string;
}

export interface StorefrontSiteTokenClaims extends StorefrontSiteTokenInput {
  scope: readonly ["catalog:read"];
}

export async function signStorefrontSiteToken(
  input: StorefrontSiteTokenInput,
  source: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): Promise<string> {
  validateInput(input);
  const configuration = resolveConfiguration(source);
  const key = await importPKCS8(configuration.privateKey, ALGORITHM);
  const issuedAt = Math.floor(now.getTime() / 1000);

  return new SignJWT({
    pluginLicenseKey: input.pluginLicenseKey,
    licenseCollection: input.licenseCollection,
    websiteConnectionId: input.websiteConnectionId,
    origin: normalizeOrigin(input.origin),
    scope: ["catalog:read"],
  })
    .setProtectedHeader({ alg: ALGORITHM, kid: configuration.keyId, typ: "JWT" })
    .setSubject(input.websiteConnectionId)
    .setIssuer(configuration.issuer)
    .setAudience(configuration.audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + LIFETIME_SECONDS)
    .sign(key);
}

export async function verifyStorefrontSiteToken(
  token: string,
  source: NodeJS.ProcessEnv = process.env
): Promise<StorefrontSiteTokenClaims> {
  if (!token.trim()) throw new Error("Storefront site credential is required.");
  const configuration = resolveConfiguration(source);
  const key = await importSPKI(configuration.publicKey, ALGORITHM);
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    algorithms: [ALGORITHM],
    issuer: configuration.issuer,
    audience: configuration.audience,
  });

  if (protectedHeader.kid !== configuration.keyId) {
    throw new Error("Storefront site credential key identifier is invalid.");
  }
  if (
    typeof payload.pluginLicenseKey !== "string" ||
    (payload.licenseCollection !== "plugin_licenses" && payload.licenseCollection !== "licenses") ||
    typeof payload.websiteConnectionId !== "string" ||
    typeof payload.origin !== "string" ||
    !Array.isArray(payload.scope) ||
    payload.scope.length !== 1 ||
    payload.scope[0] !== "catalog:read" ||
    payload.sub !== payload.websiteConnectionId
  ) {
    throw new Error("Storefront site credential claims are malformed.");
  }

  return {
    pluginLicenseKey: payload.pluginLicenseKey,
    licenseCollection: payload.licenseCollection,
    websiteConnectionId: payload.websiteConnectionId,
    origin: normalizeOrigin(payload.origin),
    scope: ["catalog:read"],
  };
}

function resolveConfiguration(source: NodeJS.ProcessEnv) {
  const issuer = requireValue(source, "KOBA_JWT_ISSUER");
  const audience = requireValue(source, "KOBA_JWT_AUDIENCE");
  return {
    privateKey: restoreMultiline(requireValue(source, "KOBA_JWT_PRIVATE_SIGNING_KEY")),
    publicKey: restoreMultiline(requireValue(source, "KOBA_JWT_PUBLIC_VERIFYING_KEY")),
    keyId: requireValue(source, "KOBA_JWT_KEY_ID"),
    issuer: `${issuer}:storefront-site`,
    audience: `${audience}:storefront-catalog`,
  };
}

function validateInput(input: StorefrontSiteTokenInput) {
  if (!/^KOBA-AUDIO-(?:[A-F0-9]{8}|[A-F0-9]{16})$/.test(input.pluginLicenseKey)) {
    throw new TypeError("Storefront plugin license key is invalid.");
  }
  if (!input.websiteConnectionId.trim()) throw new TypeError("Storefront website connection is required.");
  normalizeOrigin(input.origin);
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new TypeError("Storefront origin is invalid.");
  }
  return url.origin.toLowerCase();
}

function requireValue(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`Missing storefront security configuration: ${name}`);
  return value;
}

function restoreMultiline(value: string): string {
  return value.replace(/\\n/g, "\n");
}
