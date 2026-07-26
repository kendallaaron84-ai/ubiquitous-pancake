import { NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";

import { adminAuth, adminDb } from "@/core/firebase-admin";
import { ensureOwnerWorkspace } from "@/core/security/owner-provisioning";
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  issueDashboardSession,
  resolveDashboardAccessScope,
  resolveDashboardSessionSecret,
} from "@/core/security/dashboard-session";

export const dynamic = "force-dynamic";

const STUDIO_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

interface ResolvedLicense {
  data: DocumentData;
  documentId: string;
  source: "licenses" | "plugin_licenses";
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown server error.";
}

function normalizePluginEntitlements(licenseData: DocumentData): string[] {
  const candidates: unknown[] = [
    licenseData.type,
    licenseData.licenseType,
    ...(Array.isArray(licenseData.entitlements)
      ? licenseData.entitlements
      : []),
    ...(Array.isArray(licenseData.pluginEntitlements)
      ? licenseData.pluginEntitlements
      : []),
    ...(Array.isArray(licenseData.features)
      ? licenseData.features
      : []),
  ];

  return Array.from(
    new Set(candidates.map(trimString).filter(Boolean))
  );
}

async function findExactLicense(
  studioKey: string
): Promise<ResolvedLicense | null> {
  const stripeLicenseDoc = await adminDb
    .collection("licenses")
    .doc(studioKey)
    .get();

  if (stripeLicenseDoc.exists) {
    return {
      data: stripeLicenseDoc.data() || {},
      documentId: stripeLicenseDoc.id,
      source: "licenses",
    };
  }

  const directPluginLicenseDoc = await adminDb
    .collection("plugin_licenses")
    .doc(studioKey)
    .get();

  if (directPluginLicenseDoc.exists) {
    return {
      data: directPluginLicenseDoc.data() || {},
      documentId: directPluginLicenseDoc.id,
      source: "plugin_licenses",
    };
  }

  const pluginLicenseQuery = await adminDb
    .collection("plugin_licenses")
    .where("key", "==", studioKey)
    .limit(1)
    .get();

  if (pluginLicenseQuery.empty) {
    return null;
  }

  return {
    data: pluginLicenseQuery.docs[0].data() || {},
    documentId: pluginLicenseQuery.docs[0].id,
    source: "plugin_licenses",
  };
}

