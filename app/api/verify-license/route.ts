import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import { listNexusWebsiteConnections } from "@/core/nexus/website-connections";
import {
  authorizePluginSite,
  isSupportedPluginLicenseKey,
  normalizePluginOrigin,
  PluginSiteAuthorizationError,
  type PluginSiteEvidence,
} from "@/core/security/plugin-site-authorization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Studio-Key, Authorization, Origin",
};

type LicenseLocation = {
  collection: "plugin_licenses" | "licenses";
  ref: FirebaseFirestore.DocumentReference;
};

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

async function locateLicense(pluginLicenseKey: string): Promise<LicenseLocation | null> {
  const pluginRef = adminDb.collection("plugin_licenses").doc(pluginLicenseKey);
  if ((await pluginRef.get()).exists) return { collection: "plugin_licenses", ref: pluginRef };

  const legacyRef = adminDb.collection("licenses").doc(pluginLicenseKey);
  if ((await legacyRef.get()).exists) return { collection: "licenses", ref: legacyRef };
  return null;
}

async function loadSiteEvidence(
  pluginLicenseKey: string,
  license: Record<string, unknown>
): Promise<PluginSiteEvidence[]> {
  const possibleAuthorIds = [license.authorId, license.authorEmail, license.email, license.ownerEmail]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const evidence = new Map<string, PluginSiteEvidence>();

  for (const authorId of new Set(possibleAuthorIds.map((value) => value.trim()))) {
    const connections = await listNexusWebsiteConnections(adminDb, pluginLicenseKey, authorId);
    for (const connection of connections) {
      evidence.set(connection.websiteConnectionId, {
        websiteConnectionId: connection.websiteConnectionId,
        origin: connection.wordpressOrigin,
        role: connection.contentRole,
        status: connection.status,
        verificationStatus: connection.status === "active" ? "verified" : "unverified",
        verifiedAt: connection.verifiedAt,
        createdAt: connection.createdAt,
      });
    }
  }
  return [...evidence.values()];
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    // Compatibility contract: installed plugins send the plugin-license document ID
    // in X-Studio-Key. Keep that header name until the plugin protocol is versioned.
    const pluginLicenseKey = request.headers.get("x-studio-key")?.trim().toUpperCase() || "";
    if (!isSupportedPluginLicenseKey(pluginLicenseKey)) {
      return json({ authorized: false, code: "PLUGIN_LICENSE_NOT_FOUND", error: "The plugin license was not found." }, 404);
    }

    const body = await request.json().catch(() => null) as { domain?: unknown } | null;
    const clientOrigin = normalizePluginOrigin(body?.domain, {
      production: process.env.NODE_ENV === "production",
    });
    const firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim() || "";
    if (!firebaseProjectId) {
      return json({
        authorized: false,
        code: "PLUGIN_ENVIRONMENT_MISMATCH",
        error: "Plugin license verification is not configured for this environment.",
      }, 503);
    }

    const location = await locateLicense(pluginLicenseKey);
    if (!location) {
      return json({ authorized: false, code: "PLUGIN_LICENSE_NOT_FOUND", error: "The plugin license was not found." }, 404);
    }

    const snapshot = await location.ref.get();
    if (!snapshot.exists) {
      return json({ authorized: false, code: "PLUGIN_LICENSE_NOT_FOUND", error: "The plugin license was not found." }, 404);
    }
    const license = snapshot.data() || {};
    const evidence = await loadSiteEvidence(pluginLicenseKey, license);
    const authorization = authorizePluginSite({
      pluginLicenseKey,
      clientOrigin,
      firebaseProjectId,
      license,
      evidence,
      now: new Date().toISOString(),
      actor: "wordpress_plugin_activation",
    });

    const entitlements = Array.isArray(license.pluginEntitlements)
      ? license.pluginEntitlements.filter((entry: unknown): entry is string => typeof entry === "string")
      : Array.isArray(license.entitlements)
        ? license.entitlements.filter((entry: unknown): entry is string => typeof entry === "string")
        : [];

    return json({
      authorized: true,
      studioKey: pluginLicenseKey,
      pluginLicenseKey,
      associatedWebsite: authorization.grant.origin,
      websiteConnectionId: authorization.grant.websiteConnectionId,
      role: authorization.grant.role,
      licenseSource: location.collection,
      licenseType: typeof license.licenseType === "string"
        ? license.licenseType
        : typeof license.type === "string" ? license.type : "audiobook_plugin",
      authorId: typeof license.authorId === "string" ? license.authorId : null,
      authorEmail: typeof license.authorEmail === "string" ? license.authorEmail : null,
      entitlements,
      message: "StudioKey verified and connected to this WordPress site.",
    }, 200);
  } catch (error) {
    if (error instanceof PluginSiteAuthorizationError) {
      return json({ authorized: false, code: error.code, error: error.publicMessage }, error.status);
    }
    console.error("Plugin license verification failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown plugin verification error",
    });
    return json({
      authorized: false,
      code: "PLUGIN_VERIFICATION_UNAVAILABLE",
      error: "License verification is temporarily unavailable.",
    }, 503);
  }
}
