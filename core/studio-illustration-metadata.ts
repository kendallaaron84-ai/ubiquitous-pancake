export const ILLUSTRATION_ALT_TEXT_MAX_LENGTH = 500;
export const ILLUSTRATION_CAPTION_MAX_LENGTH = 2_000;

export type IllustrationMetadata = {
  altText: string;
  caption: string;
};

export type ProtectedIllustrationSnapshot = IllustrationMetadata & {
  storagePath: string;
  source: string;
  directCaptions: string[];
};

export type ProtectedIllustrationLocator = {
  figureIndex: number;
  storagePath: string;
  source: string;
};

type IllustrationFigure = Pick<HTMLElement, "appendChild" | "ownerDocument" | "querySelector" | "querySelectorAll">;
type IllustrationEditor = Pick<HTMLElement, "contains" | "querySelectorAll">;

function plainText(value: unknown, maximum: number, field: string): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (text.length > maximum) {
    throw new RangeError(`${field} must be ${maximum.toLocaleString()} characters or fewer.`);
  }
  return text;
}

export function normalizeIllustrationMetadata(value: IllustrationMetadata): IllustrationMetadata {
  const altText = plainText(value.altText, ILLUSTRATION_ALT_TEXT_MAX_LENGTH, "Alt text");
  if (!altText) throw new TypeError("Alt text is required for this illustration.");
  return {
    altText,
    caption: plainText(value.caption, ILLUSTRATION_CAPTION_MAX_LENGTH, "Caption"),
  };
}

export function readProtectedIllustrationMetadata(
  figure: IllustrationFigure
): ProtectedIllustrationSnapshot | null {
  const image = figure.querySelector<HTMLImageElement>("img[data-koba-storage-path]");
  if (!image) return null;
  const storagePath = String(image.getAttribute("data-koba-storage-path") || "").trim();
  if (!storagePath) return null;
  const directCaptions = [...figure.querySelectorAll<HTMLElement>(":scope > figcaption")]
    .map((caption) => caption.textContent || "");
  return {
    storagePath,
    source: image.getAttribute("src") || "",
    altText: image.getAttribute("alt") || "",
    caption: directCaptions[0] || "",
    directCaptions,
  };
}

function replaceDirectCaptions(figure: IllustrationFigure, captions: readonly string[]) {
  figure.querySelectorAll<HTMLElement>(":scope > figcaption").forEach((caption) => caption.remove());
  captions.forEach((text) => {
    const caption = figure.ownerDocument.createElement("figcaption");
    caption.textContent = text;
    figure.appendChild(caption);
  });
}

export function applyProtectedIllustrationMetadata(
  figure: IllustrationFigure,
  value: IllustrationMetadata
): ProtectedIllustrationSnapshot {
  const before = readProtectedIllustrationMetadata(figure);
  if (!before) throw new TypeError("Select an existing protected illustration before editing metadata.");
  const metadata = normalizeIllustrationMetadata(value);
  const image = figure.querySelector<HTMLImageElement>("img[data-koba-storage-path]");
  if (!image) throw new TypeError("The protected illustration is unavailable.");

  image.setAttribute("alt", metadata.altText);
  replaceDirectCaptions(figure, metadata.caption ? [metadata.caption] : []);

  const after = readProtectedIllustrationMetadata(figure);
  if (!after || after.storagePath !== before.storagePath || after.source !== before.source) {
    throw new Error("Illustration metadata editing must not change the protected asset identity or preview source.");
  }
  return after;
}

export function restoreProtectedIllustrationSnapshot(
  figure: IllustrationFigure,
  trusted: ProtectedIllustrationSnapshot
): ProtectedIllustrationSnapshot {
  const before = readProtectedIllustrationMetadata(figure);
  if (
    !before ||
    before.storagePath !== trusted.storagePath ||
    before.source !== trusted.source
  ) {
    throw new Error("The selected protected illustration no longer matches its trusted metadata snapshot.");
  }
  const image = figure.querySelector<HTMLImageElement>("img[data-koba-storage-path]");
  if (!image) throw new TypeError("The protected illustration is unavailable.");

  image.setAttribute("alt", trusted.altText);
  replaceDirectCaptions(figure, trusted.directCaptions);

  const after = readProtectedIllustrationMetadata(figure);
  if (!after || after.storagePath !== before.storagePath || after.source !== before.source) {
    throw new Error("Restoring illustration metadata must not change the protected asset identity or preview source.");
  }
  return after;
}

function protectedFigures(editor: IllustrationEditor): HTMLElement[] {
  return [...editor.querySelectorAll<HTMLElement>("figure.koba-illustration")]
    .filter((figure) => Boolean(figure.querySelector("img[data-koba-storage-path]")));
}

export function captureProtectedIllustrationLocator(
  editor: IllustrationEditor,
  figure: HTMLElement
): ProtectedIllustrationLocator | null {
  if (!editor.contains(figure)) return null;
  const figures = protectedFigures(editor);
  const figureIndex = figures.indexOf(figure);
  const snapshot = readProtectedIllustrationMetadata(figure);
  if (figureIndex < 0 || !snapshot) return null;
  return {
    figureIndex,
    storagePath: snapshot.storagePath,
    source: snapshot.source,
  };
}

export function rebindProtectedIllustration(
  editor: IllustrationEditor,
  locator: ProtectedIllustrationLocator
): HTMLElement | null {
  const figure = protectedFigures(editor)[locator.figureIndex] || null;
  const snapshot = figure ? readProtectedIllustrationMetadata(figure) : null;
  if (!figure || !snapshot || snapshot.storagePath !== locator.storagePath) return null;
  const image = figure.querySelector<HTMLImageElement>("img[data-koba-storage-path]");
  if (!image) return null;
  if (!snapshot.source && locator.source) image.setAttribute("src", locator.source);
  const rebound = readProtectedIllustrationMetadata(figure);
  return rebound && rebound.storagePath === locator.storagePath && rebound.source === locator.source
    ? figure
    : null;
}
