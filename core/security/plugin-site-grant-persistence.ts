import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

import {
  PluginSiteAuthorizationError,
  normalizePluginOrigin,
  reconcilePluginSiteGrants,
  revokePluginSite,
  type PluginAuthorizedSite,
  type PluginSiteEvidence,
  type PluginSiteRole,
} from "./plugin-site-authorization.ts";

type ConnectionStatus = "active" | "disabled" | "verification_failed";

export interface VerifiedPluginWebsiteInput {
  studioKey: string;
  authorId: string;
  actorEmail: string;
  firebaseProjectId: string;
  websiteConnectionId: string;
  wordpressOrigin: string;
  wordpressUsername: string;
  secretCredentialRef: string;
  contentRole: PluginSiteRole;
  displayName: string;
  defaultUniverseId: string | null;
  primaryUserRef?: FirebaseFirestore.DocumentReference;
}

export interface PluginWebsiteMetadataInput {
  studioKey: string;
  authorId: string;
  actorEmail: string;
  firebaseProjectId: string;
  websiteConnectionId: string;
  displayName?: string;
  contentRole?: PluginSiteRole;
  defaultUniverseId?: string | null;
  status?: "active" | "disabled";
}

export interface PluginGrantPersistenceResult {
  grant: PluginAuthorizedSite | null;
  authorizedSites: PluginAuthorizedSite[];
  auditEventIds: string[];
}

export async function persistVerifiedPluginWebsite(
  database: FirebaseFirestore.Firestore,
  input: VerifiedPluginWebsiteInput,
  options: { now?: Timestamp; auditId?: () => string } = {}
): Promise<PluginGrantPersistenceResult> {
  const now = options.now || Timestamp.now();
  const auditId = options.auditId || (() => `evt_${randomUUID()}`);
  return database.runTransaction(async (transaction) => {
    const state = await readAuthoritativeState(transaction, database, input);
    const selected = state.connections.find(
      (connection) => connection.websiteConnectionId === input.websiteConnectionId
    );
    const prospective: StoredConnection = {
      ...(selected || emptyConnection(input.studioKey, input.authorId, input.websiteConnectionId)),
      studioKey: input.studioKey,
      authorId: input.authorId,
      websiteConnectionId: input.websiteConnectionId,
      displayName: input.displayName,
      contentRole: input.contentRole,
      defaultUniverseId: input.defaultUniverseId,
      status: "active",
      verificationStatus: "verified",
      wordpressOrigin: normalizePluginOrigin(input.wordpressOrigin, { production: process.env.NODE_ENV === "production" }),
      wordpressUsername: input.wordpressUsername.trim(),
      secretCredentialRef: input.secretCredentialRef.trim(),
      verifiedAt: now,
      createdAt: selected?.createdAt || now,
      updatedAt: now,
      registeredBy: input.actorEmail,
    };
    assertCompleteVerifiedConnection(prospective);

    const connections = replaceConnection(state.connections, prospective);
    const evidence = connectionsToEvidence(connections);
    const authorizedSites = reconcilePluginSiteGrants({
      pluginLicenseKey: input.studioKey,
      firebaseProjectId: input.firebaseProjectId,
      license: state.license,
      evidence,
      now,
      actor: input.actorEmail,
    });
    const auditEvents = classifyAuditEvents(
      state.license.authorizedSites,
      authorizedSites,
      input.websiteConnectionId,
      "verification",
      new Set(state.connections.map((connection) => connection.websiteConnectionId))
    );

    transaction.set(state.selectedRef, toConnectionWrite(prospective), { merge: true });
    transaction.update(state.licenseRef, licensePatch(state.license, authorizedSites, now));
    if (input.primaryUserRef && input.websiteConnectionId === "primary") {
      transaction.set(input.primaryUserRef, {
        wpConnection: {
          targetUrl: prospective.wordpressOrigin,
          wpUsername: prospective.wordpressUsername,
          status: "connected",
          lastVerifiedAt: now,
          studioKey: input.studioKey,
        },
        updatedAt: now,
      }, { merge: true });
    }
    const auditEventIds = appendAuditEvents(
      transaction,
      state.licenseRef,
      auditEvents,
      input,
      now,
      auditId
    );
    return {
      grant: authorizedSites.find(
        (site) => site.status === "active" &&
          site.websiteConnectionId === input.websiteConnectionId &&
          site.origin === prospective.wordpressOrigin
      ) || null,
      authorizedSites,
      auditEventIds,
    };
  });
}

