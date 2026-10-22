import { normalizeReferenceGuideText } from "./reference-guide.ts";

export const NEXUS_STORY_BRIEF_LIMITS = {
  maximumWords: 5_000,
  maximumCharacters: 30_000,
  maxFileSizeBytes: 5 * 1024 * 1024,
  supportedMimeTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
  ],
} as const;

export function validateStoryBriefFile(file: { size: number; type: string; name: string }): void {
  if (file.size <= 0) throw new Error("STORY_BRIEF_EMPTY");
  if (file.size > NEXUS_STORY_BRIEF_LIMITS.maxFileSizeBytes) throw new Error("STORY_BRIEF_TOO_LARGE");
  const extension = file.name.toLowerCase().split(".").pop();
  const extensionAllowed = extension === "pdf" || extension === "docx" || extension === "txt" || extension === "md" || extension === "markdown";
  if (!NEXUS_STORY_BRIEF_LIMITS.supportedMimeTypes.includes(file.type as never) && !extensionAllowed) {
    throw new Error("STORY_BRIEF_TYPE_UNSUPPORTED");
  }
}

export function validateStoryBriefText(value: string): { normalizedText: string; wordCount: number; characterCount: number } {
  const normalizedText = normalizeReferenceGuideText(value);
  const wordCount = normalizedText ? normalizedText.split(/\s+/u).length : 0;
  const characterCount = normalizedText.length;
  if (!normalizedText) throw new Error("STORY_BRIEF_TEXT_EMPTY");
  if (wordCount > NEXUS_STORY_BRIEF_LIMITS.maximumWords) throw new Error("STORY_BRIEF_WORD_LIMIT_EXCEEDED");
  if (characterCount > NEXUS_STORY_BRIEF_LIMITS.maximumCharacters) throw new Error("STORY_BRIEF_CHARACTER_LIMIT_EXCEEDED");
  return { normalizedText, wordCount, characterCount };
}
