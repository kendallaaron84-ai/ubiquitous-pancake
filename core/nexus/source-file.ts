import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

export async function extractNexusSourceText(bytes: Buffer, name: string, mimeType: string): Promise<string> {
  const extension = name.toLowerCase().split(".").pop();
  if (mimeType.startsWith("text/") || extension === "txt" || extension === "md" || extension === "markdown") {
    return bytes.toString("utf8");
  }
  if (mimeType.includes("wordprocessingml") || extension === "docx") {
    const mammoth = nodeRequire("mammoth") as { extractRawText(input: { buffer: Buffer }): Promise<{ value: string }> };
    return (await mammoth.extractRawText({ buffer: bytes })).value;
  }
  if (mimeType === "application/pdf" || extension === "pdf") {
    const pdfParse = nodeRequire("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;
    return (await pdfParse(bytes)).text;
  }
  throw new Error("NEXUS_SOURCE_FILE_TYPE_UNSUPPORTED");
}

export function safeNexusSourceFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || "source";
}
