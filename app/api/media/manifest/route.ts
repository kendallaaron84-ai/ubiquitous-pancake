import { adminDb, adminStorage } from "@/core/firebase-admin";
import { createCorsHeaders } from "@/core/security/cors";
import { verifyReaderToken } from "@/core/security/reader-token";
import { requireAuthorizedAuthorIdentity } from "@/core/security/author-identity";
import {
  authorizeAnonymousFreeMedia,
  authorizeReaderMedia,
  buildProtectedPublicationChapters,
  ReaderMediaAuthorizationError,
} from "@/core/security/reader-media-authorization";
import {
  requireCanonicalReaderMediaPrincipal,
  UnsupportedReaderMediaPrincipalError,
} from "@/core/security/reader-media-principal";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ASSET_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,159}$/i;
function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWebOrigin(value: unknown): string | null {
  const candidate = cleanString(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function responseHeaders(origin: string | null): Record<string, string> {
  const normalizedOrigin = normalizeWebOrigin(origin);
  return {
    ...createCorsHeaders(origin, normalizedOrigin ? [normalizedOrigin] : [], {
      methods: ["GET", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAgeSeconds: 600,
    }),
    "Cache-Control": "private, no-store, max-age=0",
  };
}

function registeredPublicationOrigins(
  product: Record<string, unknown>,
  license: Record<string, unknown>
): Set<string> {
  const deployment =
    product.wordpressDeployment &&
    typeof product.wordpressDeployment === "object" &&
    !Array.isArray(product.wordpressDeployment)
      ? (product.wordpressDeployment as Record<string, unknown>)
      : {};
  const values = [
    deployment.targetWpOrigin,
    deployment.publicationUrl,
    product.associatedWebsite,
    product.targetWpOrigin,
    product.wordpressUrl,
    product.website,
    license.associatedWebsite,
    license.targetWpOrigin,
    license.wordpressUrl,
    license.website,
  ];

  return new Set(
    values
      .map(normalizeWebOrigin)
      .filter((value): value is string => Boolean(value))
  );
}

function publicationChapters(data: Record<string, unknown>, type: string): unknown[] {
  const ebookPayload = data.ebookPayload && typeof data.ebookPayload === "object"
    ? data.ebookPayload as Record<string, unknown>
    : {};
  const ebookChapters = Array.isArray(ebookPayload.chapters) ? ebookPayload.chapters : [];
  const topLevelChapters = Array.isArray(data.chapters) ? data.chapters : [];
  const studioTracks = Array.isArray(data.studioTracks) ? data.studioTracks : [];
  if (type === "ebook") return ebookChapters.length ? ebookChapters : topLevelChapters;
  return studioTracks.length ? studioTracks : topLevelChapters;
}

async function attachProtectedChapterUrls(
  chapters: unknown[],
  tenantKey: string,
  assetKey: string,
  publicationType: string
): Promise<Record<string, unknown>[]> {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  const signedUrlExpiration = Date.now() + 60 * 60 * 1000;
  return buildProtectedPublicationChapters({
    chapters,
    tenantId: tenantKey,
    assetId: assetKey,
    publicationType,
    signStoragePath: async (storagePath) => {
      if (!bucketName) throw new Error("MEDIA_STORAGE_NOT_CONFIGURED");
      const [url] = await adminStorage
        .bucket(bucketName)
        .file(storagePath)
        .getSignedUrl({ action: "read", expires: signedUrlExpiration });
      return url;
    },
  });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  const headers = responseHeaders(origin);
  if (origin && !normalizeWebOrigin(origin)) {
    return NextResponse.json({ success: false, error: "Origin is not allowed." }, { status: 403, headers });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const headers = responseHeaders(origin);
  if (origin && !normalizeWebOrigin(origin)) {
    return NextResponse.json({ success: false, error: "Origin is not allowed." }, { status: 403, headers });
  }

  const assetKey = new URL(request.url).searchParams.get("asset")?.trim() || "";
  if (!ASSET_KEY_PATTERN.test(assetKey)) {
    return NextResponse.json({ success: false, error: "A valid asset is required." }, { status: 400, headers });
  }

  try {
    const productSnapshot = await adminDb.collection("products").doc(assetKey).get();
    if (!productSnapshot.exists) {
      return NextResponse.json({ success: false, error: "Publication not found." }, { status: 404, headers });
    }

    const data = (productSnapshot.data() || {}) as Record<string, unknown>;
    const status = cleanString(data.status).toLowerCase();
    const isPublished = data.isPublished === true || ["active", "publish", "published"].includes(status);
    if (!isPublished) {
      return NextResponse.json({ success: false, error: "Publication is unavailable." }, { status: 404, headers });
    }

    const tenantKey = cleanString(data.studioKey) || cleanString(data.wpStudioKey);
    const authorEmail = cleanString(data.authorEmail || data.authorId).toLowerCase();
    const authorIdentityId = cleanString(data.authorIdentityId);
    if (!tenantKey || !authorEmail) {
      return NextResponse.json(
        { success: false, error: "This publication is not linked to an author workspace." },
        { status: 403, headers }
      );
    }
    const activeLicense = await adminDb.collection("plugin_licenses").doc(tenantKey).get();
    const licenseData = (activeLicense.data() || {}) as Record<string, unknown>;
    const normalizedRequestOrigin = normalizeWebOrigin(origin);
    if (
      normalizedRequestOrigin &&
      !registeredPublicationOrigins(data, licenseData).has(normalizedRequestOrigin)
    ) {
      return NextResponse.json(
        { success: false, error: "This publication is not registered to the requesting website." },
        { status: 403, headers }
      );
    }

    let verifiedAuthorName = cleanString(data.authorName) || "Sovereign Author";
    if (authorIdentityId) {
      const authorIdentity = await requireAuthorizedAuthorIdentity(
        adminDb,
        tenantKey,
        authorEmail,
        authorIdentityId
      );
      verifiedAuthorName = authorIdentity.displayName;
    } else {
      if (activeLicense.exists && activeLicense.data()?.status === "active") {
        return NextResponse.json(
          { success: false, error: "This publication must be assigned to a registered author name." },
          { status: 403, headers }
        );
      }
      console.warn("Serving a legacy publication without an identity registry link.", { assetKey, tenantKey });
    }
    const price = Number(data.price ?? data.unitPrice ?? 0);
    const authorization = request.headers.get("authorization") || "";
    const readerToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";
    if (!readerToken) {
      return NextResponse.json(
        {
          success: false,
          code: "READER_SESSION_INVALID",
          error: "Verified reader access is required.",
        },
        { status: 401, headers }
      );
    }

    let claims;
    try {
      claims = await verifyReaderToken(readerToken);
    } catch {
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_READER_MEDIA_TOKEN",
          error: "Reader access has expired or is invalid.",
        },
        { status: 401, headers }
      );
    }

    try {
      requireCanonicalReaderMediaPrincipal(claims);
    } catch (error: unknown) {
      if (error instanceof UnsupportedReaderMediaPrincipalError) {
        return NextResponse.json(
          { success: false, code: error.code, error: error.message },
          { status: error.status, headers }
        );
      }
      throw error;
    }

    if (claims.tenantId !== tenantKey) {
      return NextResponse.json(
        {
          success: false,
          code: "READER_MEDIA_TENANT_MISMATCH",
          error: "Reader access does not match this publication.",
        },
        { status: 403, headers }
      );
    }

    if (claims.principalType === "anonymous_free") {
      if (
        claims.assetId !== assetKey ||
        !normalizedRequestOrigin ||
        claims.origin !== normalizedRequestOrigin
      ) {
        return NextResponse.json(
          {
            success: false,
            code: "READER_MEDIA_FREE_SCOPE_MISMATCH",
            error: "Free-publication access does not match this asset or website.",
          },
          { status: 403, headers }
        );
      }
      try {
        const authorized = await authorizeAnonymousFreeMedia(adminDb, {
          assetId: assetKey,
          requestOrigin: normalizedRequestOrigin,
        });
        if (authorized.tenantId !== claims.tenantId) {
          throw new ReaderMediaAuthorizationError(
            403,
            "READER_MEDIA_TENANT_MISMATCH",
            "Reader access does not match this publication."
          );
        }
      } catch (error: unknown) {
        if (error instanceof ReaderMediaAuthorizationError) {
          return NextResponse.json(
            { success: false, code: error.code, error: error.message },
            { status: error.status, headers }
          );
        }
        throw error;
      }
    } else if (claims.principalType === "firebase_uid") {
      try {
        await authorizeReaderMedia(adminDb, {
          readerUid: claims.principalId,
          tenantId: claims.tenantId,
          assetId: assetKey,
          requestOrigin: origin,
        });
      } catch (error: unknown) {
        if (error instanceof ReaderMediaAuthorizationError) {
          return NextResponse.json(
            { success: false, code: error.code, error: error.message },
            { status: error.status, headers }
          );
        }
        throw error;
      }
    }

    const type = cleanString(data.type || data.assetType || data.mediaType).toLowerCase() ||
      (assetKey.startsWith("ebk_") ? "ebook" : "audiobook");
    const chapters = await attachProtectedChapterUrls(
      publicationChapters(data, type),
      tenantKey,
      assetKey,
      type
    );
    const product = {
      assetKey,
      assetId: assetKey,
      type,
      mediaType: type === "ebook" ? "ebook" : "Audiobook",
      title: cleanString(data.title) || "Untitled",
      description: cleanString(data.description || data.synopsis),
      coverUrl: cleanString(data.coverArtUrl || data.coverUrl),
      coverArtUrl: cleanString(data.coverArtUrl || data.coverUrl),
      bgImageUrl: cleanString(data.bgImageUrl || data.backgroundUrl),
      bgImage: cleanString(data.bgImageUrl || data.backgroundUrl),
      authorName: verifiedAuthorName,
      price: Number.isFinite(price) ? price : 0,
      chapters,
    };

    return NextResponse.json(
      {
        success: true,
        mode: "authorized-publication",
        products: [product],
        books: [product],
      },
      { status: 200, headers }
    );
  } catch (error) {
    if (error instanceof ReaderMediaAuthorizationError) {
      return NextResponse.json(
        { success: false, code: error.code, error: error.message },
        { status: error.status, headers }
      );
    }
    console.error("Unable to load protected media manifest.", error);
    return NextResponse.json({ success: false, error: "Unable to load this publication." }, { status: 500, headers });
  }
}
