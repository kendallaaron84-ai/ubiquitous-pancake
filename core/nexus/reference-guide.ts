export const NEXUS_REFERENCE_GUIDE_LIMITS = {
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxExtractedCharacters: 60_000,
  maxEstimatedTokens: 15_000,
  maxChunksPerGuide: 120,
  supportedMimeTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
  ],
} as const;

export function validateReferenceGuideFile(file: { size: number; type: string; name: string }): void {
  if (file.size <= 0) throw new Error("REFERENCE_GUIDE_EMPTY");
  if (file.size > NEXUS_REFERENCE_GUIDE_LIMITS.maxFileSizeBytes) throw new Error("REFERENCE_GUIDE_TOO_LARGE");
  const extension = file.name.toLowerCase().split(".").pop();
  const extensionAllowed = extension === "pdf" || extension === "docx" || extension === "txt" || extension === "md" || extension === "markdown";
  if (!NEXUS_REFERENCE_GUIDE_LIMITS.supportedMimeTypes.includes(file.type as never) && !extensionAllowed) {
    throw new Error("REFERENCE_GUIDE_TYPE_UNSUPPORTED");
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

export function createSemanticChunks(text: string, maxCharacters = 1_600): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxCharacters) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
