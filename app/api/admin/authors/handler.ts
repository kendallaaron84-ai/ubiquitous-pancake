import { NextResponse } from "next/server";
import type { DashboardSessionClaims } from "@/core/security/dashboard-session";
import type { AuthorOnboardingQueueItem } from "@/core/security/author-onboarding-queue";

export interface AuthorQueueDependencies {
  readSessionToken(): Promise<string | null>;
  verifySession(token: string): Promise<DashboardSessionClaims>;
  ownerEmails: readonly string[];
  loadQueue(): Promise<AuthorOnboardingQueueItem[]>;
}

export function createAuthorQueueHandlers(dependencies: AuthorQueueDependencies) {
  async function GET() {
    const token = await dependencies.readSessionToken();
    if (!token) return failure(401, "Administrator authentication is required.");
    try {
      const session = await dependencies.verifySession(token);
      const owners = new Set(dependencies.ownerEmails.map((email) => email.trim().toLowerCase()));
      if (session.accessScope !== "full" || !owners.has(session.email.trim().toLowerCase())) return failure(403, "Platform-owner access is required.");
      return NextResponse.json({ success: true, authors: await dependencies.loadQueue() }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      console.error("Owner author queue failed.", { name: error instanceof Error ? error.name : "UnknownError" });
      return failure(500, "The author-onboarding queue could not be loaded.");
    }
  }
  return { GET };
}

function failure(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "private, no-store" } });
}
