const MAX_PATH_LENGTH = 2_000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_PATH_LENGTH) : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export class PublicationAssetIntegrityError extends Error {
  readonly status = 409;
  readonly code = "PUBLICATION_ASSETS_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "PublicationAssetIntegrityError";
  }
}

export function requiredProtectedPublicationPaths(input: {
  assetId: string;
  publicationType: "audiobook" | "ebook";
  chapters: unknown[];
  ebookPayload?: unknown;
  requireAsset?: boolean;
}): string[] {
  const prefix = `studio/${input.assetId}/`;
  const ebookPayload = record(input.ebookPayload);
  const ebookChapters = Array.isArray(ebookPayload?.chapters)
    ? ebookPayload.chapters
    : input.chapters;
  const paths: string[] = [];

  if (input.publicationType === "audiobook") {
    for (const chapter of input.chapters) {
      const chapterData = record(chapter);
      if (!chapterData) continue;
      const storagePath = text(chapterData.storagePath);
      if (!storagePath && !input.requireAsset) continue;
      if (!storagePath || !storagePath.startsWith(prefix)) {
        throw new PublicationAssetIntegrityError(
          "An audiobook track is not available from this publication's protected storage."
        );
      }
      paths.push(storagePath);
    }
  } else {
    for (const chapter of ebookChapters) {
      const chapterData = record(chapter);
      if (!chapterData || !Array.isArray(chapterData.pages)) continue;
      for (const page of chapterData.pages) {
        const pageData = record(page);
        if (!pageData) continue;
        const storagePath = text(pageData.assetId || pageData.storagePath);
        if (!storagePath || !storagePath.startsWith(prefix)) {
          throw new PublicationAssetIntegrityError(
            "An illustrated page is not available from this publication's protected storage."
          );
        }
        paths.push(storagePath);
      }
    }
  }

  const uniquePaths = [...new Set(paths)];
  if (input.requireAsset && uniquePaths.length === 0) {
    throw new PublicationAssetIntegrityError(
      "This publication has no protected media available to publish."
    );
  }
  return uniquePaths;
}

export async function assertProtectedPublicationAssets(input: {
  assetId: string;
  publicationType: "audiobook" | "ebook";
  chapters: unknown[];
  ebookPayload?: unknown;
  requireAsset?: boolean;
  exists(path: string): Promise<boolean>;
}): Promise<void> {
  const paths = requiredProtectedPublicationPaths(input);
  const results = await Promise.all(
    paths.map(async (path) => ({ path, exists: await input.exists(path) }))
  );
  if (results.some((result) => !result.exists)) {
    throw new PublicationAssetIntegrityError(
      "A required protected publication asset is missing. Upload it again before publishing."
    );
  }
}
