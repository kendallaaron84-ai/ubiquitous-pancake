import { NextResponse } from "next/server";

import { AuthorInvitationError } from "@/core/security/author-invitation";

export interface AuthorInvitationHandlersDependencies {
  resolve(token: string): Promise<{ authorEmail: string; authorName: string; expiresAt: number }>;
  establish(input: { token: string; password: string }): Promise<{ customToken: string; email: string }>;
}

export function createAuthorInvitationHandlers(dependencies: AuthorInvitationHandlersDependencies) {
  async function GET(request: Request) {
    try {
      const token = new URL(request.url).searchParams.get("token")?.trim() || "";
      const invitation = await dependencies.resolve(token);
      return NextResponse.json({ success: true, invitation }, { headers: noStore() });
    } catch (error) {
      return invitationFailure(error);
    }
  }

  async function POST(request: Request) {
    try {
      const body = await request.json().catch(() => null) as { token?: unknown; password?: unknown } | null;
      const token = typeof body?.token === "string" ? body.token.trim() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const result = await dependencies.establish({ token, password });
      return NextResponse.json({ success: true, customToken: result.customToken, email: result.email }, { headers: noStore() });
    } catch (error) {
      return invitationFailure(error);
    }
  }

  return { GET, POST };
}

function invitationFailure(error: unknown) {
  const known = error instanceof AuthorInvitationError ? error : null;
  if (!known) console.error("Author invitation request failed.", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({
    success: false,
    code: known?.code || "AUTHOR_INVITATION_FAILED",
    error: known?.message || "The account-establishment request could not be completed.",
  }, { status: known?.status || 500, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store" };
}
