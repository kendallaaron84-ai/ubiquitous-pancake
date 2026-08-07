import type { StorefrontSiteTokenClaims } from "./storefront-site-token";

export type StorefrontCatalogScope = "tenant" | "global";
export type StorefrontSiteRole = "business_brand" | "story_world" | "both";

export interface StorefrontSiteEvidence {
  websiteConnectionId: string;
  origin: string;
  role: StorefrontSiteRole;
  status: string;
  verificationStatus: string;
}

export interface ResolvedStorefrontAuthorization {
  studioKey: string;
  websiteConnectionId: string;
  origin: string;
  role: StorefrontSiteRole;
  scope: StorefrontCatalogScope;
}

export class StorefrontAuthorizationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;

  constructor(status: number, code: string, publicMessage: string) {
    super(publicMessage);
    this.name = "StorefrontAuthorizationError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function resolveStorefrontAuthorization(input: {
  claims: StorefrontSiteTokenClaims;
  license: Record<string, unknown>;
  evidence: StorefrontSiteEvidence[];
  requestedScope: unknown;
}): ResolvedStorefrontAuthorization {
  const studioKey = input.claims.pluginLicenseKey.trim().toUpperCase();
  if (clean(input.license.status) !== "active") {
    throw forbidden("STOREFRONT_LICENSE_INACTIVE", "This storefront license is inactive.");
  }
  const storedKey = clean(input.license.studioKey || input.license.licenseKey).toUpperCase();
  if (storedKey && storedKey !== studioKey) {
    throw forbidden("STOREFRONT_SITE_IDENTITY_INVALID", "The storefront identity is invalid.");
  }

  const grants = Array.isArray(input.license.authorizedSites)
    ? input.license.authorizedSites.filter(isRecord)
    : [];
  const grant = grants.find((candidate) =>
    clean(candidate.websiteConnectionId) === input.claims.websiteConnectionId &&
    normalizeOrigin(candidate.origin) === input.claims.origin
  );
  if (!grant || clean(grant.status) !== "active") {
    throw forbidden("STOREFRONT_SITE_NOT_AUTHORIZED", "This website is not authorized for the storefront.");
  }

  const evidence = input.evidence.find((candidate) =>
    candidate.websiteConnectionId === input.claims.websiteConnectionId &&
    normalizeOrigin(candidate.origin) === input.claims.origin
  );
  if (!evidence || evidence.status !== "active" || evidence.verificationStatus !== "verified") {
    throw forbidden("STOREFRONT_SITE_NOT_VERIFIED", "This website connection is not verified.");
  }

  const role = clean(grant.role) as StorefrontSiteRole;
  if (!(["business_brand", "story_world", "both"] as string[]).includes(role) || evidence.role !== role) {
    throw forbidden("STOREFRONT_SITE_IDENTITY_INVALID", "The storefront role does not match its verified website connection.");
  }

  const scope: StorefrontCatalogScope = input.requestedScope === "global" ? "global" : "tenant";
  if (scope === "global" && !hasGlobalCatalogAuthority(input.license)) {
    throw forbidden("STOREFRONT_GLOBAL_SCOPE_FORBIDDEN", "This website is not authorized to display the platform catalog.");
  }

  return {
    studioKey,
    websiteConnectionId: input.claims.websiteConnectionId,
    origin: input.claims.origin,
    role,
    scope,
  };
}

export function isSafeStorefrontProduct(
  data: Record<string, unknown>,
  authorization: ResolvedStorefrontAuthorization,
  requestedType?: string
): boolean {
  const tenantKey = clean(data.studioKey || data.wpStudioKey);
  if (authorization.scope === "tenant" && tenantKey !== authorization.studioKey) return false;
  if (!tenantKey) return false;

  const published = clean(data.status) === "published" || data.isPublished === true;
  const deployed = clean(readRecord(data.wordpressDeployment)?.status) === "deployed";
  const visibility = clean(data.visibility || data.access).toLowerCase();
  if (!published || !deployed || data.disabled === true || data.enabled === false) return false;
  if (["private", "draft", "disabled", "unpublished"].includes(visibility)) return false;

  const assetKey = clean(data.assetKey);
  const type = clean(data.type || data.assetType || (assetKey.startsWith("abk_") ? "audiobook" : assetKey.startsWith("ebk_") ? "ebook" : "publication")).toLowerCase();
  if (requestedType && type !== requestedType.trim().toLowerCase()) return false;

  if (authorization.scope === "tenant" && authorization.role === "story_world") {
    const assignedConnectionId = clean(
      data.websiteConnectionId || readRecord(data.wordpressDeployment)?.websiteConnectionId
    );
    if (assignedConnectionId !== authorization.websiteConnectionId) return false;
  }
  return true;
}

export function safeStorefrontProduct(documentId: string, data: Record<string, unknown>) {
  const assetKey = clean(data.assetKey) || documentId;
  const type = clean(data.type || data.assetType || (assetKey.startsWith("abk_") ? "audiobook" : assetKey.startsWith("ebk_") ? "ebook" : "publication"));
  const ebookChapters = readArray(readRecord(data.ebookPayload)?.chapters);
  const audioChapters = readArray(data.studioTracks);
  const chapters = type === "ebook"
    ? (ebookChapters.length ? ebookChapters : readArray(data.chapters))
    : (audioChapters.length ? audioChapters : readArray(data.chapters));
  return {
    assetKey,
    type,
    title: clean(data.title) || "Untitled",
    description: clean(data.description || data.synopsis),
    coverUrl: clean(data.coverArtUrl || data.coverUrl) || "/placeholder.jpg",
    bgImageUrl: clean(data.bgImageUrl || data.backgroundUrl),
    authorName: clean(data.authorName) || "Sovereign Author",
    price: Number(data.price ?? data.unitPrice ?? 0),
    category: clean(data.category) || (type === "ebook" ? "E-Books" : "Audiobooks"),
    chapterCount: chapters.length,
  };
}

export function hasGlobalCatalogAuthority(license: Record<string, unknown>): boolean {
  if (license.platformGlobalCatalogAuthority === true) return true;
  const capabilities = [license.pluginEntitlements, license.entitlements]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value): value is string => typeof value === "string");
  return capabilities.includes("platform_global_catalog");
}

function forbidden(code: string, message: string) {
  return new StorefrontAuthorizationError(403, code, message);
}

function normalizeOrigin(value: unknown): string {
  try { return new URL(clean(value)).origin.toLowerCase(); } catch { return ""; }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
