const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;
const MAX_CHAPTERS = 500;
const MAX_TITLE_LENGTH = 240;
const MAX_TEXT_LENGTH = 500_000;
const MAX_ILLUSTRATED_PAGES = 2_000;

type RecordData = Record<string, unknown>;

export interface StudioSessionIdentity {
  uid: string;
  email: string;
  studioKey: string | null;
  accessScope: string;
}

export interface StudioAuthorContext {
  session: StudioSessionIdentity;
  studioKey: string;
  authorEmail: string;
}

export class StudioPublicationAccessError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;

  constructor(
    status: number,
    code: string,
    publicMessage: string
  ) {
    super(publicMessage);
    this.name = "StudioPublicationAccessError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function assertValidStudioAssetId(value: unknown): string {
  const assetId = clean(value);
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new StudioPublicationAccessError(
      400,
      "STUDIO_ASSET_ID_INVALID",
      "A valid publication asset ID is required."
    );
  }
  return assetId;
}

export function assertActiveStudioLicense(
  session: StudioSessionIdentity,
  licenseDocumentId: unknown,
  license: RecordData | null | undefined
): StudioAuthorContext {
  const studioKey = clean(session.studioKey);
  const authorEmail = clean(session.email).toLowerCase();
  if (!studioKey || !authorEmail) {
    throw new StudioPublicationAccessError(
      403,
      "STUDIO_WORKSPACE_REQUIRED",
      "Your dashboard session is not connected to an author workspace."
    );
  }
  if (!license || clean(license.status).toLowerCase() !== "active") {
    throw new StudioPublicationAccessError(
      403,
      "STUDIO_LICENSE_INACTIVE",
      "Your active author license was not found."
    );
  }
  const licenseEmail = clean(
    license.authorEmail || license.userEmail || license.email || license.authorId
  ).toLowerCase();
  if (clean(licenseDocumentId) !== studioKey || licenseEmail !== authorEmail) {
    throw new StudioPublicationAccessError(
      403,
      "STUDIO_LICENSE_OWNERSHIP_MISMATCH",
      "This author workspace belongs to another account."
    );
  }
  return { session, studioKey, authorEmail };
}

export function assertOwnedStudioProduct(
  context: StudioAuthorContext,
  product: RecordData | null | undefined
): RecordData {
  if (!product) {
    throw publicationNotFound();
  }
  const productStudioKey = clean(product.studioKey || product.wpStudioKey);
  const productAuthor = clean(product.authorEmail || product.authorId).toLowerCase();
  if (
    productStudioKey !== context.studioKey ||
    productAuthor !== context.authorEmail
  ) {
    throw publicationNotFound();
  }
  return product;
}

export async function loadOwnedStudioProduct(
  database: FirebaseFirestore.Firestore,
  context: StudioAuthorContext,
  assetIdValue: unknown
) {
  const assetId = assertValidStudioAssetId(assetIdValue);
  const reference = database.collection("products").doc(assetId);
  const snapshot = await reference.get();
  const product = assertOwnedStudioProduct(
    context,
    snapshot.exists ? snapshot.data() : null
  );
  return { assetId, reference, product };
}

export async function listOwnedStudioProducts(
  database: FirebaseFirestore.Firestore,
  context: StudioAuthorContext
): Promise<Array<{ id: string; product: RecordData }>> {
  const [canonical, legacy] = await Promise.all([
    database.collection("products").where("studioKey", "==", context.studioKey).get(),
    database.collection("products").where("wpStudioKey", "==", context.studioKey).get(),
  ]);
  const found = new Map<string, RecordData>();
  for (const snapshot of [canonical, legacy]) {
    for (const document of snapshot.docs) {
      const product = document.data() || {};
      try {
        assertOwnedStudioProduct(context, product);
        found.set(document.id, product);
      } catch {
        // The StudioKey query is necessary but not sufficient. Author ownership
        // is checked again before any record is returned.
      }
    }
  }
  return [...found.entries()].map(([id, product]) => ({ id, product }));
}

export function studioProductProjection(id: string, product: RecordData) {
  const layoutMode = clean(product.layoutMode) === "illustrated_pages"
    ? "illustrated_pages"
    : "reflowable";
  return {
    id,
    assetKey: clean(product.assetKey) || id,
    title: clean(product.title) || "Untitled Publication",
    synopsis: clean(product.synopsis || product.description),
    type: clean(product.type) || "audiobook",
    category: clean(product.category),
    status: clean(product.status),
    coverUrl: clean(product.coverUrl || product.coverArtUrl),
    coverArtUrl: clean(product.coverArtUrl || product.coverUrl),
    mediaType: clean(product.mediaType),
    vaultStatus: clean(product.vaultStatus) || "unprotected",
    studioTracks: stripSensitiveKeys(recordArray(product.studioTracks)),
    chapters: stripSensitiveKeys(recordArray(product.chapters)),
    chapterCount: finiteNumber(product.chapterCount),
    trackCount: finiteNumber(product.trackCount),
    ebookPayload: stripSensitiveKeys(safeObject(product.ebookPayload)),
    layoutMode,
    illustratedPageSettings: sanitizeIllustratedPageSettings(product.illustratedPageSettings),
    guardrails: stripSensitiveKeys(safeObject(product.guardrails)),
    audioMap: stripSensitiveKeys(safeObject(product.audioMap)),
    transcriptionStatus: clean(product.transcriptionStatus) || "not_started",
    transcriptionError: clean(product.transcriptionError),
  };
}

