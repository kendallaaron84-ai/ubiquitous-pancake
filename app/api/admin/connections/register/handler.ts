import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  BlogConnectionError,
  normalizeHttpsOrigin,
} from "@/core/security/blog-connection";
import type { DashboardSessionClaims } from "@/core/security/dashboard-session";

const STUDIO_KEY_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const WORDPRESS_AUTH_ERROR =
  "WordPress authentication failed. Please check the URL, Username, and Application Password.";

interface RegistrationBody {
  studioKey?: unknown;
  targetWpOrigin?: unknown;
  wpUsername?: unknown;
  wpAppPassword?: unknown;
}

export interface ConnectionRegistrationConfiguration {
  secretProjectId: string;
  secretProjectNumber: string;
  workerServiceAccount: string;
  ownerEmails: readonly string[];
  allowedOrigins: readonly string[];
}

interface SecretManagerLike {
  createSecret(request: Record<string, unknown>): Promise<unknown>;
  addSecretVersion(request: Record<string, unknown>): Promise<unknown>;
  getIamPolicy(request: Record<string, unknown>): Promise<unknown>;
  setIamPolicy(request: Record<string, unknown>): Promise<unknown>;
}

interface FirestoreDocumentLike {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(value: Record<string, unknown>, options: { merge: boolean }): Promise<unknown>;
}

interface FirestoreLike {
  collection(name: string): {
    doc(id: string): FirestoreDocumentLike;
  };
}

export interface ConnectionRegistrationDependencies {
  db: FirestoreLike;
  secretManager: SecretManagerLike;
  serverTimestamp(): unknown;
  loadConfiguration(): ConnectionRegistrationConfiguration;
  readSessionToken(): Promise<string | null>;
  verifySession(token: string): Promise<DashboardSessionClaims>;
  resolvePublicHostname(hostname: string): Promise<void>;
  fetchImpl: typeof fetch;
}

class RegistrationError extends Error {
  readonly status: number;
  readonly publicMessage: string;

