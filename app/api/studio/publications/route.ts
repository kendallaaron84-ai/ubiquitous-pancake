import crypto from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import {
  adminDb,
  adminStorage,
  resolveFirebaseStorageBucketName,
} from "@/core/firebase-admin";
import {
  StudioPublicationAccessError,
  assertNoAuthoritativeStudioFields,
  assertTenantBoundStoragePath,
  buildNewStudioPublicationRecord,
  buildStudioManifestPatch,
  buildWorkbenchDraftPatch,
  listOwnedStudioProducts,
  loadOwnedStudioProduct,
  studioProductProjection,
} from "@/core/security/studio-publication-access";
import { requireStudioAuthorContext } from "@/core/security/studio-publication-session";
import { validateStudioAudioFile } from "@/core/studio-media";
import {
  attachProtectedChapterImageUrls,
  protectedChapterImagePaths,
} from "@/core/security/protected-chapter-images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RecordData = Record<string, unknown>;

const ALLOWED_TOP_LEVEL_FIELDS = new Set(["action", "assetId", "payload"]);
const CHAPTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const VIDEO_MIME_PATTERN = /^video\/[A-Za-z0-9.+-]{1,80}$/;
const PAGE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/svg+xml"]);

export async function GET(request: Request) {
  try {
    const context = await requireStudioAuthorContext(adminDb);
    const assetId = new URL(request.url).searchParams.get("assetId")?.trim() || "";
    if (assetId) {
      const publication = await loadOwnedStudioProduct(adminDb, context, assetId);
      return success({ product: await studioProductWithPagePreviews(publication.assetId, publication.product) });
    }
    const publications = await listOwnedStudioProducts(adminDb, context);
    return success({
      products: publications.map(({ id, product }) => studioProductProjection(id, product)),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireStudioAuthorContext(adminDb);
    const body = await readBody(request);
    assertRequestShape(body);
    assertNoAuthoritativeStudioFields(body);
    const action = clean(body.action);
    if (action === "create_publication") {
      const payload = object(body.payload);
      assertNoAuthoritativeStudioFields(payload);
      const type = clean(payload.type).toLowerCase() === "ebook" ? "ebook" : "audiobook";
      const prefix = type === "ebook" ? "ebk" : "abk";
      const assetId = `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
      const timestamp = FieldValue.serverTimestamp();
      const reference = adminDb.collection("products").doc(assetId);
      await reference.create(buildNewStudioPublicationRecord({
        assetId,
        type,
        context,
        timestamp,
      }));
      const created = await reference.get();
      return success({
        assetId,
        product: studioProductProjection(assetId, created.data() || {}),
      }, 201);
    }
    if (action !== "create_upload" && action !== "create_preview") {
      throw invalidRequest("Choose a supported Studio operation.");
    }
    const publication = await loadOwnedStudioProduct(adminDb, context, body.assetId);
    const payload = object(body.payload);
    assertNoAuthoritativeStudioFields(payload);
    if (action === "create_preview") {
      const { bucket } = requireStorageBucket();
      const storagePath = assertTenantBoundStoragePath(
        payload.storagePath,
        publication.assetId,
        context.studioKey
      );
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        throw new StudioPublicationAccessError(
          404,
          "STUDIO_UPLOAD_NOT_FOUND",
          "The uploaded media could not be found."
        );
      }
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 10 * 60 * 1000,
      });
      return success({ preview: { url, storagePath, expiresInSeconds: 600 } });
    }
    let contentType = clean(payload.contentType).toLowerCase();
    const requestedPurpose = clean(payload.purpose);
    const purpose = requestedPurpose === "illustrated_page" || requestedPurpose === "illustration"
      ? requestedPurpose
      : requestedPurpose === "mastered" ? "mastered" : "source";
    const audioValidation = validateStudioAudioFile(payload.fileName, contentType);
    const mediaKind = clean(payload.mediaKind).toLowerCase();
    const expectsImage = purpose === "illustrated_page" || purpose === "illustration";
    const expectsAudio = !expectsImage && mediaKind !== "video";
    if (expectsAudio && audioValidation.valid) contentType = audioValidation.contentType;
    const validType = expectsImage
      ? PAGE_IMAGE_MIME_TYPES.has(contentType)
      : expectsAudio
        ? audioValidation.valid
        : VIDEO_MIME_PATTERN.test(contentType);
    if (!validType) {
      throw invalidRequest(expectsImage
        ? "Choose a JPEG, PNG, GIF, or SVG page image."
        : expectsAudio
          ? "Choose an MP3, M4A, AAC, WAV, FLAC, or OGG audio file."
          : "Choose a supported video file.");
    }
    const fileName = safeFileName(payload.fileName);
    if (!adminStorage) {
      throw new StudioPublicationAccessError(
        503,
        "STUDIO_STORAGE_UNAVAILABLE",
        "Secure media upload is temporarily unavailable."
      );
    }
    const bucketName = resolveFirebaseStorageBucketName();
    const bucket = adminStorage.bucket(bucketName);
    const storagePath = [
      "studio",
      publication.assetId,
      context.studioKey,
      purpose,
      `${crypto.randomUUID()}-${fileName}`,
    ].join("/");
    assertTenantBoundStoragePath(storagePath, publication.assetId, context.studioKey);
    const [uploadUrl] = await bucket.file(storagePath).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 10 * 60 * 1000,
      contentType,
    });
    return success({
      upload: {
        uploadUrl,
        storagePath,
        canonicalUrl: canonicalStorageUrl(bucketName, storagePath),
        contentType,
        expiresInSeconds: 600,
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireStudioAuthorContext(adminDb);
    const body = await readBody(request);
    assertRequestShape(body);
    assertNoAuthoritativeStudioFields(body);
    const publication = await loadOwnedStudioProduct(adminDb, context, body.assetId);
    const payload = object(body.payload);
    assertNoAuthoritativeStudioFields(payload);
    const action = clean(body.action);
    if (action === "save_studio_manifest") {
      const { bucketName, bucket } = requireStorageBucket();
      const patch = buildStudioManifestPatch({
        tracks: payload.tracks,
        mediaType: payload.mediaType,
        currentProduct: publication.product,
        studioKey: context.studioKey,
        assetId: publication.assetId,
        canonicalMediaUrl: (path) => canonicalStorageUrl(bucketName, path),
      });
      await assertUploadedObjectsExist(
        bucket,
        patch.studioTracks.map((track) => clean(track.storagePath)),
        publication.assetId,
        context.studioKey
      );
      await publication.reference.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    } else if (action === "save_workbench_draft") {
      const patch = buildWorkbenchDraftPatch({
        chapters: payload.chapters,
        guardrails: payload.guardrails,
        currentProduct: publication.product,
        layoutMode: payload.layoutMode,
        illustratedPageSettings: payload.illustratedPageSettings,
        studioKey: context.studioKey,
        assetId: publication.assetId,
      });
      const protectedPaths = patch.layoutMode === "illustrated_pages"
        ? patch.chapters.flatMap((chapter) => {
          const pages = Array.isArray((chapter as RecordData).pages)
            ? (chapter as RecordData).pages as RecordData[]
            : [];
          return pages.map((page) => clean(page.assetId));
        })
        : patch.chapters.flatMap((chapter) =>
          protectedChapterImagePaths(clean((chapter as RecordData).textContent))
        );
      if (protectedPaths.length) {
        const { bucket } = requireStorageBucket();
        await assertUploadedObjectsExist(
          bucket,
          protectedPaths,
          publication.assetId,
          context.studioKey
        );
      }
      await publication.reference.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    } else if (action === "attach_mastered_audio") {
      const { bucketName, bucket } = requireStorageBucket();
      const chapterId = clean(payload.chapterId);
      if (!CHAPTER_ID_PATTERN.test(chapterId)) {
        throw invalidRequest("A valid chapter ID is required.");
      }
      const storagePath = assertTenantBoundStoragePath(
        payload.storagePath,
        publication.assetId,
        context.studioKey
      );
      await assertUploadedObjectsExist(
        bucket,
        [storagePath],
        publication.assetId,
        context.studioKey
      );
      await publication.reference.update({
        [`audioMap.${chapterId}`]: canonicalStorageUrl(bucketName, storagePath),
        [`audioStorageMap.${chapterId}`]: storagePath,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      throw invalidRequest("Choose a supported Studio operation.");
    }

    const updated = await publication.reference.get();
    const product = updated.exists ? updated.data() || {} : null;
    if (!product) {
      throw new StudioPublicationAccessError(
        404,
        "STUDIO_PUBLICATION_NOT_FOUND",
        "Publication workspace not found."
      );
    }
    return success({ product: await studioProductWithPagePreviews(updated.id, product) });
  } catch (error) {
    return failure(error);
  }
}

async function studioProductWithPagePreviews(assetId: string, product: RecordData) {
  const projected = studioProductProjection(assetId, product);
  if (!adminStorage) return projected;
  const bucket = adminStorage.bucket(resolveFirebaseStorageBucketName());
  const expires = Date.now() + 10 * 60 * 1000;
  const studioKey = clean(product.studioKey || product.wpStudioKey);
  if (projected.layoutMode !== "illustrated_pages") {
    return {
      ...projected,
      chapters: await Promise.all(projected.chapters.map(async (chapter) => ({
        ...chapter,
        textContent: await attachProtectedChapterImageUrls(
          clean(chapter.textContent),
          (path) => assertTenantBoundStoragePath(path, assetId, studioKey),
          async (path) => {
            const [url] = await bucket.file(path).getSignedUrl({ action: "read", expires });
            return url;
          }
        ),
      }))),
    };
  }
  return {
    ...projected,
    chapters: await Promise.all(projected.chapters.map(async (chapter) => ({
      ...chapter,
      pages: await Promise.all((Array.isArray(chapter.pages) ? chapter.pages : []).map(async (page) => {
        const assetIdValue = clean(page.assetId);
        if (!assetIdValue.startsWith(`studio/${assetId}/`)) return page;
        const [previewUrl] = await bucket.file(assetIdValue).getSignedUrl({ action: "read", expires });
        return { ...page, previewUrl };
      })),
    }))),
  };
}

async function readBody(request: Request): Promise<RecordData> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest("A valid Studio request is required.");
  }
  return body as RecordData;
}

function assertRequestShape(body: RecordData) {
  for (const field of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(field)) {
      throw invalidRequest("The request contains an unsupported field.");
    }
  }
}

async function assertUploadedObjectsExist(
  bucket: ReturnType<NonNullable<typeof adminStorage>["bucket"]>,
  paths: string[],
  assetId: string,
  studioKey: string
) {
  const tenantPaths = [...new Set(paths.filter((path) =>
    path.startsWith(`studio/${assetId}/${studioKey}/`)
  ))];
  const results = await Promise.all(tenantPaths.map(async (path) => {
    assertTenantBoundStoragePath(path, assetId, studioKey);
    const [exists] = await bucket.file(path).exists();
    return exists;
  }));
  if (results.some((exists) => !exists)) {
    throw new StudioPublicationAccessError(
      400,
      "STUDIO_UPLOAD_NOT_FOUND",
      "One or more uploaded media files could not be confirmed."
    );
  }
}

function canonicalStorageUrl(bucketName: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://storage.googleapis.com/${encodeURIComponent(bucketName)}/${encodedPath}`;
}

function requireStorageBucket() {
  if (!adminStorage) {
    throw new StudioPublicationAccessError(
      503,
      "STUDIO_STORAGE_UNAVAILABLE",
      "Secure media storage is temporarily unavailable."
    );
  }
  const bucketName = resolveFirebaseStorageBucketName();
  return { bucketName, bucket: adminStorage.bucket(bucketName) };
}

function safeFileName(value: unknown): string {
  const original = clean(value).split(/[\\/]/).pop() || "media.bin";
  const safe = original.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-180);
  return safe || "media.bin";
}

function invalidRequest(message: string) {
  return new StudioPublicationAccessError(400, "STUDIO_REQUEST_INVALID", message);
}

function object(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function success(payload: RecordData, status = 200) {
  return NextResponse.json(
    { success: true, ...payload },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}

function failure(error: unknown) {
  if (error instanceof StudioPublicationAccessError) {
    return NextResponse.json(
      { success: false, code: error.code, error: error.publicMessage },
      { status: error.status, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  console.error("Studio publication request failed.", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown Studio error",
  });
  return NextResponse.json(
    { success: false, code: "STUDIO_UNAVAILABLE", error: "The Studio is temporarily unavailable." },
    { status: 500, headers: { "Cache-Control": "private, no-store" } }
  );
}
