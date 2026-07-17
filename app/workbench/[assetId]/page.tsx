"use client";

import React, { useState, useEffect, use } from "react";
import { db } from "@/core/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Save, ChevronLeft, Wand2, List, Sparkles, Info, Activity, Edit3, ShieldAlert, Settings, X, Key } from "lucide-react";
import Link from "next/link";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { toast } from "@/components/ui/use-toast";

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
  
  // 🛡️ Style Guardrails State
  const [guardrails, setGuardrails] = useState({
    setting: "",
    mood: "",
    loreContext: ""
  });

  // 🔑 NEW: BYOK (Bring Your Own Key) & Model Selection State
  const [activeModel, setActiveModel] = useState("anthropic"); // default to claude, for example
    const [apiKeys, setApiKeys] = useState({
  });

  useEffect(() => {
    if (!assetId) return;
    
    const fetchManuscript = async () => {
      try {
        console.log("🎯 Workbench attempting connection for assetId:", assetId);
        const docRef = doc(db, "products", assetId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          if (!data.chapters || data.chapters.length === 0) {
            data.chapters = [{ id: `ch_1_${assetId}`, title: "Chapter 1", textContent: "" }];
          }
          setBookData(data);
          if (data.guardrails) setGuardrails(data.guardrails);
          if (data.apiKeys) setApiKeys(data.apiKeys);
        } else {
          console.warn("⚠️ Document ID not found in products collection. Loading initialization state.");
          setBookData({
            title: "Sandbox Mode: Asset Not Found",
            type: "ebook",
            chapters: [{ id: `ch_1_${assetId}`, title: "Chapter 1 Initializer", textContent: "The workbench compiled, but could not locate this book record in your Firestore database. Click 'Save Draft' to initialize a fresh record mapping." }]
          });
        }
      } catch (error: any) {
        // 🚀 FALLBACK 2: Database Rules / Network Connection Blocked
        console.error("❌ Firestore connection failed:", error);
        setBookData({
          title: "Offline Vault Mode",
          type: "E-Book",
          chapters: [{ id: `ch_1_${assetId}`, title: "Chapter 1 (Offline)", textContent: `Database handshake failed. Reason: ${error?.message || "Unknown Rule Block"}` }]
        });
      }
    };
    
    fetchManuscript();
  // ... Your existing fetchManuscript useEffect ends here ...
  }, [assetId]);

  const handleMasteredUpload = async (e: React.ChangeEvent<HTMLInputElement>, chapterId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 1. Point to the "Production-Ready" folder in Firebase Storage
    const storageInstance = getStorage();
    const productionPath = `production-vault/${assetId}/${chapterId}_mastered.mp3`;
    const storageRef = ref(storageInstance, productionPath);

    // 2. Stream the file directly
    toast({ title: "Mastered Upload", description: "Injecting production-ready audio into the vault..." });
    
    const uploadTask = uploadBytesResumable(storageRef, file);
    
    uploadTask.on("state_changed", null, (err) => {
        toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
    }, async () => {
        const audioUrl = await getDownloadURL(uploadTask.snapshot.ref);
        
        // 🎯 Redirected to products with an idempotent setDoc merge
        const docRef = doc(db, "products", assetId);
        await setDoc(docRef, {
            [`audioMap.${chapterId}`]: audioUrl,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        
        toast({ title: "Production Success", description: "Audio mastered and vaulted." });
    });
};

  const handleSave = async () => {
  if (!bookData) return;
  setIsSaving(true);
  try {
    const docRef = doc(db, "products", assetId);
    
    const sourceChapters = Array.isArray(bookData.chapters) ? bookData.chapters : [];
    const formattedChapters = sourceChapters.map((ch: any, index: number) => ({
        id: ch.id || `ch_${index + 1}_${assetId}`,
        title: ch.title || `Chapter ${index + 1}`,
        textContent: ch.textContent || ch.content || "" 
    }));

    await setDoc(docRef, { 
        assetKey: assetId,
        id: assetId,
        type: "ebook",
        chapters: formattedChapters,
        ebookPayload: {
            fontPreference: bookData.ebookPayload?.fontPreference || "Atkinson Hyperlegible",
            chapters: formattedChapters
        },
        guardrails: guardrails,
        apiKeys: apiKeys,
        updatedAt: new Date().toISOString()
    }, { merge: true });

    setBookData((current: any) => ({
      ...current,
      chapters: formattedChapters,
      ebookPayload: {
        ...current?.ebookPayload,
        fontPreference: current?.ebookPayload?.fontPreference || "Atkinson Hyperlegible",
        chapters: formattedChapters
      }
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
    <div className="flex h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-900 dark:text-slate-200 overflow-hidden font-sans transition-colors duration-300 relative">
      
      {/* ⬅️ LEFT PANEL: Manuscript Navigation */}
      <div className="w-64 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-[#7C2B22]/30 flex flex-col transition-colors duration-300 shrink-0">
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
      <div className="flex-1 flex flex-col relative">
        <div className="absolute top-0 w-full p-4 flex justify-end gap-3 z-10 pointer-events-none">
          <div className="pointer-events-auto flex gap-2">

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
              className="w-full bg-transparent text-3xl font-bold text-slate-900 dark:text-[#F9B437] border-none outline-none focus:ring-0 placeholder-slate-400 dark:placeholder-[#F9B437]/30 transition-colors"
              placeholder="Chapter Title"
            />
            <textarea
              // 🚀 Bind directly to textContent
              value={bookData.chapters[activeChapterIndex]?.textContent || bookData.chapters[activeChapterIndex]?.content || ""}
              onChange={(e) => {
                const newChapters = [...bookData.chapters];
                newChapters[activeChapterIndex].textContent = e.target.value;
                setBookData({ ...bookData, chapters: newChapters });
              }}
              className="w-full h-[60vh] bg-transparent text-lg text-slate-700 dark:text-[#F9B437] border-none outline-none focus:ring-0 resize-none leading-relaxed font-serif placeholder-slate-400 dark:placeholder-[#F9B437]/20 transition-colors"
              placeholder="Drafting continues..."
            />
          </div>
        </div>
      </div>

      {/* ➡️ RIGHT PANEL: Gemini AI Suite */}
      {/* ➡️ RIGHT PANEL: Gemini AI Suite */}
      {aiPanelOpen && (
        <div className="w-[340px] shrink-0 overflow-x-hidden bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-[#7C2B22]/30 flex flex-col animate-in slide-in-from-right-8 duration-300 transition-colors">
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