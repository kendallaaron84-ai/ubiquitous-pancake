export const PLUGIN_MAX_AUTHORIZED_SITES = 2 as const;

export type PluginSiteRole = "business_brand" | "story_world" | "both";
export type PluginSiteStatus = "active" | "revoked";

export interface PluginAuthorizedSite {
  websiteConnectionId: string;
  origin: string;
  role: PluginSiteRole;
  status: PluginSiteStatus;
  verifiedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  authorizedBy: string;
  revokedAt?: unknown | null;
  revokedBy?: string | null;
}

export interface PluginSiteEvidence {
  websiteConnectionId: string;
  origin: string;
  role: PluginSiteRole;
  status: "active" | "disabled" | "verification_failed";
  verificationStatus: "verified" | "unverified";
  verifiedAt: unknown;
  createdAt: unknown;
}

export type PluginAuthorizationCode =
  | "PLUGIN_LICENSE_NOT_FOUND"
  | "PLUGIN_LICENSE_LEGACY_MIGRATION_REQUIRED"
  | "PLUGIN_SITE_NOT_AUTHORIZED"
  | "PLUGIN_SITE_LIMIT_REACHED"
  | "PLUGIN_LICENSE_REVOKED"
  | "PLUGIN_STUDIO_MISMATCH"
  | "PLUGIN_ORIGIN_MISMATCH"
  | "PLUGIN_ENVIRONMENT_MISMATCH"
  | "WEBSITE_CONNECTION_NOT_FOUND"
  | "WEBSITE_CONNECTION_LEGACY_MIGRATION_REQUIRED"
  | "WEBSITE_CONNECTION_ID_MISMATCH"
  | "WEBSITE_CONNECTION_OWNERSHIP_MISMATCH";

export class PluginSiteAuthorizationError extends Error {
  readonly status: number;
  readonly code: PluginAuthorizationCode;
  readonly publicMessage: string;

  constructor(
    status: number,
    code: PluginAuthorizationCode,
    publicMessage: string
  ) {
    super(publicMessage);
    this.name = "PluginSiteAuthorizationError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function isSupportedPluginLicenseKey(value: unknown): value is string {
  return typeof value === "string" && /^KOBA-AUDIO-(?:[A-F0-9]{8}|[A-F0-9]{16})$/.test(value.trim().toUpperCase());
}

export function normalizePluginOrigin(
  value: unknown,
  options: { production?: boolean } = {}
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw originMismatch();
  }
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      (options.production === true && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      throw originMismatch();
    }
    return url.origin.toLowerCase();
  } catch (error) {
    if (error instanceof PluginSiteAuthorizationError) throw error;
    throw originMismatch();
  }
}

