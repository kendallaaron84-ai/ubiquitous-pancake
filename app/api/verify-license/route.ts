import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Studio-Key, Authorization, Origin",
};

const STUDIO_KEY_PATTERN = /^KOBA-AUDIO-[A-F0-9]{16}$/;

type LicenseLocation = {
  collection: "plugin_licenses" | "licenses";
  ref: FirebaseFirestore.DocumentReference;
};

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

async function locateLicense(studioKey: string): Promise<LicenseLocation | null> {
  const pluginRef = adminDb.collection("plugin_licenses").doc(studioKey);
  if ((await pluginRef.get()).exists) {
    return { collection: "plugin_licenses", ref: pluginRef };
  }

  const legacyRef = adminDb.collection("licenses").doc(studioKey);
  if ((await legacyRef.get()).exists) {
    return { collection: "licenses", ref: legacyRef };
  }
  return null;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const studioKey = request.headers.get("x-studio-key")?.trim() || "";
    if (!STUDIO_KEY_PATTERN.test(studioKey)) {
      return json({ authorized: false, error: "A valid StudioKey is required." }, 401);
    }

    const body = await request.json().catch(() => null) as { domain?: unknown } | null;
    const clientOrigin = normalizeOrigin(body?.domain);
    if (!clientOrigin) {
      return json({ authorized: false, error: "A valid WordPress site origin is required." }, 400);
    }

    const location = await locateLicense(studioKey);
    if (!location) {
      return json({ authorized: false, error: "StudioKey is invalid or inactive." }, 403);
    }

    const result = await adminDb.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
      const snapshot = await transaction.get(location.ref);
      if (!snapshot.exists) throw new Error("LICENSE_NOT_FOUND");
      const license = snapshot.data() || {};
      if (license.status !== "active") throw new Error("LICENSE_INACTIVE");

      const lockedOrigin = normalizeOrigin(license.associatedWebsite);
      if (lockedOrigin && lockedOrigin !== clientOrigin) {
        const conflict = new Error("DOMAIN_CONFLICT") as Error & { lockedOrigin?: string };
        conflict.lockedOrigin = lockedOrigin;
        throw conflict;
      }

      if (!lockedOrigin) {
        transaction.update(location.ref, {
          associatedWebsite: clientOrigin,
          activatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const entitlements = Array.isArray(license.pluginEntitlements)
        ? license.pluginEntitlements.filter((entry: unknown): entry is string => typeof entry === "string")
        : Array.isArray(license.entitlements)
          ? license.entitlements.filter((entry: unknown): entry is string => typeof entry === "string")
          : [];

      return {
        licenseType: typeof license.licenseType === "string"
          ? license.licenseType
          : typeof license.type === "string"
            ? license.type
            : "audiobook_plugin",
        authorId: typeof license.authorId === "string" ? license.authorId : null,
        authorEmail: typeof license.authorEmail === "string" ? license.authorEmail : null,
        entitlements,
      };
    });

    return json({
      authorized: true,
      studioKey,
      associatedWebsite: clientOrigin,
      licenseSource: location.collection,
      ...result,
      message: "StudioKey verified and connected to this WordPress site.",
    }, 200);
  } catch (error) {
    if (error instanceof Error && error.message === "DOMAIN_CONFLICT") {
      return json({
        authorized: false,
        error: "This StudioKey is already connected to another website.",
        lockedTo: (error as Error & { lockedOrigin?: string }).lockedOrigin || null,
      }, 403);
    }
    if (error instanceof Error && (error.message === "LICENSE_NOT_FOUND" || error.message === "LICENSE_INACTIVE")) {
      return json({ authorized: false, error: "StudioKey is invalid or inactive." }, 403);
    }
    console.error("StudioKey verification failed.", error);
    return json({ authorized: false, error: "License verification is temporarily unavailable." }, 500);
  }
}
