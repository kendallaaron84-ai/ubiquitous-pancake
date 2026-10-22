const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;
const STORAGE_ATTRIBUTE_PATTERN = /\sdata-koba-storage-path\s*=\s*(["'])(.*?)\1/i;
const SOURCE_ATTRIBUTE_PATTERN = /\ssrc\s*=\s*(["'])(.*?)\1/i;

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function decodeAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function storagePathFromImageTag(tag: string): string {
  const match = tag.match(STORAGE_ATTRIBUTE_PATTERN);
  return match ? decodeAttribute(match[2]).trim().replace(/^\/+/, "") : "";
}

function assertSafeAttributePath(path: string): string {
  if (!path || /[<>"'\u0000-\u001F\u007F]/.test(path)) {
    throw new TypeError("Protected illustration path is invalid.");
  }
  return path;
}

function replaceImageAttributes(tag: string, storagePath: string, source: string): string {
  const closing = tag.endsWith("/>") ? "/>" : ">";
  const body = tag
    .slice(0, -closing.length)
    .replace(STORAGE_ATTRIBUTE_PATTERN, "")
    .replace(SOURCE_ATTRIBUTE_PATTERN, "")
    .trimEnd();
  const protectedAttribute = ` data-koba-storage-path="${escapeAttribute(storagePath)}"`;
  const sourceAttribute = ` src="${escapeAttribute(source)}"`;
  return `${body}${sourceAttribute}${protectedAttribute}${closing}`;
}

export function canonicalizeProtectedChapterImages(
  html: string,
  assertStoragePath: (path: string) => string
): { html: string; storagePaths: string[] } {
  const storagePaths: string[] = [];
  const canonicalHtml = String(html || "").replace(IMAGE_TAG_PATTERN, (tag) => {
    const requestedPath = storagePathFromImageTag(tag);
    if (!requestedPath) return tag;
    const storagePath = assertStoragePath(assertSafeAttributePath(requestedPath));
    storagePaths.push(storagePath);
    // Signed preview URLs are intentionally discarded before persistence.
    return replaceImageAttributes(tag, storagePath, "");
  });
  return { html: canonicalHtml, storagePaths: [...new Set(storagePaths)] };
}

export function protectedChapterImagePaths(html: string): string[] {
  const paths: string[] = [];
  for (const match of String(html || "").matchAll(IMAGE_TAG_PATTERN)) {
    const path = storagePathFromImageTag(match[0]);
    if (path) paths.push(path);
  }
  return [...new Set(paths)];
}

export async function attachProtectedChapterImageUrls(
  html: string,
  authorizePath: (path: string) => string,
  signStoragePath: (path: string) => Promise<string>
): Promise<string> {
  const source = String(html || "");
  const tags = [...source.matchAll(IMAGE_TAG_PATTERN)];
  if (!tags.length) return source;
  let cursor = 0;
  let rendered = "";
  for (const match of tags) {
    const index = match.index ?? cursor;
    rendered += source.slice(cursor, index);
    const tag = match[0];
    const requestedPath = storagePathFromImageTag(tag);
    if (!requestedPath) {
      rendered += tag;
    } else {
      const storagePath = authorizePath(assertSafeAttributePath(requestedPath));
      const signedUrl = await signStoragePath(storagePath);
      rendered += replaceImageAttributes(tag, storagePath, signedUrl);
    }
    cursor = index + tag.length;
  }
  return rendered + source.slice(cursor);
}
