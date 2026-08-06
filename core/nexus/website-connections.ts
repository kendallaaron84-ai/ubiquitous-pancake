import { createHash } from "node:crypto";

import {
  NEXUS_MAX_ACTIVE_WEBSITES,
  type NexusContentSource,
  type NexusWebsiteConnection,
  type NexusWebsiteContentRole,
} from "./contracts.ts";
import {
  BlogConnectionError,
  normalizeHttpsOrigin,
  resolveVerifiedBlogConnection,
} from "../security/blog-connection.ts";

const PRIMARY_CONNECTION_ID = "primary";
const WEBSITE_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/;

export function websiteConnectionIdForOrigin(origin: string): string {
  return `site_${createHash("sha256").update(normalizeHttpsOrigin(origin)).digest("hex").slice(0, 16)}`;
}

export function roleAllowsSource(role: NexusWebsiteContentRole, source: NexusContentSource): boolean {
  return role === "both" || role === source;
}

export async function listNexusWebsiteConnections(
  database: FirebaseFirestore.Firestore,
  studioKey: string,
  authorId: string
): Promise<NexusWebsiteConnection[]> {
  const root = database.collection("connections").doc(studioKey);
  const [legacy, websites] = await Promise.all([root.get(), root.collection("websites").get()]);
  const results: NexusWebsiteConnection[] = [];

  if (legacy.exists) {
    const data = legacy.data() || {};
    const storedStatus = clean(data.status);
    if (storedStatus === "disabled" || storedStatus === "verification_failed") {
      const connection = normalizeLegacyWebsite(
        data,
        studioKey,
        authorId,
        storedStatus
      );
      if (connection) results.push(connection);
    } else {
      try {
        const verified = resolveVerifiedBlogConnection(data, studioKey);
        results.push({
          schemaVersion: 1,
          websiteConnectionId: PRIMARY_CONNECTION_ID,
          studioKey,
          authorId,
          displayName: clean(data.displayName) || new URL(verified.targetWpOrigin).hostname,
          wordpressOrigin: verified.targetWpOrigin,
          wordpressUsername: clean(data.wpUsername),
          secretCredentialRef: verified.secretCredentialRef,
          contentRole: normalizeRole(data.contentRole),
          defaultUniverseId: clean(data.defaultUniverseId) || null,
          status: "active",
          persistenceStatus: legacyPersistenceStatus(data, studioKey, authorId),
          verifiedAt: data.verifiedAt || null,
          lastValidatedAt: data.lastValidatedAt || data.updatedAt || null,
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null,
        });
      } catch (error) {
        if (!(error instanceof BlogConnectionError)) throw error;
      }
    }
  }

  for (const snapshot of websites.docs) {
    const connection = normalizeStoredWebsite(snapshot.id, snapshot.data(), studioKey, authorId);
    if (connection) results.push(connection);
  }

  return results.sort((left, right) => left.websiteConnectionId === PRIMARY_CONNECTION_ID ? -1 : right.websiteConnectionId === PRIMARY_CONNECTION_ID ? 1 : left.displayName.localeCompare(right.displayName));
}

export async function resolveNexusWebsiteConnection(
  database: FirebaseFirestore.Firestore,
  input: { studioKey: string; authorId: string; websiteConnectionId: string; contentSource?: NexusContentSource }
): Promise<NexusWebsiteConnection> {
  const websiteConnectionId = clean(input.websiteConnectionId) || PRIMARY_CONNECTION_ID;
  if (!WEBSITE_ID_PATTERN.test(websiteConnectionId)) throw new BlogConnectionError("The website selection is invalid.");
  const connections = await listNexusWebsiteConnections(database, input.studioKey, input.authorId);
  const selected = connections.find((connection) => connection.websiteConnectionId === websiteConnectionId);
  if (!selected || selected.status !== "active") throw new BlogConnectionError("The selected website is not active and verified.");
  if (input.contentSource && !roleAllowsSource(selected.contentRole, input.contentSource)) {
    throw new BlogConnectionError("The selected website does not accept this content source.");
  }
  return selected;
}

