const AUDIO_CONTENT_TYPES_BY_EXTENSION = new Map([
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["wav", "audio/wav"],
  ["flac", "audio/flac"],
  ["ogg", "audio/ogg"],
]);

const AUDIO_CONTENT_TYPE_ALIASES = new Map([
  ["audio/mp3", "audio/mpeg"],
  ["audio/x-m4a", "audio/mp4"],
  ["audio/m4a", "audio/mp4"],
  ["audio/x-wav", "audio/wav"],
  ["audio/wave", "audio/wav"],
  ["audio/vnd.wave", "audio/wav"],
  ["audio/x-flac", "audio/flac"],
]);

export const STUDIO_AUDIO_ACCEPT = [
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".flac",
  ".ogg",
].join(",");

export interface StudioMediaValidation {
  valid: boolean;
  contentType: string;
  extension: string;
}

export function validateStudioAudioFile(
  fileNameValue: unknown,
  browserContentTypeValue: unknown
): StudioMediaValidation {
  const fileName = clean(fileNameValue);
  const extension = fileName.includes(".")
    ? fileName.split(".").pop()!.toLowerCase()
    : "";
  const expected = AUDIO_CONTENT_TYPES_BY_EXTENSION.get(extension) || "";
  const reported = normalizeContentType(browserContentTypeValue);

  // Safari and Files commonly omit a MIME type or report an Apple-specific
  // alias. The extension is therefore the format authority; MIME is used only
  // to reject a definite non-audio mismatch.
  if (!expected || (reported && !reported.startsWith("audio/"))) {
    return { valid: false, contentType: "", extension };
  }
  return { valid: true, contentType: expected, extension };
}

export function normalizeStudioAudioContentType(value: unknown): string {
  return normalizeContentType(value);
}

function normalizeContentType(value: unknown): string {
  const raw = clean(value).toLowerCase().split(";", 1)[0];
  return AUDIO_CONTENT_TYPE_ALIASES.get(raw) || raw;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