  constructor(
    status: number,
    publicMessage: string,
    message = publicMessage
  ) {
    super(message);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export function createConnectionRegistrationHandlers(
  dependencies: ConnectionRegistrationDependencies
) {
  async function POST(request: Request) {
    try {
      const configuration = dependencies.loadConfiguration();
      enforceSameOriginRequest(request, configuration.allowedOrigins);

      const sessionToken = await dependencies.readSessionToken();
      if (!sessionToken) {
        throw new RegistrationError(401, "Administrator authentication is required.");
      }

      let session: DashboardSessionClaims;
      try {
        session = await dependencies.verifySession(sessionToken);
      } catch {
        throw new RegistrationError(401, "The administrator session is invalid or expired.");
      }

      const ownerEmails = new Set(
        configuration.ownerEmails.map((email) => email.trim().toLowerCase())
      );
      if (
        session.accessScope !== "full" ||
        !ownerEmails.has(session.email.trim().toLowerCase())
      ) {
        throw new RegistrationError(403, "Administrator access is required.");
      }

      const body = (await request.json().catch(() => null)) as RegistrationBody | null;
      const studioKey = trimString(body?.studioKey);
      const wpUsername = trimString(body?.wpUsername);
      const wpAppPassword = trimString(body?.wpAppPassword);
      if (!STUDIO_KEY_PATTERN.test(studioKey)) {
        throw new RegistrationError(400, "A valid studioKey is required.");
      }
      if (!wpUsername || wpUsername.length > 160) {
        throw new RegistrationError(400, "A valid WordPress username is required.");
      }
      if (!wpAppPassword || wpAppPassword.length > 512) {
        throw new RegistrationError(400, "A valid WordPress Application Password is required.");
      }

      let targetWpOrigin: string;
      try {
        targetWpOrigin = normalizeHttpsOrigin(body?.targetWpOrigin);
      } catch (error: unknown) {
        throw new RegistrationError(
          400,
          "Enter a valid HTTPS WordPress site origin.",
          error instanceof Error
            ? error.message
            : "The WordPress origin could not be normalized."
        );
      }

      try {
        await dependencies.resolvePublicHostname(new URL(targetWpOrigin).hostname);
        await verifyWordPressCredentials(
          dependencies.fetchImpl,
          targetWpOrigin,
          wpUsername,
          wpAppPassword
        );
      } catch {
        throw new RegistrationError(400, WORDPRESS_AUTH_ERROR);
      }

      const secretId = `WP_CREDS_${studioKey}`;
      const secretResourceName =
        `projects/${configuration.secretProjectId}/secrets/${secretId}`;
      const secretCredentialRef =
        `projects/${configuration.secretProjectNumber}/secrets/${secretId}/versions/latest`;
      const secretPayload = Buffer.from(
        JSON.stringify({
          wordpressUrl: targetWpOrigin,
          username: wpUsername,
          applicationPassword: wpAppPassword,
        }),
        "utf8"
      );

      try {
        await createSecretIfMissing(
          dependencies.secretManager,
          configuration.secretProjectId,
          secretId
        );
        await dependencies.secretManager.addSecretVersion({
          parent: secretResourceName,
          payload: { data: secretPayload },
        });
        await grantWorkerSecretAccess(
          dependencies.secretManager,
          secretResourceName,
          configuration.workerServiceAccount
        );
      } catch (error: unknown) {
        console.error("WordPress connection secret provisioning failed:", safeError(error));
        throw new RegistrationError(
          503,
          "The secure WordPress credential could not be provisioned."
        );
      } finally {
        secretPayload.fill(0);
      }

      const reference = dependencies.db.collection("connections").doc(studioKey);
      const existing = await reference.get();
      const existingData = existing.exists ? existing.data() || {} : {};
      const timestamp = dependencies.serverTimestamp();
      await reference.set(
        {
          studioKey,
          status: "active",
          verificationStatus: "verified",
          targetWpOrigin,
          secretCredentialRef,
          createdAt: existingData.createdAt || timestamp,
          updatedAt: timestamp,
          verifiedAt: timestamp,
          registeredBy: session.email.trim().toLowerCase(),
        },
        { merge: true }
      );

      return NextResponse.json({
        success: true,
        connection: {
          studioKey,
          status: "active",
          verificationStatus: "verified",
          targetWpOrigin,
        },
      });
    } catch (error: unknown) {
      if (error instanceof RegistrationError) {
        return NextResponse.json(
          { success: false, error: error.publicMessage },
          { status: error.status }
        );
      }

      console.error("WordPress connection registration failed:", safeError(error));
      return NextResponse.json(
        { success: false, error: "The WordPress connection could not be registered." },
        { status: 500 }
      );
    }
  }

  return { POST };
}

async function verifyWordPressCredentials(
  fetchImpl: typeof fetch,
  targetWpOrigin: string,
  username: string,
  applicationPassword: string
): Promise<void> {
  const authorization = Buffer.from(
    `${username}:${applicationPassword}`,
    "utf8"
  ).toString("base64");
  const requestOptions: RequestInit = {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${authorization}`,
      "User-Agent": "KOBA-I-Connection-Registrar/1.0",
    },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  };
  const userResponse = await fetchImpl(
    `${targetWpOrigin}/wp-json/wp/v2/users/me?context=edit`,
    requestOptions
  );
  if (!userResponse.ok) {
    throw new Error("WordPress preflight rejected the supplied credential.");
  }

  const authenticatedUser = (await userResponse.json().catch(() => null)) as
    | { id?: unknown; capabilities?: Record<string, unknown> }
    | null;
  if (
    !authenticatedUser ||
    typeof authenticatedUser.id !== "number" ||
    !Number.isInteger(authenticatedUser.id) ||
    authenticatedUser.capabilities?.edit_posts !== true ||
    authenticatedUser.capabilities?.upload_files !== true
  ) {
    throw new Error("WordPress user cannot stage posts and upload featured media.");
  }

  const postTypeResponse = await fetchImpl(
    `${targetWpOrigin}/wp-json/wp/v2/types/post?context=edit`,
    requestOptions
  );
  if (!postTypeResponse.ok) {
    throw new Error("WordPress post staging API is unavailable.");
  }
}

async function createSecretIfMissing(
  secretManager: SecretManagerLike,
  projectId: string,
  secretId: string
): Promise<void> {
  try {
    await secretManager.createSecret({
      parent: `projects/${projectId}`,
      secretId,
      secret: { replication: { automatic: {} } },
    });
  } catch (error: unknown) {
    if (grpcStatusCode(error) !== 6) throw error;
  }
}

async function grantWorkerSecretAccess(
  secretManager: SecretManagerLike,
  resource: string,
  workerServiceAccount: string
): Promise<void> {
  const response = (await secretManager.getIamPolicy({ resource })) as
    | [{ bindings?: Array<{ role?: string | null; members?: string[] | null }>; etag?: unknown }]
    | { bindings?: Array<{ role?: string | null; members?: string[] | null }>; etag?: unknown };
  const policy = Array.isArray(response) ? response[0] || {} : response;
  const bindings = Array.isArray(policy.bindings)
    ? policy.bindings.map((binding) => ({
        role: binding.role || "",
        members: Array.isArray(binding.members) ? [...binding.members] : [],
      }))
    : [];
  const role = "roles/secretmanager.secretAccessor";
  const member = `serviceAccount:${workerServiceAccount}`;
  const existingBinding = bindings.find((binding) => binding.role === role);
  if (existingBinding) {
    if (!existingBinding.members.includes(member)) {
      existingBinding.members.push(member);
    }
  } else {
    bindings.push({ role, members: [member] });
  }

  await secretManager.setIamPolicy({
    resource,
    policy: {
      ...(policy.etag ? { etag: policy.etag } : {}),
      bindings,
    },
  });
}

function enforceSameOriginRequest(
  request: Request,
  configuredOrigins: readonly string[]
): void {
  const suppliedOrigin = trimString(request.headers.get("origin"));
  if (!suppliedOrigin) {
    throw new RegistrationError(403, "A trusted dashboard origin is required.");
  }
  const requestOrigin = new URL(request.url).origin;
  const allowedOrigins = new Set([requestOrigin, ...configuredOrigins]);
  if (!allowedOrigins.has(suppliedOrigin)) {
    throw new RegistrationError(403, "The request origin is not authorized.");
  }
}

function grpcStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown registration failure.";
}