export async function assertWebsiteCapacityAndUniqueness(
  database: FirebaseFirestore.Firestore,
  input: { studioKey: string; authorId: string; wordpressOrigin: string; excludeId?: string; contentRole?: NexusWebsiteContentRole }
): Promise<void> {
  const normalizedOrigin = normalizeHttpsOrigin(input.wordpressOrigin);
  const active = (await listNexusWebsiteConnections(database, input.studioKey, input.authorId)).filter((item) => item.status === "active" && item.websiteConnectionId !== input.excludeId);
  if (active.some((item) => item.wordpressOrigin === normalizedOrigin)) throw new BlogConnectionError("This WordPress origin is already connected.");
  if (active.length >= NEXUS_MAX_ACTIVE_WEBSITES) {
    throw new BlogConnectionError("A maximum of two websites have been assigned to this plugin license.");
  }
  if (input.contentRole) {
    assertNexusWebsiteRoleConfiguration([
      ...active.map((connection) => connection.contentRole),
      normalizeRole(input.contentRole),
    ]);
  }
}

function normalizeStoredWebsite(id: string, data: Record<string, unknown>, studioKey: string, authorId: string): NexusWebsiteConnection | null {
  if (clean(data.studioKey) !== studioKey || clean(data.authorId) !== authorId) return null;
  const storedId = clean(data.websiteConnectionId);
  if (storedId && storedId !== id) return null;
  const storedStatus = clean(data.status);
  const status = storedStatus === "active" && clean(data.verificationStatus) !== "verified"
    ? "verification_failed"
    : storedStatus;
  if (status !== "active" && status !== "disabled" && status !== "verification_failed") return null;
  try {
    return {
      schemaVersion: 1,
      websiteConnectionId: id,
      studioKey,
      authorId,
      displayName: clean(data.displayName) || id,
      wordpressOrigin: normalizeHttpsOrigin(data.wordpressOrigin || data.targetWpOrigin),
      wordpressUsername: clean(data.wordpressUsername || data.wpUsername),
      secretCredentialRef: clean(data.secretCredentialRef),
      contentRole: normalizeRole(data.contentRole),
      defaultUniverseId: clean(data.defaultUniverseId) || null,
      status,
      persistenceStatus: storedId ? "authoritative" : "legacy_reconcilable",
      verifiedAt: data.verifiedAt || null,
      lastValidatedAt: data.lastValidatedAt || null,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
    };
  } catch {
    return null;
  }
}

export function assertNexusWebsiteRoleConfiguration(roles: NexusWebsiteContentRole[]): void {
  if (roles.length > NEXUS_MAX_ACTIVE_WEBSITES) {
    throw new BlogConnectionError("A maximum of two websites have been assigned to this plugin license.");
  }
  if (roles.length < 2) return;
  if (roles.includes("both") || roles[0] === roles[1]) {
    throw new BlogConnectionError(
      "Choose one combined site or two specialized Business Brand and Story World sites."
    );
  }
}

function normalizeLegacyWebsite(
  data: Record<string, unknown>,
  studioKey: string,
  authorId: string,
  status: "disabled" | "verification_failed"
): NexusWebsiteConnection | null {
  try {
    const wordpressOrigin = normalizeHttpsOrigin(
      data.wordpressOrigin || data.targetWpOrigin
    );
    return {
      schemaVersion: 1,
      websiteConnectionId: PRIMARY_CONNECTION_ID,
      studioKey,
      authorId,
      displayName: clean(data.displayName) || new URL(wordpressOrigin).hostname,
      wordpressOrigin,
      wordpressUsername: clean(data.wordpressUsername || data.wpUsername),
      secretCredentialRef: clean(data.secretCredentialRef),
      contentRole: normalizeRole(data.contentRole),
      defaultUniverseId: clean(data.defaultUniverseId) || null,
      status,
      persistenceStatus: legacyPersistenceStatus(data, studioKey, authorId),
      verifiedAt: data.verifiedAt || null,
      lastValidatedAt: data.lastValidatedAt || data.updatedAt || null,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
    };
  } catch {
    return null;
  }
}

function normalizeRole(value: unknown): NexusWebsiteContentRole {
  return value === "business_brand" || value === "story_world" ? value : "both";
}

function legacyPersistenceStatus(
  data: Record<string, unknown>,
  studioKey: string,
  authorId: string
): NexusWebsiteConnection["persistenceStatus"] {
  const storedId = clean(data.websiteConnectionId);
  const storedStudioKey = clean(data.studioKey);
  const storedAuthorId = clean(data.authorId);
  if (
    (storedId && storedId !== PRIMARY_CONNECTION_ID) ||
    (storedStudioKey && storedStudioKey !== studioKey) ||
    (storedAuthorId && storedAuthorId !== authorId)
  ) {
    return "legacy_migration_required";
  }
  if (!storedId || !storedStudioKey || !storedAuthorId || !clean(data.contentRole)) {
    return "legacy_reconcilable";
  }
  return "authoritative";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