export function buildStudioManifestPatch(input: {
  tracks: unknown;
  mediaType: unknown;
  currentProduct: RecordData;
  studioKey: string;
  assetId: string;
  canonicalMediaUrl(path: string): string;
}) {
  const mediaType = clean(input.mediaType).toLowerCase();
  if (mediaType !== "audio" && mediaType !== "video") {
    throw invalidPayload("Choose audio or video mode.");
  }
  const tracks = sanitizeStudioTracks(input);
  const playableTrackCount = tracks.filter((track) => clean(track.storagePath || track.url)).length;
  return {
    studioTracks: tracks,
    chapters: tracks,
    chapterCount: playableTrackCount,
    trackCount: playableTrackCount,
    mediaType,
  };
}

export function buildWorkbenchDraftPatch(input: {
  chapters: unknown;
  guardrails: unknown;
  currentProduct?: RecordData;
  layoutMode?: unknown;
  illustratedPageSettings?: unknown;
  studioKey?: string;
  assetId?: string;
}) {
  const layoutMode = clean(input.layoutMode) === "illustrated_pages"
    ? "illustrated_pages"
    : "reflowable";
  const chapters = layoutMode === "illustrated_pages"
    ? sanitizeIllustratedChapters(input.chapters, clean(input.assetId), clean(input.studioKey))
    : sanitizeChapters(input.chapters);
  const guardrailsSource = safeObject(input.guardrails);
  const guardrails = {
    setting: boundedText(guardrailsSource.setting, 2_000),
    mood: boundedText(guardrailsSource.mood, 2_000),
    loreContext: boundedText(guardrailsSource.loreContext, 20_000),
  };
  return {
    type: "ebook",
    layoutMode,
    illustratedPageSettings: layoutMode === "illustrated_pages"
      ? sanitizeIllustratedPageSettings(input.illustratedPageSettings)
      : {},
    chapters,
    ebookPayload: {
      fontPreference:
        clean(safeObject(input.currentProduct?.ebookPayload).fontPreference) ||
        "Atkinson Hyperlegible",
      chapters,
    },
    guardrails,
  };
}

function sanitizeIllustratedPageSettings(value: unknown) {
  const settings = safeObject(value);
  const spreadStart = clean(settings.spreadStart).toLowerCase();
  return {
    spreadStart: spreadStart === "left" ? "left" : "right",
    allowSpreads: settings.allowSpreads !== false,
    pageBackground: /^#[0-9a-f]{6}$/i.test(clean(settings.pageBackground))
      ? clean(settings.pageBackground)
      : "#111111",
  };
}

function sanitizeIllustratedChapters(value: unknown, assetId: string, studioKey: string) {
  if (!assetId || !studioKey || !Array.isArray(value) || value.length === 0 || value.length > MAX_CHAPTERS) {
    throw invalidPayload("The illustrated book must contain between 1 and 500 chapters.");
  }
  let pageCount = 0;
  return value.map((raw, chapterIndex) => {
    const chapter = safeObject(raw);
    const pages = recordArray(chapter.pages).map((rawPage, pageIndex) => {
      pageCount += 1;
      if (pageCount > MAX_ILLUSTRATED_PAGES) throw invalidPayload("The illustrated book contains too many pages.");
      const width = positiveInteger(rawPage.width);
      const height = positiveInteger(rawPage.height);
      if (!width || !height) throw invalidPayload("Every illustrated page requires intrinsic width and height.");
      const assetIdentity = assertTenantBoundStoragePath(
        rawPage.assetId || rawPage.storagePath,
        assetId,
        studioKey
      );
      const facing = clean(rawPage.facingIntent).toLowerCase();
      return {
        id: clean(rawPage.id) || `page_${chapterIndex + 1}_${pageIndex + 1}`,
        assetId: assetIdentity,
        width,
        height,
        aspectRatio: width / height,
        facingIntent: facing === "left" || facing === "right" ? facing : "auto",
        fileName: boundedText(rawPage.fileName, 260),
        mimeType: boundedText(rawPage.mimeType, 120),
      };
    });
    return {
      id: clean(chapter.id) || `chapter_${chapterIndex + 1}`,
      title: boundedText(chapter.title, MAX_TITLE_LENGTH) || `Chapter ${chapterIndex + 1}`,
      pages,
    };
  });
}

