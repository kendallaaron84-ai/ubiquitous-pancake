import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { GoogleAuth } from "google-auth-library";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import { sendSupportIncidentAlert } from "@/core/messaging/mailer";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
  type DashboardSessionClaims,
} from "@/core/security/dashboard-session";
import { resolveContentEngineAccess } from "@/core/security/content-engine-access";
import {
  assertWebsiteCapacityAndUniqueness,
  listNexusWebsiteConnections,
  websiteConnectionIdForOrigin,
} from "@/core/nexus/website-connections";
import {
  loadWordPressConnectionConfiguration,
  verifyAndProvisionWordPressConnection,
  verifyStoredWordPressConnection,
  WordPressConnectionDiagnosticError,
  type VerifiedWordPressConnection,
  type WordPressConnectionDiagnosticCode,
} from "@/core/security/wordpress-connection";
import { BlogConnectionError } from "@/core/security/blog-connection";
import {
  persistVerifiedPluginWebsite,
} from "@/core/security/plugin-site-grant-persistence";
import { PluginSiteAuthorizationError } from "@/core/security/plugin-site-authorization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

let secretManagerClient: SecretManagerServiceClient | null = null;
let gatewayAuthClient: GoogleAuth | null = null;
const DEFAULT_PRODUCTION_WORDPRESS_GATEWAY =
  "https://wordpress-egress-gateway-prod-aoosgrwosq-uc.a.run.app";

interface WordPressGatewayResponse {
  success?: boolean;
  code?: string;
  error?: string;
  targetWpOrigin?: string;
  wpUsername?: string;
  secretCredentialRef?: string;
}

