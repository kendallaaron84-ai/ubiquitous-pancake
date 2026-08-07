import { publicationMediaChapters } from "./reader-media-authorization.ts";

export interface ReaderMediaStorageInventoryItem {
  assetId: string;
  chapterIndex: number;
  status: "protected" | "public_url_only" | "missing";
  storagePath: string | null;
  publicOrigin: string | null;
  proposedStoragePath: string | null;
}

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function publicUrl(chapter: Record<string, unknown>): string {
  for (const value of [chapter.url, chapter.audioUrl, chapter.mediaUrl, chapter.src]) {
    const candidate = text(value);
    try { const parsed = new URL(candidate); if (parsed.protocol === "https:") return parsed.toString(); } catch {}
  }
  return "";
}
function extension(url: string): string {
  try { const match = new URL(url).pathname.toLowerCase().match(/\.(mp3|m4a|aac|wav|ogg|mp4|webm|mov)$/); return match?.[1] || "bin"; } catch { return "bin"; }
}

export function inventoryReaderMediaStorage(products: Array<{ id: string; data: Record<string, unknown> }>): ReaderMediaStorageInventoryItem[] {
  const items: ReaderMediaStorageInventoryItem[] = [];
  for (const entry of products) {
    const assetId = text(entry.id);
    const type = text(entry.data.type || entry.data.assetType).toLowerCase();
    if (!assetId || type === "ebook" || assetId.startsWith("ebk_")) continue;
    const chapters = publicationMediaChapters(entry.data, type || "audiobook");
    chapters.forEach((raw, chapterIndex) => {
      const chapter = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const storagePath = text(chapter.storagePath);
      const url = publicUrl(chapter);
      const protectedPath = storagePath.startsWith(`studio/${assetId}/`);
      items.push({ assetId, chapterIndex, status: protectedPath ? "protected" : url ? "public_url_only" : "missing", storagePath: protectedPath ? storagePath : null, publicOrigin: url ? new URL(url).origin : null, proposedStoragePath: !protectedPath && url ? `studio/${assetId}/chapter-${chapterIndex + 1}.${extension(url)}` : null });
    });
  }
  return items;
}

export function summarizeReaderMediaStorage(items: ReaderMediaStorageInventoryItem[]) {
  return items.reduce((summary, item) => { summary[item.status] += 1; summary.total += 1; return summary; }, { total: 0, protected: 0, public_url_only: 0, missing: 0 });
}
