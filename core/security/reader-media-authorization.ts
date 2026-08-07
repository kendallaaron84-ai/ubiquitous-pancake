import {
  serverTimestamp,
  type ReaderPlatformDb,
} from "./services/service-support.ts";
import { requireActiveVerifiedReader } from "./services/reader-profile-service.ts";

const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;

export const READER_MEDIA_ERROR_CODES = {
  requestInvalid: "READER_MEDIA_REQUEST_INVALID",
  assetInvalid: "READER_MEDIA_ASSET_INVALID",
  tenantInvalid: "READER_MEDIA_TENANT_INVALID",
  publicationNotFound: "READER_MEDIA_PUBLICATION_NOT_FOUND",
  publicationUnavailable: "READER_MEDIA_PUBLICATION_UNAVAILABLE",
  publicationNotDeployed: "READER_MEDIA_PUBLICATION_NOT_DEPLOYED",
  tenantMismatch: "READER_MEDIA_TENANT_MISMATCH",
  entitlementRequired: "READER_MEDIA_ENTITLEMENT_REQUIRED",
  originNotAllowed: "READER_MEDIA_ORIGIN_NOT_ALLOWED",
  manifestUnavailable: "READER_MEDIA_MANIFEST_UNAVAILABLE",
} as const;

type ReaderMediaErrorCode =
  (typeof READER_MEDIA_ERROR_CODES)[keyof typeof READER_MEDIA_ERROR_CODES];

export class ReaderMediaAuthorizationError extends Error {
  readonly status: 400 | 403 | 404 | 503;
  readonly code: ReaderMediaErrorCode;

  constructor(
    status: ReaderMediaAuthorizationError["status"],
    code: ReaderMediaErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ReaderMediaAuthorizationError";
    this.status = status;
    this.code = code;
  }
}

export interface AuthorizedReaderMedia {
  readerUid: string;
  tenantId: string;
  assetId: string;
  entitlementId: string;
  product: Record<string, unknown>;
  publicationUrl: string | null;
  allowedOrigins: readonly string[];
}