function getSecretManagerClient(): SecretManagerServiceClient {
  if (secretManagerClient) return secretManagerClient;

  const projectId =
    process.env.CONNECTION_SECRET_PROJECT_ID?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim();

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    .trim();

  const missing = [
    !projectId && "CONNECTION_SECRET_PROJECT_ID/FIREBASE_PROJECT_ID",
    !clientEmail && "FIREBASE_CLIENT_EMAIL",
    !privateKey && "FIREBASE_PRIVATE_KEY",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Secret Manager client configuration is incomplete: ${missing.join(", ")}`
    );
  }

  secretManagerClient = new SecretManagerServiceClient({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });

  return secretManagerClient;
}

function getGatewayAuthClient(): GoogleAuth {
  if (gatewayAuthClient) return gatewayAuthClient;

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    .trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Cloud Run gateway authentication is not configured.");
  }

  gatewayAuthClient = new GoogleAuth({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });

  return gatewayAuthClient;
}

function resolveWordPressGatewayUrl(): string {
  const configured =
    process.env.WORDPRESS_EGRESS_GATEWAY_URL?.trim() ||
    (process.env.NODE_ENV === "production"
      ? DEFAULT_PRODUCTION_WORDPRESS_GATEWAY
      : "");
  if (!configured) return "";

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("WORDPRESS_EGRESS_GATEWAY_URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "WORDPRESS_EGRESS_GATEWAY_URL must be a public HTTPS service URL."
    );
  }
  return parsed.origin;
}

async function verifyAndProvisionThroughGateway(
  gatewayUrl: string,
  input: {
    studioKey: string;
    websiteConnectionId: string;
    targetWpOrigin: unknown;
    wpUsername: unknown;
    wpAppPassword: unknown;
  }
): Promise<VerifiedWordPressConnection> {
  let gatewayResponse: {
    status: number;
    data: WordPressGatewayResponse;
  };

  try {
    const authenticatedClient =
      await getGatewayAuthClient().getIdTokenClient(gatewayUrl);
    const response = await authenticatedClient.request<WordPressGatewayResponse>(
      {
        url: `${gatewayUrl}/verify-wordpress`,
        method: "POST",
        data: input,
        timeout: 20_000,
        validateStatus: () => true,
      }
    );
    gatewayResponse = {
      status: response.status,
      data: response.data || {},
    };
  } catch (error: unknown) {
    console.error("[WordPress Connection] Egress gateway request failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    throw new WordPressConnectionDiagnosticError(
      "NETWORK_TIMEOUT_TLS",
      "KOBA-I could not reach the secure WordPress connection service. Please retry."
    );
  }

  const payload = gatewayResponse.data;
  if (gatewayResponse.status < 200 || gatewayResponse.status >= 300) {
    const gatewayCode = clean(payload.code);
    const publicMessage =
      clean(payload.error) ||
      "KOBA-I could not complete the secure WordPress connection.";
    const diagnosticCodes = new Set<WordPressConnectionDiagnosticCode>([
      "INVALID_CREDENTIALS",
      "INSUFFICIENT_PERMISSIONS",
      "FIREWALL_CHALLENGE",
      "NETWORK_TIMEOUT_TLS",
      "REST_API_DISABLED",
      "VAULT_PROVISION_FAIL",
    ]);

    if (
      diagnosticCodes.has(gatewayCode as WordPressConnectionDiagnosticCode)
    ) {
      throw new WordPressConnectionDiagnosticError(
        gatewayCode as WordPressConnectionDiagnosticCode,
        publicMessage,
        { httpStatus: gatewayResponse.status }
      );
    }
    if (gatewayResponse.status === 401 || gatewayResponse.status === 403) {
      throw new WordPressConnectionDiagnosticError(
        "VAULT_PROVISION_FAIL",
        "KOBA-I could not authorize the secure WordPress connection service. Please retry."
      );
    }
    throw new Error(publicMessage);
  }

  const targetWpOrigin = clean(payload.targetWpOrigin);
  const wpUsername = clean(payload.wpUsername);
  const secretCredentialRef = clean(payload.secretCredentialRef);
  if (
    payload.success !== true ||
    !targetWpOrigin ||
    !wpUsername ||
    !/^projects\/[0-9]+\/secrets\/WP_CREDS_[A-Za-z0-9_-]+\/versions\/latest$/.test(
      secretCredentialRef
    )
  ) {
    throw new WordPressConnectionDiagnosticError(
      "VAULT_PROVISION_FAIL",
      "Your site was verified, but secure setup returned an incomplete result. Please retry."
    );
  }

  return {
    studioKey: clean(input.studioKey),
    targetWpOrigin,
    wpUsername,
    secretCredentialRef,
  };
}

type AuthorRecord = Record<string, unknown>;

interface AuthorContext {
  session: DashboardSessionClaims;
  studioKey: string;
  userRef: FirebaseFirestore.DocumentReference;
  userData: AuthorRecord;
  licenseData: AuthorRecord;
  hasContentEngineAccess: boolean;
}

export async function GET(request: Request) {
  try {
    const context = await loadAuthorContext();
    const authorId =
      clean(context.licenseData.authorId) || context.session.email.toLowerCase();
    const websites = await listNexusWebsiteConnections(
      adminDb,
      context.studioKey,
      authorId
    );
    const primaryConnection = websites.find(
      (website) => website.websiteConnectionId === "primary"
    );
    const requestUrl = new URL(request.url);
    const shouldTest = requestUrl.searchParams.get("test") === "1";
    const requestedConnectionId = clean(
      requestUrl.searchParams.get("websiteConnectionId")
    );
    if (shouldTest) {
      const selectedConnection = websites.find(
        (website) =>
          website.websiteConnectionId === (requestedConnectionId || "primary")
      );
      if (!selectedConnection || selectedConnection.status !== "active") {
        throw new ConnectionRouteError(
          409,
          "Select an active WordPress website before testing it."
        );
      }
      try {
        await verifyStoredWordPressConnection(getSecretManagerClient(), {
          targetWpOrigin: selectedConnection.wordpressOrigin,
          wpUsername: selectedConnection.wordpressUsername,
          secretCredentialRef: selectedConnection.secretCredentialRef,
        });
      } catch (error: unknown) {
        if (error instanceof WordPressConnectionDiagnosticError) {
          throw await diagnosticRouteError(
            error,
            context,
            selectedConnection.wordpressOrigin
          );
        }
        console.error("Saved WordPress connection test failed.");
        throw new ConnectionRouteError(
          400,
          "We could not verify this saved WordPress connection. Check its WordPress credentials and try again."
        );
      }
    }
    const savedUserConnection =
      typeof context.userData.wpConnection === "object" && context.userData.wpConnection
        ? (context.userData.wpConnection as AuthorRecord)
        : {};

    return NextResponse.json(
      {
        success: true,
        hasContentEngineAccess: context.hasContentEngineAccess,
        hasWorkspace: true,
        ...(shouldTest
          ? { message: "Your WordPress connection is working." }
          : {}),
        connection: {
          status: primaryConnection?.status === "active" ? "connected" : "not_connected",
          targetWpOrigin: primaryConnection
            ? primaryConnection.wordpressOrigin
            : clean(savedUserConnection.targetUrl),
          wpUsername: primaryConnection
            ? primaryConnection.wordpressUsername
            : clean(savedUserConnection.wpUsername),
        },
        websites: websites.map((website) => ({
          websiteConnectionId: website.websiteConnectionId,
          displayName: website.displayName,
          wordpressOrigin: website.wordpressOrigin,
          wordpressUsername: website.wordpressUsername,
          contentRole: website.contentRole,
          defaultUniverseId: website.defaultUniverseId,
          status: website.status,
          verifiedAt: website.verifiedAt,
          lastValidatedAt: website.lastValidatedAt,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: unknown) {
    const err = error as Record<string, unknown> | null;
    console.error("[WordPress Connection] Status request failed.", {
      message: err instanceof Error ? err.message : String(error),
      code: err?.code || null,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return connectionErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    enforceSameOrigin(request);
    const context = await loadAuthorContext();

    const body = (await request.json().catch(() => null)) as
      | {
          targetWpOrigin?: unknown;
          targetUrl?: unknown;
          wpUsername?: unknown;
          wpAppPassword?: unknown;
          websiteConnectionId?: unknown;
          displayName?: unknown;
          contentRole?: unknown;
          defaultUniverseId?: unknown;
        }
      | null;
    if (!body) {
      throw new ConnectionRouteError(400, "Enter your WordPress connection details.");
    }
    const requestedOrigin = safeOrigin(body.targetWpOrigin ?? body.targetUrl);
    const rootConnectionRef = adminDb.collection("connections").doc(context.studioKey);
    const rootSnapshot = await rootConnectionRef.get();
    const requestedConnectionId = clean(body.websiteConnectionId);
    const websiteConnectionId = requestedConnectionId ||
      (rootSnapshot.exists
        ? websiteConnectionIdForOrigin(requestedOrigin)
        : "primary");
    if (websiteConnectionId !== "primary" && !/^site_[a-f0-9]{16}$/.test(websiteConnectionId)) {
      throw new ConnectionRouteError(400, "The website connection selection is invalid.");
    }
    const requestedContentRole = body.contentRole === "business_brand" ||
      body.contentRole === "story_world" || body.contentRole === "both"
      ? body.contentRole
      : "both";
    await assertWebsiteCapacityAndUniqueness(adminDb, {
      studioKey: context.studioKey,
      authorId: clean(context.licenseData.authorId) || context.session.email.toLowerCase(),
      wordpressOrigin: requestedOrigin,
      excludeId: websiteConnectionId,
      contentRole: requestedContentRole,
    });

    let configuration: ReturnType<
      typeof loadWordPressConnectionConfiguration
    >;
    try {
      configuration = loadWordPressConnectionConfiguration();
      console.info("[WordPress Connection] Configuration loaded.", {
        secretProjectId: configuration.secretProjectId,
        secretProjectNumber: configuration.secretProjectNumber,
        workerServiceAccount: configuration.workerServiceAccount,
        credentialServiceAccount:
          process.env.FIREBASE_CLIENT_EMAIL?.trim() || "missing",
      });
    } catch (error: unknown) {
      console.error("[WordPress Connection] Configuration failed.", {
        message: error instanceof Error ? error.message : String(error),
        hasSecretProjectId: Boolean(
          process.env.CONNECTION_SECRET_PROJECT_ID?.trim()
        ),
        hasSecretProjectNumber: Boolean(
          process.env.CONNECTION_SECRET_PROJECT_NUMBER?.trim()
        ),
        hasWorkerServiceAccount: Boolean(
          process.env.CONTENT_WORKER_SERVICE_ACCOUNT?.trim()
        ),
        hasFirebaseClientEmail: Boolean(
          process.env.FIREBASE_CLIENT_EMAIL?.trim()
        ),
        hasFirebasePrivateKey: Boolean(
          process.env.FIREBASE_PRIVATE_KEY?.trim()
        ),
      });
      throw new ConnectionRouteError(
        503,
        "KOBA-I secure connection storage is not configured correctly."
      );
    }

    let verified: VerifiedWordPressConnection;
    try {
      const secretManager = getSecretManagerClient();
      const gatewayUrl = resolveWordPressGatewayUrl();
      const connectionInput = {
        studioKey: context.studioKey,
        websiteConnectionId,
        targetWpOrigin: body.targetWpOrigin ?? body.targetUrl,
        wpUsername: body.wpUsername,
        wpAppPassword: body.wpAppPassword,
      };
      verified = gatewayUrl
        ? await verifyAndProvisionThroughGateway(
            gatewayUrl,
            connectionInput
          )
        : await verifyAndProvisionWordPressConnection(
            secretManager,
            configuration,
            {
              ...connectionInput,
              studioKey: websiteConnectionId === "primary"
                ? context.studioKey
                : `${context.studioKey}-${websiteConnectionId}`,
            }
          );
    } catch (error: unknown) {
      if (error instanceof WordPressConnectionDiagnosticError) {
        throw await diagnosticRouteError(error, context, requestedOrigin);
      }
      const message = safeMessage(error);
      if (isWordPressInputFailure(message)) {
        throw new ConnectionRouteError(400, message);
      }
      console.error("[WordPress Connection] Unexpected setup failure.", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        code:
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: unknown }).code
            : null,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw await diagnosticRouteError(
        new WordPressConnectionDiagnosticError(
          "VAULT_PROVISION_FAIL",
          "Your site was verified, but secure setup could not finish. Please retry."
        ),
        context,
        requestedOrigin
      );
    }

    let persisted;
    try {
      persisted = await persistVerifiedPluginWebsite(adminDb, {
        studioKey: context.studioKey,
        authorId: clean(context.licenseData.authorId) || context.session.email.toLowerCase(),
        actorEmail: context.session.email,
        firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || "",
        websiteConnectionId,
        wordpressOrigin: verified.targetWpOrigin,
        wordpressUsername: verified.wpUsername,
        secretCredentialRef: verified.secretCredentialRef,
        contentRole: requestedContentRole,
        displayName: clean(body.displayName).slice(0, 120) || new URL(verified.targetWpOrigin).hostname,
        defaultUniverseId: clean(body.defaultUniverseId) || null,
        primaryUserRef: context.userRef,
      });
    } catch (error) {
      if (error instanceof PluginSiteAuthorizationError) {
        throw new ConnectionRouteError(error.status, error.publicMessage, error.code);
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: context.hasContentEngineAccess
        ? "Your WordPress site is connected and ready for blog drafts."
        : "Your WordPress site is securely connected. Blog draft delivery will be ready when you activate the Blog Engine.",
      connection: {
        status: "connected",
        websiteConnectionId,
        targetWpOrigin: verified.targetWpOrigin,
        wpUsername: verified.wpUsername,
      },
      grant: persisted.grant,
    });
  } catch (error: unknown) {
    return connectionErrorResponse(error);
  }
}

async function loadAuthorContext(): Promise<AuthorContext> {
  const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
  if (!token) {
    throw new ConnectionRouteError(401, "Sign in to manage your WordPress connection.");
  }

  let session: DashboardSessionClaims;
  try {
    session = await verifyDashboardSession(token, resolveDashboardSessionSecret());
  } catch {
    throw new ConnectionRouteError(401, "Your session expired. Sign in again.");
  }

  const studioKey = clean(session.studioKey);
  if (!studioKey) {
    throw new ConnectionRouteError(
      409,
      "Your author workspace is not linked to a StudioKey yet."
    );
  }

  const licenseSnapshot = await adminDb
    .collection("plugin_licenses")
    .doc(studioKey)
    .get();
  const licenseData = licenseSnapshot.data() || {};
  if (
    !licenseSnapshot.exists ||
    licenseData.status !== "active" ||
    clean(licenseData.authorEmail).toLowerCase() !== session.email.toLowerCase()
  ) {
    throw new ConnectionRouteError(
      403,
      "This StudioKey is not assigned to the signed-in author."
    );
  }

  const canonicalUserRef = adminDb.collection("users").doc(session.email.toLowerCase());
  let userRef = canonicalUserRef;
  let userSnapshot = await canonicalUserRef.get();
  if (!userSnapshot.exists) {
    const uidReference = adminDb.collection("users").doc(session.uid);
    const uidSnapshot = await uidReference.get();
    if (uidSnapshot.exists) {
      userRef = uidReference;
      userSnapshot = uidSnapshot;
    }
  }
  const userData = userSnapshot.data() || {};

  return {
    session,
    studioKey,
    userRef,
    userData,
    licenseData,
    hasContentEngineAccess: resolveContentEngineAccess(session, userData, licenseData),
  };
}

function enforceSameOrigin(request: Request): void {
  let origin = clean(request.headers.get("origin"));
  if (!origin) {
    const referer = clean(request.headers.get("referer"));
    if (referer) {
      try {
        origin = new URL(referer).origin;
      } catch {
        throw new ConnectionRouteError(403, "A trusted dashboard origin is required.");
      }
    }
  }
  if (!origin) {
    throw new ConnectionRouteError(403, "A trusted dashboard origin is required.");
  }
  const allowedOrigins = new Set([
    new URL(request.url).origin,
    ...(process.env.KOBA_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  if (!allowedOrigins.has(origin)) {
    throw new ConnectionRouteError(403, "This request did not come from the KOBA-I dashboard.");
  }
}

class ConnectionRouteError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    readonly code?: WordPressConnectionDiagnosticCode | string,
    readonly ticketId?: string
  ) {
    super(publicMessage);
  }
}

function connectionErrorResponse(error: unknown) {
  if (error instanceof BlogConnectionError) {
    return NextResponse.json(
      { success: false, error: error.message, code: "WEBSITE_CONFIGURATION_CONFLICT" },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (error instanceof ConnectionRouteError) {
    return NextResponse.json(
      {
        success: false,
        error: error.publicMessage,
        ...(error.code ? { code: error.code } : {}),
        ...(error.ticketId ? { ticketId: error.ticketId } : {}),
      },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  console.error("Author WordPress connection failed:", safeMessage(error));
  return NextResponse.json(
    { success: false, error: "The WordPress connection could not be loaded." },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}

function isWordPressInputFailure(message: string): boolean {
  return [
    "WordPress",
    "wordpress",
    "HTTPS",
    "public",
    "username",
    "Application Password",
    "StudioKey",
  ].some((fragment) => message.includes(fragment));
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown connection failure.";
}

async function diagnosticRouteError(
  error: WordPressConnectionDiagnosticError,
  context: AuthorContext,
  targetWpOrigin: string
): Promise<ConnectionRouteError> {
  const status =
    error.code === "NETWORK_TIMEOUT_TLS" || error.code === "VAULT_PROVISION_FAIL"
      ? 503
      : 400;
  if (
    (error.code !== "FIREWALL_CHALLENGE" &&
      error.code !== "VAULT_PROVISION_FAIL") ||
    !targetWpOrigin
  ) {
    return new ConnectionRouteError(
      status,
      error.publicMessage,
      error.code
    );
  }

  try {
    const incident = await createOrReuseSupportIncident({
      error,
      context,
      targetWpOrigin,
    });
    if (incident.created) {
      scheduleOwnerAlert({
        ticketId: incident.ticketId,
        error,
        context,
        targetWpOrigin,
      });
    }
    const message =
      error.code === "FIREWALL_CHALLENGE"
        ? `Your website blocked the connection. We recorded the issue for support as Reference #${incident.ticketId}.`
        : `Your site was verified, but secure setup could not finish. We recorded the issue as Reference #${incident.ticketId}. Please retry.`;
    return new ConnectionRouteError(
      status,
      message,
      error.code,
      incident.ticketId
    );
  } catch {
    console.error(
      `[KOBA-I Support] Incident logging failed for ${error.code}.`
    );
    return new ConnectionRouteError(
      status,
      error.code === "FIREWALL_CHALLENGE"
        ? "Your website blocked the connection. Please retry, or contact KOBA-I support if the block continues."
        : error.publicMessage,
      error.code
    );
  }
}