export function authorizePluginSite(input: {
  pluginLicenseKey: string;
  clientOrigin: string;
  firebaseProjectId: string;
  license: Record<string, unknown>;
  evidence: PluginSiteEvidence[];
  now: unknown;
  actor: string;
}): {
  authorizedSites: PluginAuthorizedSite[];
  grant: PluginAuthorizedSite;
  created: boolean;
  migratedLegacySite: boolean;
} {
  const pluginLicenseKey = input.pluginLicenseKey.trim().toUpperCase();
  if (!isSupportedPluginLicenseKey(pluginLicenseKey)) {
    throw new PluginSiteAuthorizationError(404, "PLUGIN_LICENSE_NOT_FOUND", "The plugin license was not found.");
  }
  assertLicenseEnvironment(input.license, input.firebaseProjectId);
  assertLicenseStudio(input.license, pluginLicenseKey);
  if (clean(input.license.status) !== "active") {
    throw new PluginSiteAuthorizationError(403, "PLUGIN_LICENSE_REVOKED", "This plugin license is inactive or revoked.");
  }

  const clientOrigin = normalizePluginOrigin(input.clientOrigin, {
    production: process.env.NODE_ENV === "production",
  });
  const authorizedSites = normalizeAuthorizedSites(input.license.authorizedSites);
  const existingByOrigin = authorizedSites.find((site) => site.origin === clientOrigin);
  const matchingEvidence = input.evidence.find(
    (candidate) => normalizePluginOrigin(candidate.origin) === clientOrigin
  );
  const existingByConnectionId = matchingEvidence
    ? authorizedSites.find((site) => site.websiteConnectionId === matchingEvidence.websiteConnectionId)
    : undefined;
  if (
    (existingByOrigin && existingByConnectionId && existingByOrigin !== existingByConnectionId) ||
    (existingByOrigin && matchingEvidence && existingByOrigin.websiteConnectionId !== matchingEvidence.websiteConnectionId) ||
    (existingByConnectionId && existingByConnectionId.origin !== clientOrigin)
  ) {
    throw new PluginSiteAuthorizationError(
      409,
      "PLUGIN_ORIGIN_MISMATCH",
      "The website connection ID and exact WordPress origin do not identify the same authorized site."
    );
  }
  const existing = existingByOrigin || existingByConnectionId;
  if (existing?.status === "active") {
    assertRoleConfiguration(authorizedSites);
    return { authorizedSites, grant: existing, created: false, migratedLegacySite: false };
  }
  if (existing?.status === "revoked") {
    throw new PluginSiteAuthorizationError(403, "PLUGIN_SITE_NOT_AUTHORIZED", "This WordPress installation has been revoked.");
  }

  const legacyOrigin = optionalOrigin(input.license.associatedWebsite);
  const verifiedEvidence = matchingEvidence?.status === "active" &&
    matchingEvidence.verificationStatus === "verified"
    ? matchingEvidence
    : null;

  if (authorizedSites.length === 0 && legacyOrigin && legacyOrigin !== clientOrigin) {
    throw new PluginSiteAuthorizationError(
      403,
      "PLUGIN_ORIGIN_MISMATCH",
      "This plugin license is bound to a different WordPress origin."
    );
  }
  if (!verifiedEvidence && !(authorizedSites.length === 0 && legacyOrigin === clientOrigin)) {
    if (authorizedSites.length === 0 && !legacyOrigin) {
      throw new PluginSiteAuthorizationError(
        409,
        "PLUGIN_LICENSE_LEGACY_MIGRATION_REQUIRED",
        "This legacy plugin license requires a verified website migration before activation."
      );
    }
    throw new PluginSiteAuthorizationError(
      403,
      "PLUGIN_SITE_NOT_AUTHORIZED",
      "This WordPress installation is not an authorized site for this plugin license."
    );
  }

  const activeCount = authorizedSites.filter((site) => site.status === "active").length;
  const configuredLimit = positiveInteger(input.license.maxAuthorizedSites) || PLUGIN_MAX_AUTHORIZED_SITES;
  const maxAuthorizedSites = Math.min(configuredLimit, PLUGIN_MAX_AUTHORIZED_SITES);
  if (activeCount >= maxAuthorizedSites) {
    throw new PluginSiteAuthorizationError(
      409,
      "PLUGIN_SITE_LIMIT_REACHED",
      "A maximum of two websites have been assigned to this plugin license."
    );
  }

  const role = verifiedEvidence?.role || "both";
  const grant: PluginAuthorizedSite = {
    websiteConnectionId: verifiedEvidence?.websiteConnectionId || "primary",
    origin: clientOrigin,
    role,
    status: "active",
    verifiedAt: verifiedEvidence?.verifiedAt || input.now,
    createdAt: verifiedEvidence?.createdAt || input.now,
    updatedAt: input.now,
    authorizedBy: clean(input.actor) || "plugin_activation",
    revokedAt: null,
    revokedBy: null,
  };
  const next = [
    ...authorizedSites.filter(
      (site) => site.origin !== clientOrigin && site.websiteConnectionId !== grant.websiteConnectionId
    ),
    grant,
  ];
  assertRoleConfiguration(next);
  return {
    authorizedSites: next,
    grant,
    created: true,
    migratedLegacySite: authorizedSites.length === 0,
  };
}

