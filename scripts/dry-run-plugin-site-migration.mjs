import { existsSync, readFileSync } from "node:fs";

const environmentFile = process.env.KOBA_DRY_RUN_ENV_FILE || ".env.local";
if (existsSync(environmentFile)) {
  for (const rawLine of readFileSync(environmentFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[name]) process.env[name] = value;
  }
}

const [{ getFirebaseAdminServices }, authorization] = await Promise.all([
  import("../core/firebase-admin.ts"),
  import("../core/security/plugin-site-authorization.ts"),
]);

const studioKey = (process.argv[2] || "KOBA-AUDIO-E63DC9CA").trim().toUpperCase();
if (!authorization.isSupportedPluginLicenseKey(studioKey)) {
  throw new Error("Provide a supported KOBA-I StudioKey as the first argument.");
}

const database = getFirebaseAdminServices().db;
const licenseRef = database.collection("plugin_licenses").doc(studioKey);
const connectionRef = database.collection("connections").doc(studioKey);
let licenseSnapshot;
let primarySnapshot;
let websiteSnapshots;
try {
  [licenseSnapshot, primarySnapshot, websiteSnapshots] = await Promise.all([
    licenseRef.get(),
    connectionRef.get(),
    connectionRef.collection("websites").get(),
  ]);
} catch (error) {
  console.log(JSON.stringify({
    mode: "read_only",
    writesAttempted: 0,
    studioKey,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || "",
    decision: "BLOCKED_READ_FAILED",
    blockingError: {
      code: typeof error === "object" && error && "code" in error
        ? `FIRESTORE_${String(error.code)}`
        : "FIRESTORE_READ_FAILED",
      message: "Firestore could not authenticate or complete the read-only dry run.",
    },
  }, null, 2));
  process.exitCode = 2;
  process.exit();
}

const license = licenseSnapshot.data() || {};
const connections = [
  ...(primarySnapshot.exists ? [toConnection("primary", primarySnapshot.data() || {})] : []),
  ...websiteSnapshots.docs.map((snapshot) => toConnection(snapshot.id, snapshot.data() || {})),
];
const evidence = connections.map((connection) => ({
  websiteConnectionId: connection.websiteConnectionId,
  origin: connection.origin,
  role: connection.role,
  status: connection.status,
  verificationStatus: connection.verificationStatus,
  verifiedAt: connection.verifiedAt,
  createdAt: connection.createdAt,
}));

let proposedAuthorizedSites = [];
let decision = "NO_LICENSE";
let blockingError = null;
if (licenseSnapshot.exists) {
  try {
    proposedAuthorizedSites = authorization.reconcilePluginSiteGrants({
      pluginLicenseKey: studioKey,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || "",
      license,
      evidence,
      now: "DRY_RUN_TIMESTAMP",
      actor: "dry_run",
    });
    decision = sameSites(license.authorizedSites, proposedAuthorizedSites)
      ? "NO_CHANGE"
      : "MIGRATION_AVAILABLE_REQUIRES_EXPLICIT_APPROVAL";
  } catch (error) {
    decision = "BLOCKED";
    blockingError = {
      code: typeof error === "object" && error && "code" in error ? String(error.code) : "DRY_RUN_FAILED",
      message: error instanceof Error ? error.message : "The dry run could not evaluate this license.",
    };
  }
}

console.log(JSON.stringify({
  mode: "read_only",
  writesAttempted: 0,
  studioKey,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || "",
  license: {
    exists: licenseSnapshot.exists,
    status: clean(license.status),
    authorIdPresent: Boolean(clean(license.authorId)),
    authorEmailPresent: Boolean(clean(license.authorEmail || license.email || license.ownerEmail)),
    associatedWebsite: clean(license.associatedWebsite) || null,
    associatedWebsiteUsage: "deprecated_migration_evidence_only",
    existingAuthorizedSites: sanitizeSites(license.authorizedSites),
  },
  verifiedConnectionEvidence: connections,
  proposedAuthorizedSites: sanitizeSites(proposedAuthorizedSites),
  decision,
  blockingError,
}, null, 2));

function toConnection(websiteConnectionId, data) {
  return {
    websiteConnectionId,
    origin: clean(data.targetWpOrigin || data.wordpressOrigin),
    role: normalizeRole(data.contentRole),
    status: clean(data.status),
    verificationStatus: clean(data.verificationStatus),
    verifiedAt: data.verifiedAt || null,
    createdAt: data.createdAt || null,
    authorIdPresent: Boolean(clean(data.authorId)),
    studioKeyMatches: clean(data.studioKey) === studioKey,
    hasIndependentCredentialReference: Boolean(clean(data.secretCredentialRef)),
  };
}

function sanitizeSites(value) {
  if (!Array.isArray(value)) return [];
  return value.map((site) => ({
    websiteConnectionId: clean(site?.websiteConnectionId),
    origin: clean(site?.origin),
    role: normalizeRole(site?.role),
    status: clean(site?.status),
  }));
}

function sameSites(left, right) {
  return JSON.stringify(sanitizeSites(left).sort(compareSite)) ===
    JSON.stringify(sanitizeSites(right).sort(compareSite));
}

function compareSite(left, right) {
  return `${left.websiteConnectionId}|${left.origin}`.localeCompare(
    `${right.websiteConnectionId}|${right.origin}`
  );
}

function normalizeRole(value) {
  return value === "business_brand" || value === "story_world" ? value : "both";
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