export async function persistPluginWebsiteMetadata(
  database: FirebaseFirestore.Firestore,
  input: PluginWebsiteMetadataInput,
  options: { now?: Timestamp; auditId?: () => string } = {}
): Promise<PluginGrantPersistenceResult> {
  const now = options.now || Timestamp.now();
  const auditId = options.auditId || (() => `evt_${randomUUID()}`);
  return database.runTransaction(async (transaction) => {
    const state = await readAuthoritativeState(transaction, database, input);
    const selected = state.connections.find(
      (connection) => connection.websiteConnectionId === input.websiteConnectionId
    );
    if (!selected) {
      throw new PluginSiteAuthorizationError(404, "PLUGIN_SITE_NOT_AUTHORIZED", "The website connection was not found.");
    }
    const prospective: StoredConnection = {
      ...selected,
      displayName: input.displayName === undefined ? selected.displayName : input.displayName.trim().slice(0, 120),
      contentRole: input.contentRole || selected.contentRole,
      defaultUniverseId: input.defaultUniverseId === undefined ? selected.defaultUniverseId : input.defaultUniverseId,
      status: input.status || selected.status,
      updatedAt: now,
    };
    const existingEvidence = connectionsToEvidence(state.connections);
    const baselineSites = reconcilePluginSiteGrants({
      pluginLicenseKey: input.studioKey,
      firebaseProjectId: input.firebaseProjectId,
      license: state.license,
      evidence: existingEvidence,
      now,
      actor: input.actorEmail,
    });
    const legacyEvents = classifyAuditEvents(
      state.license.authorizedSites,
      baselineSites,
      input.websiteConnectionId,
      "metadata",
      new Set(state.connections.map((connection) => connection.websiteConnectionId))
    );
    let authorizedSites: PluginAuthorizedSite[];
    if (prospective.status === "disabled") {
      authorizedSites = revokePluginSite({
        authorizedSites: baselineSites,
        origin: selected.wordpressOrigin,
        now,
        actor: input.actorEmail,
      });
    } else {
      const connections = replaceConnection(state.connections, prospective);
      authorizedSites = reconcilePluginSiteGrants({
        pluginLicenseKey: input.studioKey,
        firebaseProjectId: input.firebaseProjectId,
        license: { ...state.license, authorizedSites: baselineSites },
        evidence: connectionsToEvidence(connections),
        now,
        actor: input.actorEmail,
      });
    }
    const auditEvents = [
      ...legacyEvents,
      ...classifyAuditEvents(
        baselineSites,
        authorizedSites,
        input.websiteConnectionId,
        prospective.status === "disabled" ? "revocation" : "metadata",
        new Set()
      ),
    ];

    transaction.set(state.selectedRef, {
      ...(input.displayName !== undefined ? { displayName: prospective.displayName } : {}),
      ...(input.contentRole !== undefined ? { contentRole: prospective.contentRole } : {}),
      ...(input.defaultUniverseId !== undefined ? { defaultUniverseId: prospective.defaultUniverseId } : {}),
      ...(input.status !== undefined ? { status: prospective.status } : {}),
      updatedAt: now,
    }, { merge: true });
    transaction.update(state.licenseRef, licensePatch(state.license, authorizedSites, now));
    const auditEventIds = appendAuditEvents(
      transaction,
      state.licenseRef,
      auditEvents,
      input,
      now,
      auditId
    );
    return {
      grant: authorizedSites.find(
        (site) => site.websiteConnectionId === input.websiteConnectionId && site.status === "active"
      ) || null,
      authorizedSites,
      auditEventIds,
    };
  });
}

type StoredConnection = {
  studioKey: string;
  authorId: string;
  websiteConnectionId: string;
  displayName: string;
  wordpressOrigin: string;
  wordpressUsername: string;
  secretCredentialRef: string;
  contentRole: PluginSiteRole;
  defaultUniverseId: string | null;
  status: ConnectionStatus;
  verificationStatus: "verified" | "unverified";
  verifiedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  registeredBy: string;
};