export function reconcilePluginSiteGrants(input: {
  pluginLicenseKey: string;
  firebaseProjectId: string;
  license: Record<string, unknown>;
  evidence: PluginSiteEvidence[];
  now: unknown;
  actor: string;
}): PluginAuthorizedSite[] {
  const pluginLicenseKey = input.pluginLicenseKey.trim().toUpperCase();
  if (!isSupportedPluginLicenseKey(pluginLicenseKey)) {
    throw new PluginSiteAuthorizationError(404, "PLUGIN_LICENSE_NOT_FOUND", "The plugin license was not found.");
  }
  assertLicenseEnvironment(input.license, input.firebaseProjectId);
  assertLicenseStudio(input.license, pluginLicenseKey);
  if (clean(input.license.status) !== "active") {
    throw new PluginSiteAuthorizationError(403, "PLUGIN_LICENSE_REVOKED", "This plugin license is inactive or revoked.");
  }

  const verified = input.evidence.filter(
    (site) => site.status === "active" && site.verificationStatus === "verified"
  );
  if (verified.length > PLUGIN_MAX_AUTHORIZED_SITES) {
    throw new PluginSiteAuthorizationError(
      409,
      "PLUGIN_SITE_LIMIT_REACHED",
      "A maximum of two websites have been assigned to this plugin license."
    );
  }
  const seenIds = new Set<string>();
  const seenOrigins = new Set<string>();
  for (const site of verified) {
    const origin = normalizePluginOrigin(site.origin);
    if (seenIds.has(site.websiteConnectionId) || seenOrigins.has(origin)) {
      throw new PluginSiteAuthorizationError(
        409,
        "PLUGIN_ORIGIN_MISMATCH",
        "Each authorized website must have a unique website connection ID and exact origin."
      );
    }
    seenIds.add(site.websiteConnectionId);
    seenOrigins.add(origin);
  }

  const existing = normalizeAuthorizedSites(input.license.authorizedSites);
  const nextActive = verified.map((site) => {
    const origin = normalizePluginOrigin(site.origin);
    const byId = existing.find((grant) => grant.websiteConnectionId === site.websiteConnectionId);
    const byOrigin = existing.find((grant) => grant.origin === origin);
    if (byId && byOrigin && byId !== byOrigin) {
      throw new PluginSiteAuthorizationError(
        409,
        "PLUGIN_ORIGIN_MISMATCH",
        "The website connection ID and exact WordPress origin do not identify the same authorized site."
      );
    }
    const previous = byId || byOrigin;
    return {
      websiteConnectionId: site.websiteConnectionId,
      origin,
      role: site.role,
      status: "active" as const,
      verifiedAt: site.verifiedAt || input.now,
      createdAt: previous?.createdAt || site.createdAt || input.now,
      updatedAt: input.now,
      authorizedBy: clean(input.actor) || "author_dashboard",
      revokedAt: null,
      revokedBy: null,
    };
  });
  const retainedHistory = existing.filter(
    (grant) => !seenIds.has(grant.websiteConnectionId) && !seenOrigins.has(grant.origin)
  );
  const result = [...retainedHistory, ...nextActive];
  assertRoleConfiguration(result);
  return result;
}

export function revokePluginSite(input: {
  authorizedSites: unknown;
  origin: string;
  now: unknown;
  actor: string;
}): PluginAuthorizedSite[] {
  const origin = normalizePluginOrigin(input.origin);
  const sites = normalizeAuthorizedSites(input.authorizedSites);
  let found = false;
  const next = sites.map((site) => {
    if (site.origin !== origin || site.status !== "active") return site;
    found = true;
    return {
      ...site,
      status: "revoked" as const,
      updatedAt: input.now,
      revokedAt: input.now,
      revokedBy: clean(input.actor) || "platform_admin",
    };
  });
  if (!found) {
    throw new PluginSiteAuthorizationError(403, "PLUGIN_SITE_NOT_AUTHORIZED", "The requested plugin site is not active.");
  }
  assertRoleConfiguration(next);
  return next;
}

