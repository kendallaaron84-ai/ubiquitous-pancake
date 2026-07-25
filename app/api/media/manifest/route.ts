import { adminDb, adminStorage } from "@/core/firebase-admin";
import { createCorsHeaders } from "@/core/security/cors";
import { signReaderToken, verifyReaderToken } from "@/core/security/reader-token";
import { readerAccessKeyId } from "@/core/security/reader-access";
import { requireAuthorizedAuthorIdentity } from "@/core/security/author-identity";
import { NextResponse } from "next/server";
import { decodeJwt } from "jose";

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
  const values = [
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
  assetKey: string
): Promise<Record<string, unknown>[]> {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  const expectedTranscriptPrefix = `transcripts/${tenantKey}/${assetKey}/`;
  const expectedMediaPrefix = `studio/${assetKey}/`;
  const signedUrlExpiration = Date.now() + 12 * 60 * 60 * 1000;

  return Promise.all(chapters.map(async (chapter) => {
    if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) return {};
    const chapterData = chapter as Record<string, unknown>;
    const {
      transcriptStoragePath: rawTranscriptStoragePath,
      storagePath: rawMediaStoragePath,
      ...publicChapter
    } = chapterData;
    const transcriptStoragePath = cleanString(rawTranscriptStoragePath);
    const mediaStoragePath = cleanString(rawMediaStoragePath);
    const protectedChapter: Record<string, unknown> = { ...publicChapter };

    if (bucketName && mediaStoragePath.startsWith(expectedMediaPrefix)) {
      try {
        const [mediaUrl] = await adminStorage
          .bucket(bucketName)
          .file(mediaStoragePath)
          .getSignedUrl({
            action: "read",
            expires: signedUrlExpiration,
          });
        protectedChapter.url = mediaUrl;
        protectedChapter.audioUrl = mediaUrl;
        protectedChapter.mediaUrl = mediaUrl;
      } catch (error) {
        console.error("Unable to sign a chapter media URL.", {
          assetKey,
          mediaStoragePath,
          error,
        });
      }
    } else if (mediaStoragePath && !mediaStoragePath.startsWith(expectedMediaPrefix)) {
      console.warn("Chapter media pointer is outside the publication namespace.", {
        assetKey,
        mediaStoragePath,
      });
    } else if (mediaStoragePath && !bucketName) {
      console.warn("Chapter media signing is unavailable because the Storage bucket is not configured.", {
        assetKey,
      });
    }

    if (!transcriptStoragePath) return protectedChapter;
    if (!bucketName || !transcriptStoragePath.startsWith(expectedTranscriptPrefix)) {
      console.warn("Transcript pointer is unavailable or outside the publication namespace.", {
        assetKey,
        transcriptStoragePath,
      });
      return protectedChapter;
    }

    try {
      const [transcriptUrl] = await adminStorage
        .bucket(bucketName)
        .file(transcriptStoragePath)
        .getSignedUrl({
          action: "read",
          expires: signedUrlExpiration,
        });
      return { ...protectedChapter, transcriptUrl };
    } catch (error) {
      console.error("Unable to sign a chapter transcript URL.", {
        assetKey,
        transcriptStoragePath,
        error,
      });
      return protectedChapter;
    }
  }));
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
    const isPaid = Number.isFinite(price) && price > 0;

    let renewedReaderSession: Record<string, unknown> | null = null;
    if (isPaid) {
      const authorization = request.headers.get("authorization") || "";
      const readerToken = authorization.startsWith("Bearer ")
        ? authorization.slice(7).trim()
        : "";
      if (!readerToken) {
        return NextResponse.json({ success: false, error: "Verified reader access is required." }, { status: 401, headers });
      }

      let claims;
      try {
        claims = await verifyReaderToken(readerToken);
      } catch {
        return NextResponse.json({ success: false, error: "Reader access has expired or is invalid." }, { status: 401, headers });
      }

      if (claims.tenantId !== tenantKey) {
        return NextResponse.json({ success: false, error: "Reader access does not match this publication." }, { status: 403, headers });
      }

      const identityHashSecret = process.env.KOBA_IDENTITY_HASH_SECRET?.trim();
      if (!identityHashSecret) {
        throw new Error("READER_SECURITY_CONFIGURATION_MISSING");
      }
      const accessKey = readerAccessKeyId(
        identityHashSecret,
        claims.tenantId,
        claims.principalId,
        assetKey
      );
      const accessSnapshot = await adminDb
        .collection("reader_access_keys")
        .doc(accessKey)
        .get();
      const access = accessSnapshot.data() || {};
      if (
        !accessSnapshot.exists ||
        access.status !== "active" ||
        access.tenantId !== tenantKey ||
        access.principalId !== claims.principalId ||
        access.assetKey !== assetKey ||
        typeof access.entitlementId !== "string"
      ) {
        return NextResponse.json(
          {
            success: false,
            code: "ASSET_NOT_OWNED",
            error: "This reader does not own the requested publication.",
          },
          { status: 403, headers }
        );
      }

      const entitlementSnapshot = await adminDb
        .collection("entitlements")
        .doc(access.entitlementId)
        .get();
      const entitlement = entitlementSnapshot.data() || {};
      if (
        !entitlementSnapshot.exists ||
        entitlement.status !== "active" ||
        entitlement.assetKey !== assetKey ||
        (entitlement.tenantKey || entitlement.studioKey) !== tenantKey ||
        entitlement.principalId !== claims.principalId ||
        !entitlement.stripeSessionId
      ) {
        return NextResponse.json(
          {
            success: false,
            code: "ASSET_NOT_OWNED",
            error: "An active purchase entitlement was not found.",
          },
          { status: 403, headers }
        );
      }

      const legacyClaims = decodeJwt(readerToken);
      const legacyLifetimeSeconds =
        typeof legacyClaims.exp === "number" && typeof legacyClaims.iat === "number"
          ? legacyClaims.exp - legacyClaims.iat
          : 0;
      if (legacyLifetimeSeconds > 0 && legacyLifetimeSeconds <= 24 * 60 * 60) {
        const renewedToken = await signReaderToken({
          principalId: claims.principalId,
          tenantId: claims.tenantId,
        });
        const renewedExpiration = decodeJwt(renewedToken).exp;
        renewedReaderSession = {
          readerToken: renewedToken,
          tenantId: claims.tenantId,
          expiresAt: renewedExpiration ? renewedExpiration * 1000 : null,
        };
      }
    }

    const type = cleanString(data.type || data.assetType || data.mediaType).toLowerCase() ||
      (assetKey.startsWith("ebk_") ? "ebook" : "audiobook");
    const chapters = await attachProtectedChapterUrls(
      publicationChapters(data, type),
      tenantKey,
      assetKey
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
        readerSession: renewedReaderSession,
      },
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Unable to load protected media manifest.", error);
    return NextResponse.json({ success: false, error: "Unable to load this publication." }, { status: 500, headers });
  }
}
