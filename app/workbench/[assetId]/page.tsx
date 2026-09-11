"use client";

import React, { useState, useEffect, use, useRef } from "react";
import { Save, ChevronLeft, Wand2, List, Sparkles, Info, Activity, Edit3, ShieldAlert, ImagePlus, Trash2, GripVertical, Replace } from "lucide-react";
import Link from "next/link";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { toast } from "@/components/ui/use-toast";
import { ModeToggle } from "@/components/elements/mode-toggle";
import { loadStudioProduct, saveStudioProduct, uploadStudioFile } from "@/core/studio-client";

const CHAPTER_TAGS = new Set(["A", "ABBR", "B", "BLOCKQUOTE", "BR", "CITE", "CODE", "DIV", "EM", "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "LI", "OL", "P", "PRE", "SECTION", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "UL"]);
const PAGE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/svg+xml"]);

function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.name}.`)); };
    image.src = url;
  });
}

function sanitizeChapterHtml(value: string): string {
  if (typeof window === "undefined") return value;
  const parsed = new DOMParser().parseFromString(`<div>${value || ""}</div>`, "text/html");
  const root = parsed.body.firstElementChild;
  if (!root) return "";
  root.querySelectorAll("script,style,iframe,object,embed,form,link,meta,svg").forEach((node) => node.remove());
  [...root.querySelectorAll("*")].forEach((node) => {
    if (!CHAPTER_TAGS.has(node.tagName)) { node.replaceWith(...node.childNodes); return; }
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || !["href", "src", "alt", "title", "class", "role", "aria-label", "loading"].includes(name)) node.removeAttribute(attribute.name);
    });
    if (node instanceof HTMLImageElement) {
      try {
        const source = new URL(node.getAttribute("src") || "");
        if (!/^https?:$/.test(source.protocol) || !/\.(?:jpe?g|png|gif|svg)$/i.test(source.pathname)) node.remove();
      } catch { node.remove(); }
      node.alt = node.getAttribute("alt") || "Illustration";
    }
  });
  return root.innerHTML;
}

function editorHtml(value: string): string {
  const source = String(value || "");
  if (/<[a-z][\s\S]*>/i.test(source)) return sanitizeChapterHtml(source);
  return source.split(/\r?\n/).map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</p>`).join("");
}

// 🛠️ THEME-RESPONSIVE TOOLTIP
const Tooltip = ({ text, children }: { text: string, children: React.ReactNode }) => {
  return (
    <div className="relative flex items-center group cursor-help ml-2">
      <Info className="w-3.5 h-3.5 text-slate-400 dark:text-[#F9B437]/60 hover:text-emerald-500 dark:hover:text-[#F9B437] transition-colors" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-[10px] rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 border border-slate-200 dark:border-slate-700">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-white dark:border-t-slate-800"></div>
      </div>
      <div className="hidden">{children}</div>
    </div>
  );
};

