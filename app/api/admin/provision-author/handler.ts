import { NextResponse } from "next/server";

import type { AuthorProvisioningInput, AuthorProvisioningResult } from "@/core/security/author-provisioning";
import type { DashboardSessionClaims } from "@/core/security/dashboard-session";

interface ProvisionAuthorBody {
  authorName?: unknown;
  authorEmail?: unknown;
  hasAudiobookPlayer?: unknown;
  hasEreader?: unknown;
  welcomeDelivery?: unknown;
}

export interface ProvisionAuthorDependencies {
  readSessionToken(): Promise<string | null>;
  verifySession(token: string): Promise<DashboardSessionClaims>;
  ownerEmails: readonly string[];
  allowedOrigins: readonly string[];
  provisionAuthor(input: AuthorProvisioningInput): Promise<AuthorProvisioningResult>;
  createIdempotencyKey(authorEmail: string): string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createProvisionAuthorHandlers(dependencies: ProvisionAuthorDependencies) {
  async function POST(request: Request) {
    try {
      enforceTrustedOrigin(request, dependencies.allowedOrigins);
      const sessionToken = await dependencies.readSessionToken();
      if (!sessionToken) return failure(401, "Administrator authentication is required.");

      let session: DashboardSessionClaims;
      try {
        session = await dependencies.verifySession(sessionToken);
      } catch {
        return failure(401, "The administrator session is invalid or expired.");
      }

      const ownerEmails = new Set(dependencies.ownerEmails.map((email) => email.trim().toLowerCase()));
      if (session.accessScope !== "full" || !ownerEmails.has(session.email.trim().toLowerCase())) {
        return failure(403, "Platform-owner access is required.");
      }

      const body = await request.json().catch(() => null) as ProvisionAuthorBody | null;
      const authorName = cleanText(body?.authorName);
      const authorEmail = cleanText(body?.authorEmail).toLowerCase();
      if (!authorName || authorName.length > 160) return failure(400, "A valid author name is required.");
      if (!EMAIL_PATTERN.test(authorEmail) || authorEmail.length > 254) return failure(400, "A valid author email is required.");

      const hasAudiobookPlayer = body?.hasAudiobookPlayer !== false;
      const hasEreader = body?.hasEreader === true;
      if (!hasAudiobookPlayer && !hasEreader) {
        return failure(400, "Select at least one author publication capability.");
      }
      const welcomeDelivery = body?.welcomeDelivery === "defer" ? "defer" : "send";
      const result = await dependencies.provisionAuthor({
        authorName,
        authorEmail,
        source: "manual_owner",
        idempotencyKey: dependencies.createIdempotencyKey(authorEmail),
        hasAudiobookPlayer,
        hasEreader,
        welcomeDelivery,
      });

      const deferred = result.welcomeEmailStatus === "deferred";
      return NextResponse.json({
        success: true,
        message: result.created
          ? deferred
            ? "Author workspace provisioned. Welcome delivery is deferred."
            : "Author workspace provisioned and welcome package dispatched."
          : deferred
            ? "The existing author workspace was reused. Welcome delivery remains deferred."
            : "The existing author workspace was reused and its welcome delivery was processed.",
        studioKey: result.studioKey,
        welcomeEmailSent: result.welcomeEmailSent,
        welcomeEmailStatus: result.welcomeEmailStatus,
        capabilities: { hasAudiobookPlayer, hasEreader },
      }, {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error: unknown) {
      console.error("Manual author provisioning failed:", error instanceof Error ? error.message : "Unknown provisioning failure.");
      return failure(500, error instanceof Error ? error.message : "The author could not be provisioned.");
    }
  }

  return { POST };
}

function enforceTrustedOrigin(request: Request, configuredOrigins: readonly string[]): void {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) throw new Error("A trusted dashboard origin is required.");
  const allowedOrigins = new Set([new URL(request.url).origin, ...configuredOrigins]);
  if (!allowedOrigins.has(origin)) throw new Error("The request origin is not authorized.");
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function failure(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}