async function readAuthoritativeState(
  transaction: FirebaseFirestore.Transaction,
  database: FirebaseFirestore.Firestore,
  input: { studioKey: string; authorId: string; actorEmail: string; websiteConnectionId: string }
) {
  const licenseRef = database.collection("plugin_licenses").doc(input.studioKey);
  const rootRef = database.collection("connections").doc(input.studioKey);
  const websitesQuery = rootRef.collection("websites");
  const selectedRef = input.websiteConnectionId === "primary"
    ? rootRef
    : websitesQuery.doc(input.websiteConnectionId);
  const [licenseSnapshot, rootSnapshot, websiteSnapshots] = await Promise.all([
    transaction.get(licenseRef),
    transaction.get(rootRef),
    transaction.get(websitesQuery),
  ]);
  if (!licenseSnapshot.exists) {
    throw new PluginSiteAuthorizationError(404, "PLUGIN_LICENSE_NOT_FOUND", "The plugin license was not found.");
  }
  const license = licenseSnapshot.data() || {};
  assertAuthoritativeOwnership(license, input);
  const connections: StoredConnection[] = [];
  if (rootSnapshot.exists) {
    const normalized = normalizeConnection("primary", rootSnapshot.data() || {}, input.studioKey, input.authorId);
    if (normalized) connections.push(normalized);
  }
  for (const snapshot of websiteSnapshots.docs) {
    const normalized = normalizeConnection(snapshot.id, snapshot.data() || {}, input.studioKey, input.authorId);
    if (normalized) connections.push(normalized);
  }
  return { licenseRef, rootRef, selectedRef, license, connections };
}

function assertAuthoritativeOwnership(
  license: Record<string, unknown>,
  input: { studioKey: string; authorId: string; actorEmail: string }
) {
  if (clean(license.status) !== "active") {
    throw new PluginSiteAuthorizationError(403, "PLUGIN_LICENSE_REVOKED", "This plugin license is inactive or revoked.");
  }
  const storedKey = clean(license.studioKey || license.key || license.licenseKey).toUpperCase();
  if (storedKey && storedKey !== input.studioKey.toUpperCase()) {
    throw new PluginSiteAuthorizationError(403, "PLUGIN_STUDIO_MISMATCH", "The plugin license does not match this StudioKey workspace.");
  }
  const storedAuthorId = clean(license.authorId);
  const storedEmail = clean(license.authorEmail || license.email || license.ownerEmail).toLowerCase();
  const ownsById = Boolean(storedAuthorId) && storedAuthorId === input.authorId;
  const ownsByEmail = Boolean(storedEmail) && storedEmail === input.actorEmail.trim().toLowerCase();
  if (!ownsById && !ownsByEmail) {
    throw new PluginSiteAuthorizationError(403, "PLUGIN_STUDIO_MISMATCH", "The plugin license is not assigned to the authenticated author.");
  }
}

function normalizeConnection(
  websiteConnectionId: string,
  data: Record<string, unknown>,
  studioKey: string,
  authorId: string
): StoredConnection | null {
  if (clean(data.studioKey) !== studioKey || clean(data.authorId) !== authorId) return null;
  const status = clean(data.status);
  if (status !== "active" && status !== "disabled" && status !== "verification_failed") return null;
  try {
    return {
      studioKey,
      authorId,
      websiteConnectionId,
      displayName: clean(data.displayName) || websiteConnectionId,
      wordpressOrigin: normalizePluginOrigin(data.wordpressOrigin || data.targetWpOrigin),
      wordpressUsername: clean(data.wordpressUsername || data.wpUsername),
      secretCredentialRef: clean(data.secretCredentialRef),
      contentRole: normalizeRole(data.contentRole),
      defaultUniverseId: clean(data.defaultUniverseId) || null,
      status,
      verificationStatus: clean(data.verificationStatus) === "verified" || data.verified === true
        ? "verified"
        : "unverified",
      verifiedAt: data.verifiedAt || null,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      registeredBy: clean(data.registeredBy),
    };
  } catch {
    return null;
  }
}

function emptyConnection(studioKey: string, authorId: string, websiteConnectionId: string): StoredConnection {
  return {
    studioKey,
    authorId,
    websiteConnectionId,
    displayName: "",
    wordpressOrigin: "",
    wordpressUsername: "",
    secretCredentialRef: "",
    contentRole: "both",
    defaultUniverseId: null,
    status: "verification_failed",
    verificationStatus: "unverified",
    verifiedAt: null,
    createdAt: null,
    updatedAt: null,
    registeredBy: "",
  };
}

function replaceConnection(connections: StoredConnection[], replacement: StoredConnection): StoredConnection[] {
  return [
    ...connections.filter((connection) => connection.websiteConnectionId !== replacement.websiteConnectionId),
    replacement,
  ];
}

function connectionsToEvidence(connections: StoredConnection[]): PluginSiteEvidence[] {
  return connections.map((connection) => ({
    websiteConnectionId: connection.websiteConnectionId,
    origin: connection.wordpressOrigin,
    role: connection.contentRole,
    status: connection.status,
    verificationStatus: connection.verificationStatus,
    verifiedAt: connection.verifiedAt,
    createdAt: connection.createdAt,
  }));
}