export async function POST(request: Request) {
  try {
    const text = await request.text();

    if (!text.trim()) {
      return NextResponse.json(
        { success: false, error: "Empty authorization handshake payload." },
        { status: 400 }
      );
    }

    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { success: false, error: "Malformed request format. Valid JSON required." },
        { status: 400 }
      );
    }

    const idToken = trimString(payload.idToken);
    let requestedStudioKey = trimString(payload.studioKey);

    if (!idToken) {
      return NextResponse.json(
        { success: false, error: "Identity exchange token is required." },
        { status: 400 }
      );
    }

    let decodedToken;

    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error("ID token verification failed:", details);
      return NextResponse.json(
        { success: false, error: "Invalid identity token.", details },
        { status: 401 }
      );
    }

    const email = trimString(decodedToken.email).toLowerCase();

    if (!email) {
      return NextResponse.json(
        { success: false, error: "Profile missing valid email claims." },
        { status: 400 }
      );
    }

    const canonicalUserRef = adminDb.collection("users").doc(email);
    let userDoc = await canonicalUserRef.get();
    let userData: DocumentData | null = userDoc.exists
      ? userDoc.data() || null
      : null;

    if (!userData) {
      const userQuery = await adminDb
        .collection("users")
        .where("email", "==", email)
        .limit(1)
        .get();

      if (!userQuery.empty) {
        userDoc = userQuery.docs[0];
        userData = userDoc.data() || null;
      }
    }

    // Owners are allowed to bootstrap the dashboard without a checkout. Reconcile
    // the legacy `licenses` record into the canonical `plugin_licenses` collection
    // so all feature gates (including Blog Engine) see the same entitlement.
    const ownerWorkspace = await ensureOwnerWorkspace(adminDb, {
      email,
      uid: decodedToken.uid,
      userData,
      displayName: trimString(decodedToken.name),
    });
    if (ownerWorkspace) {
      requestedStudioKey = ownerWorkspace.studioKey;
      userData = ownerWorkspace.userData;
    }

    const existingStudioKey = trimString(userData?.studioKey);
    const hasExistingLicense =
      userData?.hasActiveLicense === true && existingStudioKey !== "";

    if (hasExistingLicense) {
      if (
        requestedStudioKey &&
        requestedStudioKey !== existingStudioKey
      ) {
        return NextResponse.json(
          { success: false, error: "StudioKey does not match this operator profile." },
          { status: 403 }
        );
      }
    } else {
      if (!requestedStudioKey) {
        return NextResponse.json(
          { success: false, error: "StudioKey is required to provision this workspace." },
          { status: 400 }
        );
      }

      if (!STUDIO_KEY_PATTERN.test(requestedStudioKey)) {
        return NextResponse.json(
          { success: false, error: "StudioKey format is invalid." },
          { status: 400 }
        );
      }

      const resolvedLicense = await findExactLicense(requestedStudioKey);

      if (!resolvedLicense || resolvedLicense.data.status !== "active") {
        return NextResponse.json(
          { success: false, error: "StudioKey is invalid or inactive." },
          { status: 403 }
        );
      }

      const licenseData = resolvedLicense.data;
      const resolvedLicenseKey = trimString(
        licenseData.studioKey ||
          licenseData.key ||
          licenseData.studiokey ||
          resolvedLicense.documentId
      );
      const authorId = trimString(licenseData.authorId);
      const ownerEmail = trimString(
        licenseData.authorEmail ||
          licenseData.userEmail ||
          licenseData.email ||
          (authorId.includes("@") ? authorId : "")
      ).toLowerCase();

      if (
        resolvedLicenseKey !== requestedStudioKey ||
        !ownerEmail ||
        ownerEmail !== email
      ) {
        return NextResponse.json(
          { success: false, error: "StudioKey ownership does not match this identity." },
          { status: 403 }
        );
      }

      const nowIso = new Date().toISOString();

      userData = {
        ...userData,
        email,
        name: userData?.name || licenseData.authorName || "Sovereign Author",
        hasActiveLicense: true,
        authConfigured: true,
        lastPurchaseDate:
          licenseData.activatedAt || licenseData.createdAt || nowIso,
        createdAt: userData?.createdAt || nowIso,
        studioKey: requestedStudioKey,
        licenseSource: resolvedLicense.source,
        licenseType:
          trimString(licenseData.type || licenseData.licenseType) || null,
        pluginEntitlements: normalizePluginEntitlements(licenseData),
        stripeCustomerId:
          licenseData.stripeCustomerId ||
          licenseData.stripeAccountId ||
          null,
      };

      await canonicalUserRef.set(userData, { merge: true });
    }

    if (!userData) {
      return NextResponse.json(
        { success: false, error: "Operator profile could not be resolved." },
        { status: 403 }
      );
    }

    const accessScope = resolveDashboardAccessScope(email);
    const secureToken = await issueDashboardSession(
      {
        uid: decodedToken.uid,
        email,
        studioKey: trimString(userData.studioKey) || null,
        accessScope,
      },
      resolveDashboardSessionSecret()
    );
    const response = NextResponse.json(
      {
        success: true,
        message: "Identity token verification successful.",
        user: {
          email,
          name: userData.name || "Sovereign Author",
          studioKey: userData.studioKey || null,
          accessScope,
          pluginEntitlements: Array.isArray(userData.pluginEntitlements)
            ? userData.pluginEntitlements
            : [],
        },
      },
      { status: 200 }
    );

    response.cookies.set(DASHBOARD_SESSION_COOKIE, secureToken, {
      path: "/",
      maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    });

    return response;
  } catch (error: unknown) {
    const details = errorMessage(error);
    console.error("Identity exchange processing failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Server rejected identity exchange token verification.",
        details,
      },
      { status: 500 }
    );
  }
}
