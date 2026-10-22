const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

export const SUPPORTED_STUDIO_IMAGE_MIME_TYPES = new Set(
  Object.values(IMAGE_CONTENT_TYPES)
);

export function validateStudioImageFile(fileNameValue: unknown, mimeTypeValue: unknown) {
  const fileName = typeof fileNameValue === "string" ? fileNameValue.trim() : "";
  const mimeType = typeof mimeTypeValue === "string" ? mimeTypeValue.trim().toLowerCase() : "";
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  const extensionType = IMAGE_CONTENT_TYPES[extension] || "";
  if (!extensionType || (mimeType && mimeType !== extensionType)) {
    return { valid: false, contentType: "" };
  }
  return { valid: true, contentType: extensionType };
}
