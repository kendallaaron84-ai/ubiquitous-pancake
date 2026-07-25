import { createHash } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { provisionAuthorPlugin } from "@/core/security/author-provisioning";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

interface ProvisionAuthorBody {
  authorName?: unknown;
  authorEmail?: unknown;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    enforceTrustedOrigin(request);

    const sessionToken = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Administrator authentication is required." },
        { status: 401 },
      );
    }

    let session;
    try {
      session = await verifyDashboardSession(
        sessionToken,
        resolveDashboardSessionSecret(),
      );
    } catch {
      return NextResponse.json(
        { success: false, error: "The administrator session is invalid or expired." },
        { status: 401 },
      );
    }

    const ownerEmails = new Set(
      (process.env.KOBA_OWNER_EMAILS || "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
    if (
      session.accessScope !== "full" ||
      !ownerEmails.has(session.email.trim().toLowerCase())
    ) {
      return NextResponse.json(
        { success: false, error: "Platform-owner access is required." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as ProvisionAuthorBody | null;
    const authorName = cleanText(body?.authorName);
    const authorEmail = cleanText(body?.authorEmail).toLowerCase();
    if (!authorName || authorName.length > 160) {
      return NextResponse.json(
        { success: false, error: "A valid author name is required." },
        { status: 400 },
      );
    }
    if (!EMAIL_PATTERN.test(authorEmail) || authorEmail.length > 254) {
      return NextResponse.json(
        { success: false, error: "A valid author email is required." },
        { status: 400 },
      );
    }

    const manualIdentity = createHash("sha256")
      .update(`manual-owner:${authorEmail}`)
      .digest("hex");
    const result = await provisionAuthorPlugin({
      authorName,
      authorEmail,
      source: "manual_owner",
      idempotencyKey: manualIdentity,
      hasAudiobookPlayer: true,
      hasEreader: false,
    });

    return NextResponse.json(
      {
        success: true,
        message: result.created
          ? "Author workspace provisioned and welcome package dispatched."
          : "The existing author workspace was reused and its welcome delivery was verified.",
        studioKey: result.studioKey,
        welcomeEmailSent: result.welcomeEmailSent,
      },
      {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error: unknown) {
    console.error(
      "Manual author provisioning failed:",
      error instanceof Error ? error.message : "Unknown provisioning failure.",
    );
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "The author could not be provisioned.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function enforceTrustedOrigin(request: Request): void {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) throw new Error("A trusted dashboard origin is required.");

  const allowedOrigins = new Set([
    new URL(request.url).origin,
    ...(process.env.KOBA_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  if (!allowedOrigins.has(origin)) {
    throw new Error("The request origin is not authorized.");
  }
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
}