async function createOrReuseSupportIncident({
  error,
  context,
  targetWpOrigin,
}: {
  error: WordPressConnectionDiagnosticError;
  context: AuthorContext;
  targetWpOrigin: string;
}): Promise<{ ticketId: string; created: boolean }> {
  const nowMs = Date.now();
  const fingerprint = createHash("sha256")
    .update(`${context.studioKey}|${targetWpOrigin}|${error.code}`)
    .digest("hex");
  const pointerRef = adminDb
    .collection("support_ticket_dedup")
    .doc(fingerprint) as FirebaseFirestore.DocumentReference;
  const proposedTicketId =
    `KBA-${nowMs.toString(36).toUpperCase()}-${fingerprint.slice(0, 5).toUpperCase()}`;

  return adminDb.runTransaction(
    async (
      transaction: FirebaseFirestore.Transaction
    ): Promise<{ ticketId: string; created: boolean }> => {
      const pointerSnapshot = await transaction.get(pointerRef);
      const pointerData = pointerSnapshot.data() || {};
      const existingTicketId = clean(pointerData.ticketId);
      const lastSeenAtMs =
        typeof pointerData.lastSeenAtMs === "number"
          ? pointerData.lastSeenAtMs
          : 0;
      let existingTicketSnapshot: FirebaseFirestore.DocumentSnapshot | null =
        null;
      if (existingTicketId && nowMs - lastSeenAtMs < 60 * 60 * 1_000) {
        const existingTicketRef = adminDb
          .collection("support_tickets")
          .doc(existingTicketId) as FirebaseFirestore.DocumentReference;
        existingTicketSnapshot = await transaction.get(existingTicketRef);
      }

      if (
        existingTicketSnapshot?.exists &&
        existingTicketSnapshot.data()?.status === "open"
      ) {
        const attemptCount = Number(
          existingTicketSnapshot.data()?.attemptCount || 1
        );
        transaction.set(
          existingTicketSnapshot.ref,
          {
            attemptCount: attemptCount + 1,
            lastSeenAt: FieldValue.serverTimestamp(),
            lastSeenAtMs: nowMs,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        transaction.set(
          pointerRef,
          {
            ticketId: existingTicketId,
            lastSeenAtMs: nowMs,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return { ticketId: existingTicketId, created: false };
      }

      const ticketRef = adminDb
        .collection("support_tickets")
        .doc(proposedTicketId) as FirebaseFirestore.DocumentReference;
      transaction.set(ticketRef, {
        ticketId: proposedTicketId,
        fingerprint,
        type:
          error.code === "FIREWALL_CHALLENGE"
            ? "wordpress_firewall_block"
            : "wordpress_vault_provision_failure",
        errorCategory: error.code,
        priority:
          error.code === "VAULT_PROVISION_FAIL" ? "high" : "normal",
        studioKey: context.studioKey,
        authorEmail: context.session.email,
        targetWpOrigin,
        provider: clean(error.details.provider) || "Unknown",
        httpStatus:
          typeof error.details.httpStatus === "number"
            ? error.details.httpStatus
            : null,
        status: "open",
        attemptCount: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      });
      transaction.set(pointerRef, {
        ticketId: proposedTicketId,
        lastSeenAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ticketId: proposedTicketId, created: true };
    }
  );
}

function scheduleOwnerAlert({
  ticketId,
  error,
  context,
  targetWpOrigin,
}: {
  ticketId: string;
  error: WordPressConnectionDiagnosticError;
  context: AuthorContext;
  targetWpOrigin: string;
}): void {
  const ownerEmails = (process.env.KOBA_OWNER_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (ownerEmails.length === 0) return;

  after(async () => {
    try {
      await sendSupportIncidentAlert({
        toEmails: ownerEmails,
        ticketId,
        errorCategory: error.code,
        authorEmail: context.session.email,
        studioKey: context.studioKey,
        targetWpOrigin,
        provider: error.details.provider,
        httpStatus: error.details.httpStatus,
      });
    } catch {
      console.error(
        `[KOBA-I Support] Owner alert delivery failed for ${ticketId}.`
      );
    }
  });
}

function safeOrigin(value: unknown): string {
  const input = clean(value);
  if (!input) return "";
  try {
    const parsed = new URL(input);
    const allowedProtocol =
      parsed.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" && parsed.protocol === "http:");
    return allowedProtocol ? parsed.origin : "";
  } catch {
    return "";
  }
}
