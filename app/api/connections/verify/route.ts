import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
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
  loadWordPressConnectionConfiguration,
  verifyAndProvisionWordPressConnection,
  verifyStoredWordPressConnection,
  WordPressConnectionDiagnosticError,
  type WordPressConnectionDiagnosticCode,
} from "@/core/security/wordpress-connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const secretManager = new SecretManagerServiceClient({
  projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim(),
  },
});

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
    const snapshot = await adminDb.collection("connections").doc(context.studioKey).get();
    const connection = snapshot.data() || {};
    const isConnected =
      snapshot.exists &&
      connection.status === "active" &&
      connection.verificationStatus === "verified";
    const shouldTest = new URL(request.url).searchParams.get("test") === "1";
    if (shouldTest) {
      if (!isConnected) {
        throw new ConnectionRouteError(409, "Connect your WordPress site before testing it.");
      }
      try {
        await verifyStoredWordPressConnection(secretManager, {
          targetWpOrigin: connection.targetWpOrigin,
          wpUsername: connection.wpUsername,
          secretCredentialRef: connection.secretCredentialRef,
        });
      } catch (error: unknown) {
        if (error instanceof WordPressConnectionDiagnosticError) {
          throw await diagnosticRouteError(
            error,
            context,
            clean(connection.targetWpOrigin)
          );
        }
        console.error("Saved WordPress connection test failed.");
        throw new ConnectionRouteError(
          400,
          "We could not verify your saved WordPress connection. Check WordPress or choose Change WordPress Site to reconnect."
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
          status: isConnected ? "connected" : "not_connected",
          targetWpOrigin: isConnected
            ? clean(connection.targetWpOrigin)
            : clean(savedUserConnection.targetUrl),
          wpUsername: isConnected
            ? clean(connection.wpUsername)
            : clean(savedUserConnection.wpUsername),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: unknown) {
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
        }
      | null;
    if (!body) {
      throw new ConnectionRouteError(400, "Enter your WordPress connection details.");
    }
    const requestedOrigin = safeOrigin(body.targetWpOrigin ?? body.targetUrl);

    let verified;
    try {
      verified = await verifyAndProvisionWordPressConnection(
        secretManager,
        loadWordPressConnectionConfiguration(),
        {
          studioKey: context.studioKey,
          targetWpOrigin: body.targetWpOrigin ?? body.targetUrl,
          wpUsername: body.wpUsername,
          wpAppPassword: body.wpAppPassword,
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
      console.error("Author WordPress secure connection setup failed.");
      throw await diagnosticRouteError(
        new WordPressConnectionDiagnosticError(
          "VAULT_PROVISION_FAIL",
          "Your site was verified, but secure setup could not finish. Please retry."
        ),
        context,
        requestedOrigin
      );
    }

    const connectionRef = adminDb.collection("connections").doc(context.studioKey);
    const existingConnection = await connectionRef.get();
    const existingData = existingConnection.data() || {};
    const timestamp = FieldValue.serverTimestamp();

    await adminDb.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
      transaction.set(
        connectionRef,
        {
          studioKey: context.studioKey,
          status: "active",
          verificationStatus: "verified",
          targetWpOrigin: verified.targetWpOrigin,
          wpUsername: verified.wpUsername,
          secretCredentialRef: verified.secretCredentialRef,
          createdAt: existingData.createdAt || timestamp,
          updatedAt: timestamp,
          verifiedAt: timestamp,
          registeredBy: context.session.email,
          registrationMode: "author_self_service",
        },
        { merge: true }
      );
      transaction.set(
        context.userRef,
        {
          wpConnection: {
            targetUrl: verified.targetWpOrigin,
            wpUsername: verified.wpUsername,
            status: "connected",
            lastVerifiedAt: timestamp,
            studioKey: context.studioKey,
          },
          updatedAt: timestamp,
        },
        { merge: true }
      );
    });

    return NextResponse.json({
      success: true,
      message: context.hasContentEngineAccess
        ? "Your WordPress site is connected and ready for blog drafts."
        : "Your WordPress site is securely connected. Blog draft delivery will be ready when you activate the Blog Engine.",
      connection: {
        status: "connected",
        targetWpOrigin: verified.targetWpOrigin,
        wpUsername: verified.wpUsername,
      },
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
    readonly code?: WordPressConnectionDiagnosticCode,
    readonly ticketId?: string
  ) {
    super(publicMessage);
  }
}

function connectionErrorResponse(error: unknown) {
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
