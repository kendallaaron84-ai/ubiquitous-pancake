const INLINE_STORAGE_ATTRIBUTE = "data-koba-storage-path";
const IMAGE_TAG = /<img\b[^>]*>/gi;
const STORAGE_ATTRIBUTE = /\sdata-koba-storage-path=(?:"([^"]*)"|'([^']*)')/i;
const SOURCE_ATTRIBUTE = /\ssrc=(?:"[^"]*"|'[^']*')/gi;

export function storeProtectedInlineImages(
  html: string,
  assetId: string,
  studioKey: string
): string {
  return html.replace(IMAGE_TAG, (tag) => {
    const path = storagePathFromTag(tag);
    if (!path) return tag;
    const expectedPrefix = `studio/${assetId}/${studioKey}/illustrated_page/`;
    assertProtectedInlinePath(path, expectedPrefix);
    return withImageAttributes(tag, path, null, true);
  });
}

export async function renderProtectedInlineImages(
  html: string,
  assetId: string,
  studioKey: string,
  signStoragePath: (path: string) => Promise<string>,
  preserveStorageIdentity = false
): Promise<string> {
  const matches = [...html.matchAll(IMAGE_TAG)];
  if (!matches.length) return html;
  let cursor = 0;
  let rendered = "";
  for (const match of matches) {
    const index = match.index ?? 0;
    const tag = match[0];
    rendered += html.slice(cursor, index);
    const path = storagePathFromTag(tag);
    if (!path) {
      rendered += tag;
    } else {
      assertProtectedInlinePath(
        path,
        `studio/${assetId}/${studioKey}/illustrated_page/`
      );
      rendered += withImageAttributes(
        tag,
        path,
        await signStoragePath(path),
        preserveStorageIdentity
      );
    }
    cursor = index + tag.length;
  }
  return rendered + html.slice(cursor);
}

function storagePathFromTag(tag: string): string {
  const match = STORAGE_ATTRIBUTE.exec(tag);
  return (match?.[1] || match?.[2] || "").trim();
}

function assertProtectedInlinePath(path: string, expectedPrefix: string): void {
  if (
    !path.startsWith(expectedPrefix) ||
    path.includes("..") ||
    path.includes("\\") ||
    /["'<>\u0000-\u001F\u007F]/.test(path)
  ) {
    throw new Error("PROTECTED_INLINE_IMAGE_PATH_INVALID");
  }
}

function withImageAttributes(
  tag: string,
  path: string,
  source: string | null,
  preserveStorageIdentity: boolean
): string {
  const close = tag.endsWith("/>") ? "/>" : ">";
  const stripped = tag
    .replace(SOURCE_ATTRIBUTE, "")
    .replace(STORAGE_ATTRIBUTE, "")
    .slice(0, -close.length)
    .trimEnd();
  const identity = preserveStorageIdentity
    ? ` ${INLINE_STORAGE_ATTRIBUTE}="${escapeAttribute(path)}"`
    : "";
  const src = source ? ` src="${escapeAttribute(source)}"` : "";
  return `${stripped}${identity}${src}${close}`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