export default function AuthorWorkbench({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = use(params); 

  const [bookData, setBookData] = useState<any>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingInsertionSlotRef = useRef<HTMLElement | null>(null);
  const selectedFigureRef = useRef<HTMLElement | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [hasSelectedIllustration, setHasSelectedIllustration] = useState(false);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const replacePageInputRef = useRef<HTMLInputElement>(null);
  const replacePageIndexRef = useRef<number | null>(null);
  const dragPageIndexRef = useRef<number | null>(null);
  const [isUploadingPages, setIsUploadingPages] = useState(false);
  
  // 🛡️ Style Guardrails State
  const [guardrails, setGuardrails] = useState({
    setting: "",
    mood: "",
    loreContext: ""
  });

  useEffect(() => {
    if (!assetId) return;
    
    const fetchManuscript = async () => {
      try {
        console.log("🎯 Workbench attempting connection for assetId:", assetId);
        const payload = await loadStudioProduct(assetId);
        const data = payload.product;
        if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
          data.chapters = [{ id: `ch_1_${assetId}`, title: "Chapter 1", textContent: "" }];
        }
        setBookData(data);
        if (data.guardrails) setGuardrails(data.guardrails);
      } catch (error: any) {
        console.error("Workbench publication lookup failed:", error);
        setBookData({
          title: "Publication unavailable",
          type: "ebook",
          accessError: error?.message || "This publication could not be opened.",
          chapters: [],
        });
      }
    };
    
    fetchManuscript();
  // ... Your existing fetchManuscript useEffect ends here ...
  }, [assetId]);

  const handleMasteredUpload = async (e: React.ChangeEvent<HTMLInputElement>, chapterId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    toast({ title: "Mastered Upload", description: "Injecting production-ready audio into the vault..." });
    try {
      const uploaded = await uploadStudioFile(assetId, file, "mastered");
      await saveStudioProduct(assetId, "attach_mastered_audio", {
        chapterId,
        storagePath: uploaded.storagePath,
      });
      toast({ title: "Production Success", description: "Audio mastered and vaulted." });
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "The mastered audio could not be saved.",
        variant: "destructive",
      });
    }
};

  const updateActiveChapterHtml = (html: string) => {
    setBookData((current: any) => {
      const chapters = [...(current?.chapters || [])];
      if (!chapters[activeChapterIndex]) return current;
      chapters[activeChapterIndex] = { ...chapters[activeChapterIndex], textContent: html };
      return { ...current, chapters };
    });
  };

  const serializedEditorHtml = () => {
    if (!editorRef.current) return "";
    const copy = editorRef.current.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[data-koba-image-slot]").forEach((slot) => slot.remove());
    return copy.innerHTML;
  };

  const refreshImageInsertionSlots = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.querySelectorAll("[data-koba-image-slot]").forEach((slot) => slot.remove());
    const blocks = [...editor.children];
    for (let index = blocks.length; index >= 0; index -= 1) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.contentEditable = "false";
      slot.dataset.kobaImageSlot = String(index);
      slot.className = "koba-image-insertion-slot";
      slot.textContent = "+ Add Image Here";
      slot.setAttribute("aria-label", `Add image at chapter position ${index + 1}`);
      editor.insertBefore(slot, blocks[index] || null);
    }
  };

  const chooseImageForSlot = (slot: HTMLElement) => {
    pendingInsertionSlotRef.current = slot;
    imageInputRef.current?.click();
  };

  useEffect(() => {
    if (!bookData) return;
    const frame = window.requestAnimationFrame(refreshImageInsertionSlots);
    return () => window.cancelAnimationFrame(frame);
  }, [activeChapterIndex, bookData?.chapters?.[activeChapterIndex]?.id]);

  const insertImageAtSelectedPosition = (url: string, alt: string) => {
    const editor = editorRef.current;
    const slot = pendingInsertionSlotRef.current;
    if (!editor || !slot || !editor.contains(slot)) {
      toast({ title: "Choose an insertion point", description: "Select Add Image Here where the illustration should appear.", variant: "destructive" });
      return;
    }
    const figure = document.createElement("figure");
    figure.className = "koba-illustration";
    const image = document.createElement("img");
    image.src = url;
    image.alt = alt;
    image.loading = "lazy";
    figure.appendChild(image);
    slot.replaceWith(figure);
    pendingInsertionSlotRef.current = null;
    selectedFigureRef.current = figure;
    setHasSelectedIllustration(true);
    updateActiveChapterHtml(serializedEditorHtml());
    refreshImageInsertionSlots();
  };

  const handleIllustrationUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/svg+xml"]);
    if (!allowedTypes.has(file.type)) {
      toast({ title: "Unsupported image", description: "Use JPEG, PNG, GIF, or SVG.", variant: "destructive" });
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Images must be 12 MB or smaller.", variant: "destructive" });
      return;
    }
    setIsUploadingImage(true);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "image";
      const chapterId = bookData.chapters[activeChapterIndex]?.id || `chapter-${activeChapterIndex + 1}`;
      const storagePath = `studio/${assetId}/illustrations/${chapterId}/${crypto.randomUUID()}.${extension}`;
      const storageReference = ref(getStorage(), storagePath);
      const snapshot = await new Promise<any>((resolve, reject) => {
        const task = uploadBytesResumable(storageReference, file, { contentType: file.type });
        task.on("state_changed", undefined, reject, () => resolve(task.snapshot));
      });
      insertImageAtSelectedPosition(await getDownloadURL(snapshot.ref), file.name.replace(/\.[^.]+$/, ""));
      toast({ title: "Image inserted", description: "Save Draft to preserve it in this chapter." });
    } catch (error: any) {
      toast({ title: "Image upload failed", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const removeSelectedImage = () => {
    const selection = window.getSelection();
    const element = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const figure = selectedFigureRef.current || element?.closest("figure.koba-illustration");
    if (!figure || !editorRef.current?.contains(figure)) {
      toast({ title: "Select an image", description: "Click an inserted image, then choose Remove Image." });
      return;
    }
    figure.remove();
    selectedFigureRef.current = null;
    setHasSelectedIllustration(false);
    updateActiveChapterHtml(serializedEditorHtml());
    refreshImageInsertionSlots();
  };

  const handleSave = async () => {
  if (!bookData) return;
  setIsSaving(true);
  try {
    const sourceChapters = Array.isArray(bookData.chapters) ? bookData.chapters : [];
    const illustrated = bookData.layoutMode === "illustrated_pages";
    const formattedChapters = sourceChapters.map((ch: any, index: number) => illustrated
      ? { id: ch.id || `ch_${index + 1}_${assetId}`, title: ch.title || `Chapter ${index + 1}`, pages: Array.isArray(ch.pages) ? ch.pages : [] }
      : { id: ch.id || `ch_${index + 1}_${assetId}`, title: ch.title || `Chapter ${index + 1}`, textContent: sanitizeChapterHtml(editorHtml(ch.textContent || ch.content || "")) });

    const payload = await saveStudioProduct(assetId, "save_workbench_draft", {
      chapters: formattedChapters,
      guardrails,
      layoutMode: illustrated ? "illustrated_pages" : "reflowable",
      illustratedPageSettings: bookData.illustratedPageSettings,
    });

    setBookData((current: any) => ({
      ...current,
      ...payload.product,
    }));

    console.log("💾 Workbench manuscript saved to products collection.", {
      assetId,
      chapterCount: formattedChapters.length
    });
  } catch (error) {
    console.error("Save failed:", error);
  } finally {
    setIsSaving(false);
  }
};

  const uploadPageFiles = async (files: File[], replaceIndex: number | null = null) => {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    if (!sorted.length) return;
    if (sorted.some((file) => !PAGE_IMAGE_TYPES.has(file.type))) {
      toast({ title: "Unsupported page", description: "Use JPEG, PNG, GIF, or SVG page images.", variant: "destructive" });
      return;
    }
    setIsUploadingPages(true);
    try {
      const uploadedPages: Array<{
        id: string; assetId: string; previewUrl: string; fileName: string; mimeType: string;
        width: number; height: number; aspectRatio: number; facingIntent: "auto";
      }> = [];
      for (const file of sorted) {
        const [dimensions, uploaded] = await Promise.all([
          imageDimensions(file),
          uploadStudioFile(assetId, file, "illustrated_page"),
        ]);
        uploadedPages.push({
          id: `page_${crypto.randomUUID()}`,
          assetId: uploaded.storagePath,
          previewUrl: URL.createObjectURL(file),
          fileName: file.name,
          mimeType: file.type,
          ...dimensions,
          aspectRatio: dimensions.width / dimensions.height,
          facingIntent: "auto",
        });
      }
      setBookData((current: any) => {
        const chapters = [...current.chapters];
        const chapter = { ...chapters[activeChapterIndex] };
        const pages = [...(chapter.pages || [])];
        if (replaceIndex !== null) pages.splice(replaceIndex, 1, uploadedPages[0]);
        else pages.push(...uploadedPages);
        chapters[activeChapterIndex] = { ...chapter, pages };
        return { ...current, chapters };
      });
      toast({ title: replaceIndex === null ? "Pages added" : "Page replaced", description: "Save Draft to preserve the illustrated page order." });
    } catch (error) {
      toast({ title: "Page upload failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setIsUploadingPages(false);
      replacePageIndexRef.current = null;
    }
  };

  const updateCurrentPages = (transform: (pages: any[]) => any[]) => {
    setBookData((current: any) => {
      const chapters = [...current.chapters];
      const chapter = { ...chapters[activeChapterIndex] };
      chapter.pages = transform([...(chapter.pages || [])]);
      chapters[activeChapterIndex] = chapter;
      return { ...current, chapters };
    });
  };

  const addChapter = () => {
      if(!bookData) return;
      const newChapters = [...bookData.chapters];
      newChapters.push({
          id: `ch_${Date.now()}_${assetId}`,
          title: `Chapter ${newChapters.length + 1}`,
          content: ""
      });
      setBookData({...bookData, chapters: newChapters});
      setActiveChapterIndex(newChapters.length - 1);
  }

  // 1. If bookData hasn't loaded anything from Firestore yet
  // ==========================================
  // 🚀 BULLETPROOF RENDERING LIFE-GUARD
  // ==========================================

  // 1. Await database resolution safely
  if (!bookData) {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-[#070a0f]">
            <p className="text-sm font-semibold tracking-wider text-orange-500 animate-pulse font-mono">
                INITIALIZING DECOUPLED VAULT MATRIX...
            </p>
        </div>
    );
  }

  if (bookData.accessError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#070a0f] p-6 text-center text-white">
        <div className="max-w-md rounded-xl border border-red-900/40 bg-red-950/10 p-6">
          <h3 className="mb-2 text-lg font-bold text-red-500">Publication unavailable</h3>
          <p className="text-sm text-gray-400">{bookData.accessError}</p>
          <Link href="/products" className="mt-5 inline-block text-sm font-semibold text-orange-400">Return to Product Catalog</Link>
        </div>
      </div>
    );
  }

  // 2. Normalize chapters immediately so it is GUARANTEED to be a safe scrollable array
  const safeChapters = Array.isArray(bookData.chapters) ? bookData.chapters : [];
  const currentChapter = safeChapters[activeChapterIndex] || { title: "Drafting...", textContent: "" };

  // 3. Trigger debug screen if the product payload contains no text lines
  if (safeChapters.length === 0) {
    return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#070a0f] p-6 text-center text-white">
            <div className="max-w-md rounded-xl border border-red-900/40 bg-red-950/10 p-6 backdrop-blur-md">
                <h3 className="text-lg font-bold text-red-500 mb-2">E-Reader Array Contract Missing</h3>
                <p className="text-sm text-gray-400 mb-4">
                    The record resolved, but the tracking array is missing its inner rows.
                </p>
            </div>
        </div>
    );
  }

  // 2. 🛠️ NEW DEBUG GUARD: If data fetched successfully but fields are corrupt/missing
  if (bookData.title === "Offline Draft" || !bookData.chapters) {
    return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#070a0f] p-6 text-center text-white font-sans">
            <div className="max-w-md rounded-xl border border-red-900/40 bg-red-950/10 p-6 backdrop-blur-md">
                <h3 className="text-lg font-bold text-red-500 mb-2">E-Reader Launch Blocked</h3>
                <p className="text-sm text-gray-400 mb-4">
                    The workbench route compiled successfully, but could not read valid manifest attributes for asset: 
                    <span className="block font-mono text-xs text-orange-400 mt-1 bg-black/40 p-2 rounded">
                        {assetId}
                    </span>
                </p>
                <div className="text-left text-xs bg-black/50 p-3 rounded font-mono border border-gray-800 text-gray-500">
                    Expected: Firestore Document under "products" collection with correct layout keys.
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f4f7ff] dark:bg-[#1E2B53] text-[#1E2B53] dark:text-white overflow-hidden font-sans transition-colors duration-300 relative">
      
      {/* ⬅️ LEFT PANEL: Manuscript Navigation */}
      <div className="w-64 bg-[#f4f7ff] dark:bg-[#1E2B53] border-r border-[#d7e0f5] dark:border-[#293A71] flex flex-col transition-colors duration-300 shrink-0">
        <div className="p-4 border-b border-slate-200 dark:border-[#7C2B22]/30 flex items-center gap-3">
          <Link href="/products" className="p-1.5 bg-slate-100 dark:bg-[#7C2B22]/20 rounded-md hover:bg-slate-200 dark:hover:bg-[#7C2B22]/40 transition-colors">
            <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-[#F9B437]" />
          </Link>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-[#F9B437] truncate">
            {bookData.title || "Untitled Draft"}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {bookData.chapters.map((chapter: any, index: number) => (
            <button
              key={chapter.id}
              onClick={() => setActiveChapterIndex(index)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeChapterIndex === index 
                  ? "bg-emerald-50 dark:bg-[#7C2B22] text-emerald-700 dark:text-[#F9B437] border border-emerald-200 dark:border-[#F9B437]/30 shadow-sm" 
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#7C2B22]/30 dark:hover:text-[#F9B437]"
              }`}
            >
              {chapter.title || `Chapter ${index + 1}`}
            </button>
          ))}
          <button 
            onClick={addChapter}
            className="w-full mt-4 flex items-center justify-center gap-2 py-2 border border-dashed border-slate-300 dark:border-[#7C2B22] rounded-lg text-xs font-bold text-slate-500 hover:text-emerald-600 dark:hover:text-[#F9B437] dark:hover:border-[#F9B437]/50 transition-all uppercase tracking-wider">
            + Add Chapter
          </button>
        </div>
      </div>

      {/* ⏺️ CENTER PANEL: The Distraction-Free Canvas */}
      <div className="flex-1 flex flex-col relative bg-white dark:bg-[#293A71] transition-colors duration-300">
        <div className="absolute top-0 w-full p-4 flex justify-end gap-3 z-10 pointer-events-none">
          <div className="pointer-events-auto flex gap-2">

            <ModeToggle />

            <button 
              onClick={() => setAiPanelOpen(!aiPanelOpen)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md ${aiPanelOpen ? 'bg-orange-500 text-white dark:bg-[#7C2B22] dark:text-[#F9B437]' : 'bg-white dark:bg-slate-900 text-orange-600 dark:text-[#F9B437]/50 border border-orange-200 dark:border-[#7C2B22] dark:hover:bg-[#7C2B22]/20'}`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Studio Tools
            </button>
            <button 
              onClick={handleSave}
              className="flex items-center gap-2 bg-emerald-600 dark:bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white dark:text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? "Syncing..." : "Save Draft"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-12 pt-24 pb-32">
          <div className="max-w-3xl mx-auto space-y-6">
            <input
              type="text"
              value={bookData.chapters[activeChapterIndex]?.title || ""}
              onChange={(e) => {
                const newChapters = [...bookData.chapters];
                newChapters[activeChapterIndex].title = e.target.value;
                setBookData({ ...bookData, chapters: newChapters });
              }}
              className="w-full bg-transparent text-3xl font-bold text-[#1E2B53] dark:text-white border-none outline-none focus:ring-0 placeholder-slate-400 dark:placeholder-white/40 transition-colors"
              placeholder="Chapter Title"
            />
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-950/20">
              <div><p className="text-sm font-bold">Presentation</p><p className="text-xs text-slate-500">Choose the authoring model for this publication.</p></div>
              <select
                aria-label="Publication presentation model"
                value={bookData.layoutMode === "illustrated_pages" ? "illustrated_pages" : "reflowable"}
                onChange={(event) => setBookData({
                  ...bookData,
                  layoutMode: event.target.value,
                  illustratedPageSettings: bookData.illustratedPageSettings || { spreadStart: "right", allowSpreads: true, pageBackground: "#111111" },
                  chapters: bookData.chapters.map((chapter: any) => ({ ...chapter, pages: chapter.pages || [] })),
                })}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-slate-900"
              >
                <option value="reflowable">Reflowable book</option>
                <option value="illustrated_pages">Illustrated finished pages</option>
              </select>
            </div>
            {bookData.layoutMode === "illustrated_pages" ? (
            <section aria-labelledby="illustrated-pages-heading" className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-950/20">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 id="illustrated-pages-heading" className="text-sm font-bold">Finished Page Plates</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Upload complete pages. KOBA-I preserves every page as one indivisible composition.</p></div>
                <button type="button" disabled={isUploadingPages} onClick={() => pageInputRef.current?.click()} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><ImagePlus className="h-4 w-4" />{isUploadingPages ? "Uploading…" : "+ Add Pages"}</button>
              </div>
              <input ref={pageInputRef} type="file" multiple accept="image/jpeg,image/png,image/gif,image/svg+xml" className="hidden" onChange={(event) => { const files = [...(event.target.files || [])]; event.target.value = ""; void uploadPageFiles(files); }} />
              <input ref={replacePageInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/svg+xml" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadPageFiles([file], replacePageIndexRef.current); }} />
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(currentChapter.pages || []).map((page: any, pageIndex: number) => {
                  const referenceRatio = Number((currentChapter.pages || [])[0]?.aspectRatio || 0);
                  const ratioMismatch = referenceRatio > 0 && Math.abs(Number(page.aspectRatio) - referenceRatio) / referenceRatio > 0.08;
                  return (
                    <article key={page.id || pageIndex} draggable onDragStart={() => { dragPageIndexRef.current = pageIndex; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { const from = dragPageIndexRef.current; if (from === null || from === pageIndex) return; updateCurrentPages((pages) => { const [moved] = pages.splice(from, 1); pages.splice(pageIndex, 0, moved); return pages; }); dragPageIndexRef.current = null; }} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
                      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs dark:border-white/10"><span className="flex items-center gap-1 font-bold"><GripVertical className="h-4 w-4 text-slate-400" /> Page {pageIndex + 1}</span><span>{page.width} × {page.height}</span></div>
                      <div className="flex h-64 items-center justify-center bg-slate-200 p-2 dark:bg-black/40"><img src={page.previewUrl} alt={`Page ${pageIndex + 1} preview`} draggable={false} className="max-h-full max-w-full object-contain" /></div>
                      {ratioMismatch && <p className="bg-amber-50 px-3 py-2 text-xs text-amber-800">Aspect ratio differs from the first page.</p>}
                      <div className="flex items-center justify-between gap-2 p-3">
                        <select aria-label={`Facing intent for page ${pageIndex + 1}`} value={page.facingIntent || "auto"} onChange={(event) => updateCurrentPages((pages) => pages.map((candidate, index) => index === pageIndex ? { ...candidate, facingIntent: event.target.value } : candidate))} className="rounded border px-2 py-1 text-xs dark:bg-slate-800"><option value="auto">Auto facing</option><option value="left">Left</option><option value="right">Right</option></select>
                        <div className="flex gap-1"><button type="button" title="Replace page" onClick={() => { replacePageIndexRef.current = pageIndex; replacePageInputRef.current?.click(); }} className="rounded p-2 hover:bg-slate-100 dark:hover:bg-white/10"><Replace className="h-4 w-4" /></button><button type="button" title="Delete page" onClick={() => updateCurrentPages((pages) => pages.filter((_, index) => index !== pageIndex))} className="rounded p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /></button></div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {(currentChapter.pages || []).length === 0 && <div className="mt-5 rounded-xl border-2 border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">Add finished page images to this chapter. Filename order is preserved deterministically.</div>}
            </section>
            ) : (
            <section aria-labelledby="chapter-content-heading" className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-950/20">
              <div className="mb-3">
                <h2 id="chapter-content-heading" className="text-sm font-bold text-[#1E2B53] dark:text-white">Chapter Content</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Write your chapter and add illustrations where they belong.</p>
                <p className="mt-1 text-xs text-slate-500">Choose an Add Image Here position inside the chapter.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-y border-slate-200 py-3 dark:border-white/10">
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/svg+xml" className="hidden" onChange={handleIllustrationUpload} />
              {isUploadingImage && <span className="flex items-center gap-2 text-sm font-bold text-emerald-700"><ImagePlus className="h-4 w-4" /> Uploading illustration…</span>}
              {hasSelectedIllustration && (
                <button type="button" onClick={removeSelectedImage} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                  <Trash2 className="h-4 w-4" /> Remove Image
                </button>
              )}
              <span className="text-[11px] text-slate-500">JPEG, PNG, GIF, or safely stored SVG · 12 MB max</span>
            </div>
            <div
              key={bookData.chapters[activeChapterIndex]?.id}
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => updateActiveChapterHtml(serializedEditorHtml())}
              onBlur={refreshImageInsertionSlots}
              onClick={(event) => {
                const target = event.target as Element;
                const slot = target.closest("[data-koba-image-slot]") as HTMLElement | null;
                if (slot) {
                  event.preventDefault();
                  chooseImageForSlot(slot);
                  return;
                }
                selectedFigureRef.current = target.closest("figure.koba-illustration") as HTMLElement | null;
                setHasSelectedIllustration(Boolean(selectedFigureRef.current));
              }}
              dangerouslySetInnerHTML={{ __html: editorHtml(bookData.chapters[activeChapterIndex]?.textContent || bookData.chapters[activeChapterIndex]?.content || "") }}
              className="koba-chapter-editor w-full min-h-[60vh] bg-transparent text-lg text-[#293A71] dark:text-white border-none outline-none leading-relaxed font-serif transition-colors [&_.koba-image-insertion-slot]:my-2 [&_.koba-image-insertion-slot]:block [&_.koba-image-insertion-slot]:w-full [&_.koba-image-insertion-slot]:rounded-lg [&_.koba-image-insertion-slot]:border [&_.koba-image-insertion-slot]:border-dashed [&_.koba-image-insertion-slot]:border-emerald-400 [&_.koba-image-insertion-slot]:bg-emerald-50 [&_.koba-image-insertion-slot]:px-3 [&_.koba-image-insertion-slot]:py-2 [&_.koba-image-insertion-slot]:font-sans [&_.koba-image-insertion-slot]:text-sm [&_.koba-image-insertion-slot]:font-bold [&_.koba-image-insertion-slot]:text-emerald-700 [&_.koba-image-insertion-slot]:transition-colors hover:[&_.koba-image-insertion-slot]:bg-emerald-100 focus:[&_.koba-image-insertion-slot]:outline-none focus:[&_.koba-image-insertion-slot]:ring-2 focus:[&_.koba-image-insertion-slot]:ring-emerald-500 [&_figure]:my-6 [&_figure]:max-w-full [&_img]:block [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_figcaption]:mt-2 [&_figcaption]:text-center [&_figcaption]:text-sm [&_figcaption]:text-slate-500"
              data-placeholder="Drafting continues..."
            />
            </section>
            )}
          </div>
        </div>
      </div>

      {/* ➡️ RIGHT PANEL: Gemini AI Suite */}
      {/* ➡️ RIGHT PANEL: Gemini AI Suite */}
      {aiPanelOpen && (
        <div className="w-[340px] shrink-0 overflow-x-hidden bg-[#f4f7ff] dark:bg-[#1E2B53] border-l border-[#d7e0f5] dark:border-[#293A71] flex flex-col animate-in slide-in-from-right-8 duration-300 transition-colors">
          <div className="p-5 border-b border-slate-200 dark:border-[#7C2B22]/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-500 dark:text-[#F9B437]" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-[#F9B437]">Studio Assistants</h2>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-5 space-y-8">
            
            {/* 🛡️ SECTION 1: STYLE GUARDRAILS */}
            <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-[#7C2B22]/40 rounded-xl">
              <div className="flex items-center">
                 <ShieldAlert className="w-3.5 h-3.5 mr-2 text-slate-500 dark:text-[#F9B437]" />
                 <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-[#F9B437]">Style Guardrails</h3>
                 <Tooltip text="Define universe rules. The AI will check these to prevent continuity errors or tone shifts."><span className="sr-only">Info</span></Tooltip>
               </div>
               
               <div className="space-y-2">
                  <label className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-[#F9B437]/60">Setting</label>
                  <input type="text" value={guardrails.setting} onChange={(e) => setGuardrails({...guardrails, setting: e.target.value})} placeholder="e.g. Cyberpunk London, 2099" className="w-full bg-white dark:bg-[#0b0f19] border border-slate-200 dark:border-[#7C2B22] rounded p-2 text-xs text-slate-700 dark:text-[#F9B437] focus:outline-none focus:border-[#F9B437]/50" />
               </div>

               <div className="space-y-2">
                  <label className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-[#F9B437]/60">Mood & Tone</label>
                  <input type="text" value={guardrails.mood} onChange={(e) => setGuardrails({...guardrails, mood: e.target.value})} placeholder="e.g. Gritty, melancholic, suspenseful" className="w-full bg-white dark:bg-[#0b0f19] border border-slate-200 dark:border-[#7C2B22] rounded p-2 text-xs text-slate-700 dark:text-[#F9B437] focus:outline-none focus:border-[#F9B437]/50" />
               </div>

               <div className="space-y-2">
                  <label className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-[#F9B437]/60">Reference Lore (Prior Books)</label>
                  <textarea value={guardrails.loreContext} onChange={(e) => setGuardrails({...guardrails, loreContext: e.target.value})} placeholder="e.g. Book 1 Context: Character 1 died. Faction A is currently in power." className="w-full h-20 bg-white dark:bg-[#0b0f19] border border-slate-200 dark:border-[#7C2B22] rounded p-2 text-xs text-slate-700 dark:text-[#F9B437] focus:outline-none focus:border-[#F9B437]/50 resize-none" />
               </div>
            </div>

            {/* 🏗️ SECTION 2: GENERATION TOOLS */}
            <div className="space-y-3">
               <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#F9B437]/70">Generation</h3>
              <button className="w-full bg-slate-50 dark:bg-[#7C2B22] border border-slate-200 dark:border-[#5a1f18] text-slate-700 dark:text-[#F9B437] hover:bg-slate-100 dark:hover:bg-[#5a1f18] px-4 py-3 rounded-xl text-xs font-bold text-left flex flex-col gap-1 transition-all shadow-sm">
                <span className="uppercase tracking-wider flex items-center justify-between w-full">
                  <span className="flex items-center gap-2"><List className="w-3.5 h-3.5"/> Story Architect</span>
                  <Tooltip text="Generates a full book outline based on your topic and title."><span className="sr-only">Info</span></Tooltip>
                </span>
                <span className="font-normal text-[10px] text-slate-500 dark:text-[#F9B437]/70 mt-1">Generate chapter summaries and structure.</span>
              </button>

              <button className="w-full bg-slate-50 dark:bg-[#7C2B22] border border-slate-200 dark:border-[#5a1f18] text-slate-700 dark:text-[#F9B437] hover:bg-slate-100 dark:hover:bg-[#5a1f18] px-4 py-3 rounded-xl text-xs font-bold text-left flex flex-col gap-1 transition-all shadow-sm">
                <span className="uppercase tracking-wider flex items-center justify-between w-full">
                  <span className="flex items-center gap-2"><Wand2 className="w-3.5 h-3.5"/> Unstuck Me</span>
                  <Tooltip text="Analyzes preceding text to suggest the next logical ideas."><span className="sr-only">Info</span></Tooltip>
                </span>
                <span className="font-normal text-[10px] text-slate-500 dark:text-[#F9B437]/70 mt-1">Generate the next logical paragraph.</span>
              </button>
            </div>

            {/* 🔎 SECTION 3: REFINEMENT TOOLS */}
            <div className="space-y-3">
               <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#F9B437]/70">Refinement</h3>
               <button className="w-full bg-slate-50 dark:bg-[#7C2B22] border border-slate-200 dark:border-[#5a1f18] text-slate-700 dark:text-[#F9B437] hover:bg-slate-100 dark:hover:bg-[#5a1f18] px-4 py-3 rounded-xl text-xs font-bold text-left flex flex-col gap-1 transition-all shadow-sm">
                <span className="uppercase tracking-wider flex items-center justify-between w-full">
                  <span className="flex items-center gap-2"><Activity className="w-3.5 h-3.5"/> Analyze</span>
                  <Tooltip text="Cross-references your draft against your Style Guardrails to flag continuity errors, dead character resurrections, and mood shifts."><span className="sr-only">Info</span></Tooltip>
                </span>
                <span className="font-normal text-[10px] text-slate-500 dark:text-[#F9B437]/70 mt-1">Check continuity and lore alignment.</span>
              </button>
               <button className="w-full bg-slate-50 dark:bg-[#7C2B22] border border-slate-200 dark:border-[#5a1f18] text-slate-700 dark:text-[#F9B437] hover:bg-slate-100 dark:hover:bg-[#5a1f18] px-4 py-3 rounded-xl text-xs font-bold text-left flex flex-col gap-1 transition-all shadow-sm">
                <span className="uppercase tracking-wider flex items-center justify-between w-full">
                  <span className="flex items-center gap-2"><Edit3 className="w-3.5 h-3.5"/> Polish</span>
                  <Tooltip text="Runs a deep grammatical pass, offering prose annotations and spell checks without changing your unique voice."><span className="sr-only">Info</span></Tooltip>
                </span>
                <span className="font-normal text-[10px] text-slate-500 dark:text-[#F9B437]/70 mt-1">Grammar, annotations, and spell check.</span>
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