function text(value: unknown, maximum = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function exactHttpsOrigin(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function exactHttpsUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function publicationEvidence(product: Record<string, unknown>) {
  const deployment =
    product.wordpressDeployment &&
    typeof product.wordpressDeployment === "object" &&
    !Array.isArray(product.wordpressDeployment)
      ? (product.wordpressDeployment as Record<string, unknown>)
      : {};
  const status = text(product.status, 40).toLowerCase();
  const isPublished =
    product.isPublished === true || ["active", "publish", "published"].includes(status);
  const publicationUrl = exactHttpsUrl(
    deployment.publicationUrl || product.publicationUrl || product.wordpressUrl
  );
  const origins = new Set<string>();
  for (const value of [
    deployment.targetWpOrigin,
    product.targetWpOrigin,
    product.associatedWebsite,
    publicationUrl,
  ]) {
    const origin = exactHttpsOrigin(value);
    if (origin) origins.add(origin);
  }
  return {
    deploymentStatus: text(deployment.status, 40).toLowerCase(),
    isPublished,
    publicationUrl,
    origins: [...origins],
  };
}

export async function authorizeReaderMedia(
  db: ReaderPlatformDb,
  input: {
    readerUid: string;
    tenantId: string;
    assetId: string;
    requestOrigin?: string | null;
  }
): Promise<AuthorizedReaderMedia> {
  const readerUid = text(input.readerUid, 200);
  const tenantId = text(input.tenantId, 160);
  const assetId = text(input.assetId, 160);
  if (!readerUid) {
    throw new ReaderMediaAuthorizationError(
      400,
      READER_MEDIA_ERROR_CODES.requestInvalid,
      "A verified reader identity is required."
    );
  }
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new ReaderMediaAuthorizationError(
      400,
      READER_MEDIA_ERROR_CODES.assetInvalid,
      "A valid publication asset is required."
    );
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new ReaderMediaAuthorizationError(
      400,
      READER_MEDIA_ERROR_CODES.tenantInvalid,
      "A valid publication tenant is required."
    );
  }

  await requireActiveVerifiedReader(db, readerUid);
  const productReference = db.collection("products").doc(assetId);
  const entitlementQuery = db
    .collection("reader_entitlements")
    .where("readerUid", "==", readerUid)
    .where("tenantId", "==", tenantId)
    .where("assetId", "==", assetId)
    .where("status", "==", "active")
    .limit(1);

  return db.runTransaction(async (transaction) => {
    const [productSnapshot, entitlementSnapshot] = await Promise.all([
      transaction.get(productReference),
      transaction.get(entitlementQuery),
    ]);
    if (!productSnapshot.exists) {
      throw new ReaderMediaAuthorizationError(
        404,
        READER_MEDIA_ERROR_CODES.publicationNotFound,
        "The requested publication was not found."
      );
    }
    const product = (productSnapshot.data() || {}) as Record<string, unknown>;
    const storedTenant = text(product.studioKey || product.wpStudioKey, 160);
    if (!storedTenant || storedTenant !== tenantId) {
      throw new ReaderMediaAuthorizationError(
        403,
        READER_MEDIA_ERROR_CODES.tenantMismatch,
        "The publication does not belong to the requested author library."
      );
    }
    const evidence = publicationEvidence(product);
    if (!evidence.isPublished || product.disabled === true || product.isDisabled === true) {
      throw new ReaderMediaAuthorizationError(
        404,
        READER_MEDIA_ERROR_CODES.publicationUnavailable,
        "This publication is not available."
      );
    }
    if (evidence.deploymentStatus !== "deployed" || !evidence.publicationUrl) {
      throw new ReaderMediaAuthorizationError(
        403,
        READER_MEDIA_ERROR_CODES.publicationNotDeployed,
        "This publication is not deployed for reader access."
      );
    }
    const requestedOrigin = input.requestOrigin
      ? exactHttpsOrigin(input.requestOrigin)
      : null;
    if (input.requestOrigin && (!requestedOrigin || !evidence.origins.includes(requestedOrigin))) {
      throw new ReaderMediaAuthorizationError(
        403,
        READER_MEDIA_ERROR_CODES.originNotAllowed,
        "This website is not authorized to request the publication."
      );
    }
    if (entitlementSnapshot.empty) {
      throw new ReaderMediaAuthorizationError(
        403,
        READER_MEDIA_ERROR_CODES.entitlementRequired,
        "An active reader entitlement is required for this publication."
      );
    }
    const entitlementDocument = entitlementSnapshot.docs[0];
    transaction.update(entitlementDocument.ref, {
      lastValidatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return {
      readerUid,
      tenantId,
      assetId,
      entitlementId: entitlementDocument.id,
      product,
      publicationUrl: evidence.publicationUrl,
      allowedOrigins: evidence.origins,
    };
  });
}

export function publicationMediaChapters(
  product: Record<string, unknown>,
  publicationType: string
): unknown[] {
  const ebookPayload =
    product.ebookPayload && typeof product.ebookPayload === "object"
      ? (product.ebookPayload as Record<string, unknown>)
      : {};
  const ebookChapters = Array.isArray(ebookPayload.chapters)
    ? ebookPayload.chapters
    : [];
  const chapters = Array.isArray(product.chapters) ? product.chapters : [];
  const tracks = Array.isArray(product.studioTracks) ? product.studioTracks : [];
  if (publicationType === "ebook") return ebookChapters.length ? ebookChapters : chapters;
  return tracks.length ? tracks : chapters;
}

export async function buildProtectedPublicationChapters(input: {
  chapters: unknown[];
  tenantId: string;
  assetId: string;
  publicationType: string;
  signStoragePath(path: string): Promise<string>;
}): Promise<Record<string, unknown>[]> {
  const mediaPrefix = `studio/${input.assetId}/`;
  const transcriptPrefix = `transcripts/${input.tenantId}/${input.assetId}/`;

  return Promise.all(
    input.chapters.map(async (chapter) => {
      if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) return {};
      const chapterData = chapter as Record<string, unknown>;
      const {
        storagePath: rawMediaStoragePath,
        transcriptStoragePath: rawTranscriptStoragePath,
        url: _rawUrl,
        audioUrl: _rawAudioUrl,
        mediaUrl: _rawMediaUrl,
        src: _rawSourceUrl,
        transcriptUrl: _rawTranscriptUrl,
        ...safeChapter
      } = chapterData;
      const mediaStoragePath = text(rawMediaStoragePath);
      const transcriptStoragePath = text(rawTranscriptStoragePath);

      if (input.publicationType !== "ebook") {
        if (!mediaStoragePath || !mediaStoragePath.startsWith(mediaPrefix)) {
          throw new ReaderMediaAuthorizationError(
            503,
            READER_MEDIA_ERROR_CODES.manifestUnavailable,
            "This publication has not been migrated to protected media storage."
          );
        }
        let mediaUrl: string;
        try {
          mediaUrl = await input.signStoragePath(mediaStoragePath);
        } catch {
          throw new ReaderMediaAuthorizationError(
            503,
            READER_MEDIA_ERROR_CODES.manifestUnavailable,
            "Protected media is temporarily unavailable."
          );
        }
        safeChapter.url = mediaUrl;
        safeChapter.audioUrl = mediaUrl;
        safeChapter.mediaUrl = mediaUrl;
      }

      if (
        transcriptStoragePath &&
        transcriptStoragePath.startsWith(transcriptPrefix)
      ) {
        try {
          safeChapter.transcriptUrl = await input.signStoragePath(
            transcriptStoragePath
          );
        } catch {
          // Transcript failure does not expose its raw pointer or weaken media
          // authorization. The playable chapter may still be returned.
        }
      }
      return safeChapter;
    })
  );
}
