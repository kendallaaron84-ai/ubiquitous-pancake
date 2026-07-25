import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { FieldValue } from "firebase-admin/firestore";
import { cookies } from "next/headers";

import { adminDb } from "@/core/firebase-admin";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import {
  createConnectionRegistrationHandlers,
  type ConnectionRegistrationConfiguration,
} from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const DEV_SECRET_PROJECT_ID = "jubilee-command-center---dev";
const DEV_SECRET_PROJECT_NUMBER = "751521788548";
const DEV_WORKER_SERVICE_ACCOUNT =
  "content-worker-dev@jubilee-command-center---dev.iam.gserviceaccount.com";

const secretManager = new SecretManagerServiceClient({
  projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim(),
  },
});

const handlers = createConnectionRegistrationHandlers({
  db: adminDb,
  secretManager,
  serverTimestamp: () => FieldValue.serverTimestamp(),
  loadConfiguration: loadConfiguration,
  readSessionToken: async () =>
    (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value || null,
  verifySession: (token) =>
    verifyDashboardSession(token, resolveDashboardSessionSecret()),
  resolvePublicHostname,
  fetchImpl: fetch,
});

export const POST = handlers.POST;

function loadConfiguration(): ConnectionRegistrationConfiguration {
  const secretProjectId =
    process.env.CONNECTION_SECRET_PROJECT_ID?.trim() ||
    process.env.CLOUD_TASKS_PROJECT_ID?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : DEV_SECRET_PROJECT_ID);
  const secretProjectNumber =
    process.env.CONNECTION_SECRET_PROJECT_NUMBER?.trim() ||
    (secretProjectId === DEV_SECRET_PROJECT_ID ? DEV_SECRET_PROJECT_NUMBER : "");
  const workerServiceAccount =
    process.env.CONTENT_WORKER_SERVICE_ACCOUNT?.trim() ||
    (secretProjectId === DEV_SECRET_PROJECT_ID ? DEV_WORKER_SERVICE_ACCOUNT : "");
  const ownerEmails = splitCsv(process.env.KOBA_OWNER_EMAILS);
  const allowedOrigins = splitCsv(process.env.KOBA_ALLOWED_ORIGINS);

  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(secretProjectId)) {
    throw new Error("CONNECTION_SECRET_PROJECT_ID is invalid.");
  }
  if (!/^[0-9]{6,20}$/.test(secretProjectNumber)) {
    throw new Error("CONNECTION_SECRET_PROJECT_NUMBER is invalid.");
  }
  if (!workerServiceAccount.endsWith(".iam.gserviceaccount.com")) {
    throw new Error("CONTENT_WORKER_SERVICE_ACCOUNT is invalid.");
  }
  if (ownerEmails.length === 0) {
    throw new Error("KOBA_OWNER_EMAILS must explicitly identify an administrator.");
  }

  return {
    secretProjectId,
    secretProjectNumber,
    workerServiceAccount,
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