export function assertRoleConfiguration(sites: PluginAuthorizedSite[]): void {
  const ids = new Set<string>();
  const origins = new Set<string>();
  for (const site of sites) {
    if (ids.has(site.websiteConnectionId) || origins.has(site.origin)) {
      throw new PluginSiteAuthorizationError(
        409,
        "PLUGIN_ORIGIN_MISMATCH",
        "Each authorized website must have a unique website connection ID and exact origin."
      );
    }
    ids.add(site.websiteConnectionId);
    origins.add(site.origin);
  }
  const active = sites.filter((site) => site.status === "active");
  if (active.length > PLUGIN_MAX_AUTHORIZED_SITES) {
    throw new PluginSiteAuthorizationError(
      409,
      "PLUGIN_SITE_LIMIT_REACHED",
      "A maximum of two websites have been assigned to this plugin license."
    );
  }
  if (active.length < 2) return;
  if (active.some((site) => site.role === "both")) {
    throw invalidRoleConfiguration();
  }
  if (active[0].role === active[1].role) {
    throw invalidRoleConfiguration();
  }
}

function normalizeAuthorizedSites(value: unknown): PluginAuthorizedSite[] {
  if (!Array.isArray(value)) return [];
  const results: PluginAuthorizedSite[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const data = item as Record<string, unknown>;
    const role = normalizeRole(data.role);
    const status = data.status === "revoked" ? "revoked" : data.status === "active" ? "active" : null;
    const websiteConnectionId = clean(data.websiteConnectionId);
    if (!role || !status || !websiteConnectionId) continue;
    try {
      results.push({
        websiteConnectionId,
        origin: normalizePluginOrigin(data.origin),
        role,
        status,
        verifiedAt: data.verifiedAt || null,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
        authorizedBy: clean(data.authorizedBy) || "legacy_migration",
        revokedAt: data.revokedAt || null,
        revokedBy: clean(data.revokedBy) || null,
      });
    } catch {
      continue;
    }
  }
  return results;
}

function assertLicenseEnvironment(license: Record<string, unknown>, firebaseProjectId: string): void {
  const expected = clean(license.firebaseProjectId || license.environmentProjectId || license.projectId);
  if (expected && expected !== clean(firebaseProjectId)) {
    throw new PluginSiteAuthorizationError(409, "PLUGIN_ENVIRONMENT_MISMATCH", "This plugin license belongs to a different KOBA-I environment.");
  }
}

function assertLicenseStudio(license: Record<string, unknown>, pluginLicenseKey: string): void {
  const stored = clean(license.studioKey || license.key || license.licenseKey).toUpperCase();
  if (stored && stored !== pluginLicenseKey) {
    throw new PluginSiteAuthorizationError(403, "PLUGIN_STUDIO_MISMATCH", "The plugin license does not match this StudioKey workspace.");
  }
}

function optionalOrigin(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return normalizePluginOrigin(value);
}

function normalizeRole(value: unknown): PluginSiteRole | null {
  return value === "business_brand" || value === "story_world" || value === "both" ? value : null;
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function originMismatch(): PluginSiteAuthorizationError {
  return new PluginSiteAuthorizationError(400, "PLUGIN_ORIGIN_MISMATCH", "A valid exact WordPress origin is required.");
}

function invalidRoleConfiguration(): PluginSiteAuthorizationError {
  return new PluginSiteAuthorizationError(
    409,
    "PLUGIN_SITE_NOT_AUTHORIZED",
    "Choose one combined site or two specialized Business Brand and Story World sites."
  );
}
