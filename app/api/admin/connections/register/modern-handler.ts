import { NextResponse } from "next/server";

import { BlogConnectionError, normalizeHttpsOrigin } from "@/core/security/blog-connection";
import type { DashboardSessionClaims } from "@/core/security/dashboard-session";
import type { VerifiedWordPressConnection } from "@/core/security/wordpress-connection";

const STUDIO_KEY_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const WEBSITE_ID_PATTERN = /^site_[a-f0-9]{16}$/;

interface RegistrationBody {
  studioKey?: unknown;
  targetWpOrigin?: unknown;
  wpUsername?: unknown;
  wpAppPassword?: unknown;
  contentRole?: unknown;
  displayName?: unknown;
}

export interface ConnectionRegistrationConfiguration {
  firebaseProjectId: string;
  ownerEmails: readonly string[];
  allowedOrigins: readonly string[];
}

export interface ModernConnectionRegistrationDependencies {
  loadConfiguration(): ConnectionRegistrationConfiguration;
  readSessionToken(): Promise<string | null>;
  verifySession(token: string): Promise<DashboardSessionClaims>;
  resolvePublicHostname(hostname: string): Promise<void>;
  resolveAuthorOwnership(studioKey: string): Promise<{ authorId: string; primaryUserRef?: unknown }>;
  websiteConnectionIdForOrigin(origin: string): string;
  assertWebsiteAvailable(input: {
    studioKey: string;
    authorId: string;
    wordpressOrigin: string;
    websiteConnectionId: string;
    contentRole: "business_brand" | "story_world" | "both";
  }): Promise<void>;
  verifyAndProvision(input: {
    studioKey: string;
    websiteConnectionId: string;
    targetWpOrigin: string;
    wpUsername: string;
    wpAppPassword: string;
  }): Promise<VerifiedWordPressConnection>;
  persistWebsite(input: {
    studioKey: string;
    authorId: string;
    actorEmail: string;
    firebaseProjectId: string;
    websiteConnectionId: string;
    wordpressOrigin: string;
    wordpressUsername: string;
    secretCredentialRef: string;
    contentRole: "business_brand" | "story_world" | "both";
    displayName: string;
    primaryUserRef?: unknown;
  }): Promise<{ grant: unknown }>;
}

class RegistrationError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly code?: string;

  constructor(status: number, publicMessage: string, code?: string) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = code;
  }
}

export function createModernConnectionRegistrationHandlers(
  dependencies: ModernConnectionRegistrationDependencies,
) {
  async function POST(request: Request) {
    try {
      const configuration = dependencies.loadConfiguration();
      enforceSameOriginRequest(request, configuration.allowedOrigins);
      const sessionToken = await dependencies.readSessionToken();
      if (!sessionToken) throw new RegistrationError(401, "Administrator authentication is required.");

      let session: DashboardSessionClaims;
      try {
        session = await dependencies.verifySession(sessionToken);
      } catch {
        throw new RegistrationError(401, "The administrator session is invalid or expired.");
      }
      const owners = new Set(configuration.ownerEmails.map((email) => email.trim().toLowerCase()));
      if (session.accessScope !== "full" || !owners.has(session.email.trim().toLowerCase())) {
        throw new RegistrationError(403, "Administrator access is required.");
      }

      const body = await request.json().catch(() => null) as RegistrationBody | null;
      const studioKey = trimString(body?.studioKey).toUpperCase();
      const wpUsername = trimString(body?.wpUsername);
      const wpAppPassword = trimString(body?.wpAppPassword);
      if (!STUDIO_KEY_PATTERN.test(studioKey)) throw new RegistrationError(400, "A valid studioKey is required.");
      if (!wpUsername || wpUsername.length > 160) throw new RegistrationError(400, "A valid WordPress username is required.");
      if (!wpAppPassword || wpAppPassword.length > 512) throw new RegistrationError(400, "A valid WordPress Application Password is required.");

      let targetWpOrigin: string;
      try {
        targetWpOrigin = normalizeHttpsOrigin(body?.targetWpOrigin);
      } catch {
        throw new RegistrationError(400, "Enter a valid HTTPS WordPress site origin.");
      }
      const contentRole = normalizeContentRole(body?.contentRole);
      await dependencies.resolvePublicHostname(new URL(targetWpOrigin).hostname);
      const ownership = await dependencies.resolveAuthorOwnership(studioKey);
      const websiteConnectionId = dependencies.websiteConnectionIdForOrigin(targetWpOrigin);
      if (!WEBSITE_ID_PATTERN.test(websiteConnectionId)) {
        throw new RegistrationError(400, "The website connection identifier is invalid.");
      }

      await dependencies.assertWebsiteAvailable({
        studioKey,
        authorId: ownership.authorId,
        wordpressOrigin: targetWpOrigin,
        websiteConnectionId,
        contentRole,
      });
      const verified = await dependencies.verifyAndProvision({
        studioKey,
        websiteConnectionId,
        targetWpOrigin,
        wpUsername,
        wpAppPassword,
      });
      const persisted = await dependencies.persistWebsite({
        studioKey,
        authorId: ownership.authorId,
        actorEmail: session.email.trim().toLowerCase(),
        firebaseProjectId: configuration.firebaseProjectId,
        websiteConnectionId,
        wordpressOrigin: verified.targetWpOrigin,
        wordpressUsername: verified.wpUsername,
        secretCredentialRef: verified.secretCredentialRef,
        contentRole,
        displayName: trimString(body?.displayName).slice(0, 120) || new URL(verified.targetWpOrigin).hostname,
        primaryUserRef: ownership.primaryUserRef,
      });

      return NextResponse.json({
        success: true,
        connection: {
          studioKey,
          websiteConnectionId,
          status: "active",
          verificationStatus: "verified",
          targetWpOrigin: verified.targetWpOrigin,
          wpUsername: verified.wpUsername,
          contentRole,
        },
        grant: persisted.grant,
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error: unknown) {
      if (error instanceof RegistrationError) return failure(error.status, error.publicMessage, error.code);
      if (isPublicBoundaryError(error)) {
        const status = typeof error.status === "number"
          ? error.status
          : error.details?.httpStatus === 401 ? 401 : 400;
        return failure(status, error.publicMessage, error.code);
      }
      if (error instanceof BlogConnectionError) return failure(409, error.message);
      console.error("WordPress connection registration failed:", safeError(error));
      return failure(503, "The secure WordPress connection service is unavailable.");
    }
  }
  return { POST };
}

function normalizeContentRole(value: unknown): "business_brand" | "story_world" | "both" {
  if (value === "business_brand" || value === "story_world") return value;
  return "both";
}

function enforceSameOriginRequest(request: Request, configuredOrigins: readonly string[]): void {
  const suppliedOrigin = trimString(request.headers.get("origin"));
  if (!suppliedOrigin) throw new RegistrationError(403, "A trusted dashboard origin is required.");
  const allowedOrigins = new Set([new URL(request.url).origin, ...configuredOrigins]);
  if (!allowedOrigins.has(suppliedOrigin)) throw new RegistrationError(403, "The request origin is not authorized.");
}

function failure(status: number, error: string, code?: string) {
  return NextResponse.json({ success: false, ...(code ? { code } : {}), error }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown registration failure.";
}

function isPublicBoundaryError(error: unknown): error is {
  status?: number;
  publicMessage: string;
  code?: string;
  details?: { httpStatus?: number };
} {
  return typeof error === "object" && error !== null &&
    "publicMessage" in error && typeof (error as { publicMessage?: unknown }).publicMessage === "string";
}