export function assertTenantBoundStoragePath(
  pathValue: unknown,
  assetId: string,
  studioKey: string
): string {
  const path = clean(pathValue).replace(/^\/+/, "");
  const prefix = `studio/${assetId}/${studioKey}/`;
  if (!path.startsWith(prefix) || path.includes("..") || path.includes("\\")) {
    throw new StudioPublicationAccessError(
      400,
      "STUDIO_UPLOAD_PATH_INVALID",
      "The uploaded media path is not authorized for this workspace."
    );
  }
  return path;
}

export function assertNoAuthoritativeStudioFields(body: RecordData) {
  const forbidden = [
    "id",
    "assetKey",
    "studioKey",
    "wpStudioKey",
    "tenant",
    "tenantId",
    "author",
    "authorId",
    "authorEmail",
    "owner",
    "ownership",
    "apiKeys",
  ];
  for (const field of forbidden) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw new StudioPublicationAccessError(
        400,
        "STUDIO_AUTHORITATIVE_FIELD_REJECTED",
        "The request contains a server-owned publication field."
      );
    }
  }
}

function sanitizeStudioTracks(input: {
  tracks: unknown;
  currentProduct: RecordData;
  studioKey: string;
  assetId: string;
  canonicalMediaUrl(path: string): string;
}) {
  if (!Array.isArray(input.tracks) || input.tracks.length > MAX_CHAPTERS) {
    throw invalidPayload("The chapter manifest is invalid or too large.");
  }
  const existingTracks = recordArray(input.currentProduct.studioTracks);
  const existingById = new Map(existingTracks.map((track) => [clean(track.id), track]));
  return input.tracks.map((value, index) => {
    const track = safeObject(value);
    const id = clean(track.id) || `track_${index + 1}`;
    const existing = existingById.get(id);
    const incomingPath = clean(track.storagePath);
    let storagePath = "";
    let url = "";
    if (incomingPath) {
      const existingPath = clean(existing?.storagePath);
      if (existingPath && incomingPath === existingPath && incomingPath.startsWith(`studio/${input.assetId}/`)) {
        storagePath = incomingPath;
        url = clean(existing?.url || existing?.audioUrl || existing?.mediaUrl);
      } else {
        storagePath = assertTenantBoundStoragePath(incomingPath, input.assetId, input.studioKey);
        url = input.canonicalMediaUrl(storagePath);
      }
    } else if (existing) {
      storagePath = clean(existing.storagePath);
      url = clean(existing.url || existing.audioUrl || existing.mediaUrl);
    }
    return {
      id,
      chapterNumber: index + 1,
      title: boundedText(track.title, MAX_TITLE_LENGTH) || `Chapter ${index + 1}`,
      fileName: boundedText(track.fileName, 260),
      uploadStatus: storagePath || url ? "success" : "empty",
      isTranscribed: track.isTranscribed === true,
      transcriptStoragePath: clean(existing?.transcriptStoragePath),
      durationSeconds: positiveNumber(track.durationSeconds || track.duration),
      mimeType: boundedText(track.mimeType, 120),
      storagePath,
      url,
    };
  });
}

function sanitizeChapters(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHAPTERS) {
    throw invalidPayload("The e-book must contain between 1 and 500 chapters.");
  }
  return value.map((raw, index) => {
    const chapter = safeObject(raw);
    return {
      id: clean(chapter.id) || `chapter_${index + 1}`,
      title: boundedText(chapter.title, MAX_TITLE_LENGTH) || `Chapter ${index + 1}`,
      textContent: boundedText(chapter.textContent || chapter.content, MAX_TEXT_LENGTH),
    };
  });
}

function publicationNotFound() {
  return new StudioPublicationAccessError(
    404,
    "STUDIO_PUBLICATION_NOT_FOUND",
    "Publication workspace not found."
  );
}

function invalidPayload(message: string) {
  return new StudioPublicationAccessError(400, "STUDIO_PAYLOAD_INVALID", message);
}

function boundedText(value: unknown, maximum: number): string {
  const text = clean(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (text.length > maximum) throw invalidPayload("Publication text exceeds the allowed size.");
  return text;
}

function safeObject(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function recordArray(value: unknown): RecordData[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is RecordData => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : 0;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripSensitiveKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripSensitiveKeys(entry)) as T;
  }
  if (!value || typeof value !== "object") return value;
  const safe: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/^(apiKeys?|secretCredentialRef|privateKey|accessToken|refreshToken)$/i.test(key)) {
      continue;
    }
    safe[key] = stripSensitiveKeys(nested);
  }
  return safe as T;
}
