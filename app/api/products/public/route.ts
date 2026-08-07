import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import { listNexusWebsiteConnections } from "@/core/nexus/website-connections";
import { requireAuthorizedAuthorIdentity } from "@/core/security/author-identity";
import {
  isSafeStorefrontProduct,
  resolveStorefrontAuthorization,
  safeStorefrontProduct,
  StorefrontAuthorizationError,
  type StorefrontSiteEvidence,
} from "@/core/security/storefront-catalog-authorization";
import { verifyStorefrontSiteToken } from "@/core/security/storefront-site-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = readBearerToken(request.headers.get("authorization"));
    if (!token) return failure(401, "STOREFRONT_SITE_IDENTITY_REQUIRED", "A verified storefront identity is required.");

    let claims;
    try {
      claims = await verifyStorefrontSiteToken(token);
    } catch {
      return failure(401, "STOREFRONT_SITE_IDENTITY_INVALID", "The storefront identity is invalid or expired.");
    }

    const licenseRef = adminDb.collection(claims.licenseCollection).doc(claims.pluginLicenseKey);
    const licenseSnapshot = await licenseRef.get();
    if (!licenseSnapshot.exists) {
      return failure(403, "STOREFRONT_LICENSE_INACTIVE", "This storefront license is unavailable.");
    }
    const license = licenseSnapshot.data() || {};
    const evidence = await loadVerifiedSiteEvidence(claims.pluginLicenseKey, license);
    const authorization = resolveStorefrontAuthorization({
      claims,
      license,
      evidence,
      requestedScope: searchParams.get("scope"),
    });

    const requestedLimit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 100);
    const assetKey = searchParams.get("asset")?.trim() || "";
    const requestedType = searchParams.get("type")?.trim() || "";
    let productDocs: FirebaseFirestore.DocumentSnapshot[] = [];

    if (assetKey) {
      const direct = await adminDb.collection("products").doc(assetKey).get();
      if (direct.exists) productDocs = [direct];
      else if (authorization.scope === "tenant") {
        const fallback = await adminDb.collection("products")
          .where("assetKey", "==", assetKey)
          .where("studioKey", "==", authorization.studioKey)
          .limit(1)
          .get();
        productDocs = fallback.docs;
      }
    } else if (authorization.scope === "global") {
      productDocs = (await adminDb.collection("products").limit(requestedLimit).get()).docs;
    } else {
      productDocs = (await adminDb.collection("products")
        .where("studioKey", "==", authorization.studioKey)
        .limit(requestedLimit)
        .get()).docs;
    }

    const products: Record<string, unknown>[] = [];
    const activeTenantCache = new Map<string, boolean>();
    for (const snapshot of productDocs) {
      const data = snapshot.data();
      if (!data || !isSafeStorefrontProduct(data, authorization, requestedType)) continue;
      const tenantKey = clean(data.studioKey || data.wpStudioKey);
      if (authorization.scope === "global" && !(await tenantIsActive(tenantKey, activeTenantCache))) continue;

      const authorEmail = clean(data.authorEmail || data.authorId).toLowerCase();
      const authorIdentityId = clean(data.authorIdentityId);
      if (!authorEmail || !authorIdentityId) continue;
      try {
        const identity = await requireAuthorizedAuthorIdentity(adminDb, tenantKey, authorEmail, authorIdentityId);
        products.push({ ...safeStorefrontProduct(snapshot.id, data), authorName: identity.displayName });
      } catch {
        continue;
      }
    }

    if (assetKey && products.length === 0) {
      return failure(404, "STOREFRONT_PUBLICATION_NOT_FOUND", "Publication not found.");
    }

    return NextResponse.json({
      success: true,
      mode: assetKey ? "single-publication" : "catalog",
      scope: authorization.scope,
      websiteConnectionId: authorization.websiteConnectionId,
      products,
      books: products,
      content: [],
    }, { status: 200, headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof StorefrontAuthorizationError) {
      return failure(error.status, error.code, error.publicMessage);
    }
    console.error("Storefront catalog request failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown catalog error",
    });
    return failure(503, "STOREFRONT_CATALOG_UNAVAILABLE", "The storefront catalog is temporarily unavailable.");
  }
}

async function loadVerifiedSiteEvidence(studioKey: string, license: Record<string, unknown>): Promise<StorefrontSiteEvidence[]> {
  const authorIds = [license.authorId, license.authorEmail, license.email, license.ownerEmail]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const evidence = new Map<string, StorefrontSiteEvidence>();
  for (const authorId of new Set(authorIds.map((value) => value.trim()))) {
    for (const connection of await listNexusWebsiteConnections(adminDb, studioKey, authorId)) {
      evidence.set(connection.websiteConnectionId, {
        websiteConnectionId: connection.websiteConnectionId,
        origin: connection.wordpressOrigin,
        role: connection.contentRole,
        status: connection.status,
        verificationStatus: connection.status === "active" ? "verified" : "unverified",
      });
    }
  }
  return [...evidence.values()];
}

async function tenantIsActive(studioKey: string, cache: Map<string, boolean>): Promise<boolean> {
  if (cache.has(studioKey)) return cache.get(studioKey) === true;
  const snapshot = await adminDb.collection("plugin_licenses").doc(studioKey).get();
  const active = snapshot.exists && snapshot.data()?.status === "active";
  cache.set(studioKey, active);
  return active;
}

function readBearerToken(header: string | null): string {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || "";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function failure(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status, headers: CORS_HEADERS });
}
