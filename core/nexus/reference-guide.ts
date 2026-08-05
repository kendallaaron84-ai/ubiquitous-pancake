export const NEXUS_REFERENCE_GUIDE_LIMITS = {
  minimumWords: 300,
  recommendedMaximumWords: 3_000,
  maximumWords: 5_000,
  maximumCharacters: 30_000,
  maxFileSizeBytes: 5 * 1024 * 1024,
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

export function normalizeReferenceGuideText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function countReferenceGuideWords(value: string): number {
  const normalized = normalizeReferenceGuideText(value);
  return normalized ? normalized.split(/\s+/u).length : 0;
}

export function validateReferenceGuideText(value: string): { normalizedText: string; wordCount: number; characterCount: number } {
  const normalizedText = normalizeReferenceGuideText(value);
  const wordCount = countReferenceGuideWords(normalizedText);
  const characterCount = normalizedText.length;
  if (!normalizedText) throw new Error("REFERENCE_GUIDE_TEXT_EMPTY");
  if (wordCount < NEXUS_REFERENCE_GUIDE_LIMITS.minimumWords) throw new Error("REFERENCE_GUIDE_TOO_SHORT");
  if (wordCount > NEXUS_REFERENCE_GUIDE_LIMITS.maximumWords) throw new Error("REFERENCE_GUIDE_WORD_LIMIT_EXCEEDED");
  if (characterCount > NEXUS_REFERENCE_GUIDE_LIMITS.maximumCharacters) throw new Error("REFERENCE_GUIDE_CHARACTER_LIMIT_EXCEEDED");
  return { normalizedText, wordCount, characterCount };
}

export function createTraceabilityChunks(text: string, maxCharacters = 1_600): string[] {
  const normalized = normalizeReferenceGuideText(text);
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
