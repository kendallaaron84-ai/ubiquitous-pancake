"use client";

import React, { useState, useEffect, use } from "react";
import { db, storage } from "@/lib/firebase"; // 🚀 FIXED: Using your pre-configured instances directly
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage"; // 🚀 FIXED: Standard static imports
import { 
  ChevronLeft, UploadCloud, Mic, ShieldAlert, Lock, 
  CheckCircle2, FileAudio, FileVideo, Save,
  GripVertical, Trash2, Languages, RefreshCw, Fingerprint
} from "lucide-react";
import Link from "next/link";

export const dynamic = 'force-dynamic';

export default function ProductionStudio({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = use(params); 

  const [productData, setProductData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("media"); 
  const [mediaType, setMediaType] = useState("audio"); 
  const [vaultStatus, setVaultStatus] = useState("unprotected");
  const [encryptionLog, setEncryptionLog] = useState<string[]>([]);
  const [tracks, setTracks] = useState<any[]>([]);
  const [transcribingId, setTranscribingId] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) return;
    const fetchProduct = async () => {
      try {
        const docRef = doc(db, "products", assetId); 
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProductData(data);
          if (data.vaultStatus) setVaultStatus(data.vaultStatus);
          if (data.studioTracks) setTracks(data.studioTracks);
          if (data.mediaType) setMediaType(data.mediaType);
        } else {
          setProductData({ title: "Unknown Asset", type: "Audiobook" });
        }
      } catch (error) {
        console.error("Error fetching product:", error);
      }
    };
    fetchProduct();
  }, [assetId]);

  // Unified save handler to commit current track array to Firestore
  const saveTracksToDatabase = async (currentTracks: any[]) => {
    try {
      const docRef = doc(db, "products", assetId); 
      await updateDoc(docRef, { 
        studioTracks: currentTracks,
        mediaType: mediaType,
        vaultStatus: vaultStatus
      });
      console.log("💾 Firestore collection updated successfully.");
    } catch (e) {
      console.error("Failed to sync studio context to Firestore:", e);
    }
  };

  const handleSaveConfiguration = async () => {
    await saveTracksToDatabase(tracks);
    alert("Configuration synchronized successfully!");
  };

  const addNewTrackRow = () => {
    const nextIndex = tracks.length + 1;
    const newTrack = {
      id: `track_${Date.now()}`,
      chapterNumber: nextIndex,
      title: `Chapter ${nextIndex}: Untitled Segment`,
      fileName: "No file attached",
      uploadStatus: "empty", 
      isTranscribed: false,
      transcriptUrl: "",
      url: "" // Holds secure link for transcribe API
    };
    setTracks([...tracks, newTrack]);
  };

  const moveTrackUp = (index: number) => {
    if (index === 0) return;
    const updated = [...tracks];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    const reIndexed = updated.map((t, idx) => ({ ...t, chapterNumber: idx + 1 }));
    setTracks(reIndexed);
  };

  const triggerTranscription = async (trackId: string) => {
    if (transcribingId) return;
    setTranscribingId(trackId);

    try {
      const response = await fetch(`/api/studio/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId, assetId: assetId }),
      });

      if (!response.ok) throw new Error("Transcription pipeline connection failure.");
      const data = await response.json();

      if (data.success) {
        setTracks(prev => prev.map(t => {
          if (t.id === trackId) {
            return { 
              ...t, 
              isTranscribed: true, 
              transcriptUrl: data.transcriptUrl || ""
            };
          }
          return t;
        }));
        alert("Transcription completed successfully!");
      }
    } catch (error) {
      console.error("Audio-to-Text Pipeline Interrupted:", error);
      alert("Transcription failed. Verify the file was completely uploaded first.");
    } finally {
      setTranscribingId(null);
    }
  };

  const runVoiceVaultEncryption = async () => {
    setVaultStatus("encrypting");
    setEncryptionLog(["Opening secure environment container..."]);
    
    try {
      const response = await fetch(`/api/studio/vault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId })
      });
      
      const data = await response.json();
      if (data.success) {
        setEncryptionLog(prev => [...prev, "SUCCESS: Core signatures verified."]);
        setVaultStatus("secured");
      } else {
        setVaultStatus("unprotected");
      }
    } catch (e) {
      setVaultStatus("unprotected");
    }
  };

  if (!productData) {
    return <div className="h-screen flex items-center justify-center bg-slate-100 text-slate-800 font-mono">Initializing Light Studio Viewport...</div>;
  }

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 overflow-hidden font-sans select-none">
      
      {/* LEFT PANEL: Sidebar Navigation */}
      <div className="w-64 bg-white border-r border-slate-300 flex flex-col shrink-0 shadow-sm">
        <div className="p-4 border-b border-slate-200 flex items-center gap-3">
          <Link href="/products" className="p-2 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 text-slate-700" />
          </Link>
          <div className="flex flex-col overflow-hidden">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Master Deck</span>
            <span className="text-xs font-black uppercase tracking-wider text-slate-800 truncate">{productData.title}</span>
          </div>
        </div>

        <div className="flex-1 p-4 space-y-2 bg-slate-50">
          <button onClick={() => setActiveTab("media")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${activeTab === "media" ? "bg-slate-800 text-white border-slate-900 shadow-sm" : "text-slate-600 bg-white border-slate-200 hover:bg-slate-100"}`}>
            <Mic className="w-4 h-4 text-orange-500" /> Production Manifest
          </button>
          <button onClick={() => setActiveTab("vault")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${activeTab === "vault" ? "bg-emerald-700 text-white border-emerald-800 shadow-sm" : "text-slate-600 bg-white border-slate-200 hover:bg-slate-100"}`}>
            <Lock className="w-4 h-4 text-emerald-600" /> Cloud Voice Vault
          </button>
        </div>
      </div>

      {/* CENTER PANEL: Main Console Canvas */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-slate-50">
        
        {/* Top Header Controls Bar */}
        <div className="h-16 border-b border-slate-300 bg-white flex items-center justify-between px-8 absolute top-0 w-full z-10 shadow-xs">
          <div className="flex items-center gap-2 bg-slate-200 p-1 rounded-xl border border-slate-300">
            <button onClick={() => setMediaType("audio")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border ${mediaType === 'audio' ? 'bg-slate-800 text-white border-slate-900' : 'text-slate-600 border-transparent hover:bg-slate-300'}`}>
              <FileAudio className="w-3.5 h-3.5 text-orange-500" /> Audio Mode
            </button>
            <button onClick={() => setMediaType("video")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border ${mediaType === 'video' ? 'bg-slate-800 text-white border-slate-900' : 'text-slate-600 border-transparent hover:bg-slate-300'}`}>
              <FileVideo className="w-3.5 h-3.5 text-blue-500" /> Video Mode
            </button>
          </div>

          <button onClick={handleSaveConfiguration} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md">
            <Save className="w-3.5 h-3.5" /> Deploy Metadata
          </button>
        </div>

        {/* Content Viewport Frame */}
        <div className="flex-1 overflow-y-auto px-8 pt-24 pb-12">
          <div className="max-w-4xl mx-auto">
            
            {activeTab === "media" && (
              <div className="space-y-6">
                <div className="flex justify-between items-end border-b border-slate-200 pb-4">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight capitalize">{mediaType} Segment Assignment</h2>
                    <p className="text-sm text-slate-500 mt-1">Upload discrete blocks for book chapters. Click rows to anchor computer audio files.</p>
                  </div>
                  <button onClick={addNewTrackRow} className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all border border-slate-900">
                    + Add New Chapter Row
                  </button>
                </div>

                <div className="space-y-3">
                  {tracks.length === 0 ? (
                    <div onClick={addNewTrackRow} className="w-full h-40 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center cursor-pointer bg-white hover:border-slate-400 transition-all shadow-xs">
                      <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                      <span className="text-xs font-bold text-slate-500">No tracks provisioned. Click here to initialize row mappings.</span>
                    </div>
                  ) : (
                    tracks.map((track, index) => (
                      <div key={track.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 shadow-xs hover:border-slate-400 transition-all">
                        <GripVertical className="w-4 h-4 text-slate-400 cursor-grab" />
                        
                        <div className="w-8 h-8 bg-slate-800 text-white rounded-lg flex items-center justify-center text-xs font-mono font-bold">
                          {track.chapterNumber}
                        </div>

                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input 
                            type="text" 
                            value={track.title} 
                            onChange={(e) => {
                              const updated = [...tracks];
                              updated[index].title = e.target.value;
                              setTracks(updated);
                            }}
                            className="bg-slate-50 border border-slate-300 p-2.5 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-slate-500" 
                            placeholder="Chapter Title Name"
                          />
                          
                          <div 
                            onClick={() => document.getElementById(`file-upload-injector-${track.id}`)?.click()}
                            className="text-xs text-slate-700 flex items-center gap-2 font-mono bg-slate-100 hover:bg-slate-200 px-4 rounded-lg border border-slate-300 cursor-pointer transition-colors truncate select-none shadow-inner"
                          >
                            <input 
                              type="file"
                              id={`file-upload-injector-${track.id}`}
                              accept={mediaType === 'audio' ? 'audio/*' : 'video/*'}
                              className="hidden"
                              onChange={(e) => {
                                const selectedFile = e.target.files?.[0];
                                if (!selectedFile) return;

                                // 1. Put UI immediately into loading state
                                setTracks(prev => prev.map(t => t.id === track.id ? { ...t, uploadStatus: "uploading", fileName: "Streaming..." } : t));

                                // 2. Fire reliable upload stream to Firebase Storage
                                const storagePath = `studio/${assetId}/${Date.now()}_${selectedFile.name}`;
                                const storageRef = ref(storage, storagePath);
                                const uploadTask = uploadBytesResumable(storageRef, selectedFile);

                                uploadTask.on(
                                  "state_changed",
                                  null,
                                  (error) => {
                                    console.error("Storage upload error:", error);
                                    setTracks(prev => prev.map(t => t.id === track.id ? { ...t, uploadStatus: "empty", fileName: "Upload Failed" } : t));
                                  },
                                  async () => {
                                    // 3. Extract the clean download token URL
                                    const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                                    
                                    const updatedTracks = tracks.map(t => t.id === track.id ? { 
                                      ...t, 
                                      uploadStatus: "success", 
                                      fileName: selectedFile.name,
                                      url: downloadUrl // Mapped for api/studio/transcribe
                                    } : t);

                                    setTracks(updatedTracks);
                                    
                                    // 🚀 4. AUTO-SAVE: Commit straight to Firestore collection instantly
                                    await saveTracksToDatabase(updatedTracks);
                                  }
                                );
                              }}
                            />
                            <span className={`w-2.5 h-2.5 rounded-full ${
                              track.uploadStatus === 'success' ? 'bg-emerald-500' : 
                              track.uploadStatus === 'uploading' ? 'bg-amber-500 animate-pulse' : 'bg-slate-300'
                            }`} />
                            <span className="font-bold truncate">
                              {track.uploadStatus === 'success' ? `✅ ${track.fileName}` : track.uploadStatus === 'uploading' ? `⚡ Uploading...` : `📁 Click to Attach File...`}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button onClick={() => moveTrackUp(index)} disabled={index === 0} className="p-2 text-slate-400 hover:text-slate-800 disabled:opacity-20 transition-colors">
                            <RefreshCw className="w-3.5 h-3.5 rotate-180" />
                          </button>

                          <button 
                            onClick={() => triggerTranscription(track.id)}
                            disabled={transcribingId !== null || track.uploadStatus !== 'success'}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border ${track.uploadStatus !== 'success' ? 'opacity-30 cursor-not-allowed bg-slate-100 text-slate-400' : track.isTranscribed ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'}`}
                          >
                            <Languages className="w-3.5 h-3.5" />
                            {transcribingId === track.id ? "Syncing..." : track.isTranscribed ? "Synced" : "Transcribe"}
                          </button>

                          <button 
                            onClick={() => {
                              const updated = tracks.filter(t => t.id !== track.id).map((t, idx) => ({ ...t, chapterNumber: idx + 1 }));
                              setTracks(updated);
                              saveTracksToDatabase(updated);
                            }}
                            className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "vault" && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 pb-4">
                  <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                    <ShieldAlert className="w-6 h-6 text-emerald-600" /> Cryptographic Voice Vault
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">Locks down ownership signature schemas across active distribution tracks.</p>
                </div>

                {vaultStatus === "unprotected" && (
                  <div className="bg-white border border-slate-200 p-8 rounded-2xl text-center space-y-4 shadow-sm">
                    <Fingerprint className="w-12 h-12 text-slate-400 mx-auto" />
                    <div>
                      <h3 className="text-base font-bold text-slate-800">Run Protection Matrix</h3>
                      <p className="text-xs text-slate-500 mt-1">{tracks.length} track components staged for encryption pipelines.</p>
                    </div>
                    <button onClick={runVoiceVaultEncryption} disabled={tracks.length === 0} className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md disabled:opacity-40">
                      Lock & Seal Chapters
                    </button>
                  </div>
                )}

                {vaultStatus === "encrypting" && (
                  <div className="bg-slate-900 border border-slate-950 p-6 rounded-xl space-y-4 font-mono text-xs text-slate-300 shadow-inner">
                    {encryptionLog.map((log, index) => (
                      <div key={index} className="flex gap-2 text-[11px]"><span className="text-emerald-400">{">"}</span> {log}</div>
                    ))}
                  </div>
                )}

                {vaultStatus === "secured" && (
                  <div className="bg-emerald-100 border border-emerald-300 p-8 rounded-2xl text-center space-y-4 shadow-sm">
                    <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                    <div>
                      <h3 className="text-lg font-black text-emerald-800">Audio Waveforms Locked & Authorized</h3>
                      <p className="text-xs text-emerald-700 font-medium mt-1">C2PA asset protection matrix tags passed down to live store pipelines successfully.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}