function assertCompleteVerifiedConnection(connection: StoredConnection) {
  if (!connection.wordpressUsername || !connection.secretCredentialRef) {
    throw new PluginSiteAuthorizationError(409, "PLUGIN_SITE_NOT_AUTHORIZED", "The verified website connection is incomplete.");
  }
}

function toConnectionWrite(connection: StoredConnection): Record<string, unknown> {
  return {
    studioKey: connection.studioKey,
    authorId: connection.authorId,
    websiteConnectionId: connection.websiteConnectionId,
    displayName: connection.displayName,
    contentRole: connection.contentRole,
    defaultUniverseId: connection.defaultUniverseId,
    status: connection.status,
    verificationStatus: connection.verificationStatus,
    targetWpOrigin: connection.wordpressOrigin,
    wpUsername: connection.wordpressUsername,
    secretCredentialRef: connection.secretCredentialRef,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    verifiedAt: connection.verifiedAt,
    registeredBy: connection.registeredBy,
    registrationMode: "author_self_service",
  };
}

function licensePatch(
  license: Record<string, unknown>,
  authorizedSites: PluginAuthorizedSite[],
  now: Timestamp
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    authorizedSites,
    maxAuthorizedSites: 2,
    siteGrantSchemaVersion: 1,
    updatedAt: now,
  };
  // Deprecated migration evidence only. Authorization never reads this once grants exist.
  if (!clean(license.associatedWebsite) && authorizedSites[0]) {
    patch.associatedWebsite = authorizedSites[0].origin;
  }
  return patch;
}

type AuditEvent = {
  action: "legacy_migration" | "site_authorization" | "role_change" | "revocation" | "replacement";
  grant: PluginAuthorizedSite;
  previous?: PluginAuthorizedSite;
};

function classifyAuditEvents(
  previousValue: unknown,
  next: PluginAuthorizedSite[],
  selectedId: string,
  operation: "verification" | "metadata" | "revocation",
  legacyEvidenceIds: Set<string>
): AuditEvent[] {
  const previous = Array.isArray(previousValue)
    ? previousValue.filter((site): site is PluginAuthorizedSite => Boolean(site && typeof site === "object"))
    : [];
  const events: AuditEvent[] = [];
  for (const grant of next) {
    const old = previous.find(
      (site) => site.websiteConnectionId === grant.websiteConnectionId && site.origin === grant.origin
    );
    if (!old && grant.status === "active") {
      events.push({
        action: previous.length === 0 && legacyEvidenceIds.has(grant.websiteConnectionId)
          ? "legacy_migration"
          : "site_authorization",
        grant,
      });
    } else if (old && old.status === "active" && grant.status === "revoked") {
      events.push({ action: "revocation", grant, previous: old });
    } else if (old && old.role !== grant.role) {
      events.push({ action: "role_change", grant, previous: old });
    }
  }
  if (operation === "verification") {
    const selected = next.find((site) => site.websiteConnectionId === selectedId && site.status === "active");
    const replaced = previous.find(
      (site) => site.websiteConnectionId === selectedId && selected && site.origin !== selected.origin
    );
    if (selected && replaced) events.push({ action: "replacement", grant: selected, previous: replaced });
    const priorRevoked = selected && !replaced
      ? previous.find(
          (site) => site.status === "revoked" &&
            site.origin !== selected.origin &&
            (site.role === selected.role || site.role === "both" || selected.role === "both")
        )
      : undefined;
    if (selected && priorRevoked) {
      events.push({ action: "replacement", grant: selected, previous: priorRevoked });
    }
  }
  return events;
}

function appendAuditEvents(
  transaction: FirebaseFirestore.Transaction,
  licenseRef: FirebaseFirestore.DocumentReference,
  events: AuditEvent[],
  input: { studioKey: string; authorId: string; actorEmail: string },
  now: Timestamp,
  auditId: () => string
): string[] {
  const ids: string[] = [];
  for (const event of events) {
    const id = auditId();
    ids.push(id);
    transaction.create(licenseRef.collection("site_authorization_audit").doc(id), {
      schemaVersion: 1,
      action: event.action,
      studioKey: input.studioKey,
      authorId: input.authorId,
      actor: input.actorEmail,
      websiteConnectionId: event.grant.websiteConnectionId,
      origin: event.grant.origin,
      role: event.grant.role,
      status: event.grant.status,
      previousOrigin: event.previous?.origin || null,
      previousRole: event.previous?.role || null,
      previousStatus: event.previous?.status || null,
      createdAt: now,
    });
  }
  return ids;
}

function normalizeRole(value: unknown): PluginSiteRole {
  return value === "business_brand" || value === "story_world" ? value : "both";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
