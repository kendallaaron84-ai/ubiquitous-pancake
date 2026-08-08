import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { cookies } from "next/headers";

import { adminDb } from "@/core/firebase-admin";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import {
  createModernConnectionRegistrationHandlers,
  type ConnectionRegistrationConfiguration,
} from "./modern-handler";
import {
  assertWebsiteCapacityAndUniqueness,
  websiteConnectionIdForOrigin,
} from "@/core/nexus/website-connections";
import { persistVerifiedPluginWebsite } from "@/core/security/plugin-site-grant-persistence";
import {
  resolveWordPressGatewayUrl,
  verifyAndProvisionThroughGateway,
} from "@/core/security/wordpress-egress-gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const handlers = createModernConnectionRegistrationHandlers({
  loadConfiguration: loadConfiguration,
  readSessionToken: async () =>
    (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value || null,
  verifySession: (token) =>
    verifyDashboardSession(token, resolveDashboardSessionSecret()),
  resolvePublicHostname,
  resolveAuthorOwnership: async (studioKey) => {
    const license = await adminDb.collection("plugin_licenses").doc(studioKey).get();
    if (!license.exists) throw new Error("The author workspace was not found.");
    const data = license.data() || {};
    if (String(data.status || "").trim() !== "active") {
      throw new Error("The author workspace is inactive.");
    }
    const storedKey = String(data.studioKey || data.key || "").trim().toUpperCase();
    if (storedKey && storedKey !== studioKey) throw new Error("The author workspace identity is inconsistent.");
    const authorId = String(data.authorId || data.authorEmail || "").trim().toLowerCase();
    if (!authorId) throw new Error("The author workspace owner is unavailable.");
    return { authorId, primaryUserRef: adminDb.collection("users").doc(authorId) };
  },
  websiteConnectionIdForOrigin,
  assertWebsiteAvailable: async (input) => assertWebsiteCapacityAndUniqueness(adminDb, {
    studioKey: input.studioKey,
    authorId: input.authorId,
    wordpressOrigin: input.wordpressOrigin,
    excludeId: input.websiteConnectionId,
    contentRole: input.contentRole,
  }),
  verifyAndProvision: async (input) => {
    const gatewayUrl = resolveWordPressGatewayUrl();
    if (!gatewayUrl) throw new Error("The secure WordPress connection gateway is not configured.");
    return verifyAndProvisionThroughGateway(gatewayUrl, input);
  },
  persistWebsite: async (input) => persistVerifiedPluginWebsite(adminDb, {
    studioKey: input.studioKey,
    authorId: input.authorId,
    actorEmail: input.actorEmail,
    firebaseProjectId: input.firebaseProjectId,
    websiteConnectionId: input.websiteConnectionId,
    wordpressOrigin: input.wordpressOrigin,
    wordpressUsername: input.wordpressUsername,
    secretCredentialRef: input.secretCredentialRef,
    contentRole: input.contentRole,
    displayName: input.displayName,
    defaultUniverseId: null,
    primaryUserRef: input.primaryUserRef as FirebaseFirestore.DocumentReference | undefined,
  }),
});

export const POST = handlers.POST;

function loadConfiguration(): ConnectionRegistrationConfiguration {
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim() || "";
  const ownerEmails = splitCsv(process.env.KOBA_OWNER_EMAILS);
  const allowedOrigins = splitCsv(process.env.KOBA_ALLOWED_ORIGINS);

  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseProjectId)) {
    throw new Error("FIREBASE_PROJECT_ID is invalid.");
  }
  if (ownerEmails.length === 0) {
    throw new Error("KOBA_OWNER_EMAILS must explicitly identify an administrator.");
  }

  return {
    firebaseProjectId,
    ownerEmails,
    allowedOrigins,
  };
}

async function resolvePublicHostname(hostname: string): Promise<void> {
  const normalized = hostname.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "metadata.google.internal"
  ) {
    throw new Error("Private WordPress hosts cannot be registered.");
  }

  const directIpVersion = isIP(normalized);
  const addresses = directIpVersion
    ? [{ address: normalized, family: directIpVersion }]
    : await lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("WordPress must resolve exclusively to public network addresses.");
  }
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value.includes(":")) {
    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      /^fe[89ab]/.test(value) ||
      value.startsWith("::ffff:127.") ||
      value.startsWith("::ffff:10.") ||
      value.startsWith("::ffff:192.168.")
    );
  }

  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function splitCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
