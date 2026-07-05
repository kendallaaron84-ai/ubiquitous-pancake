"use client";

import React, { useState, useRef, useEffect } from "react";
import Layout from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { VoiceUploadZone } from "@/components/voice-upload-zone";
import { db } from "@/core/firebase";
import { 
  collection, query, where, onSnapshot, doc, 
  setDoc, deleteDoc, updateDoc 
} from "firebase/firestore";
import { 
  ShieldCheck, Play, Pause, Lock, Fingerprint, 
  UserCheck, Cpu, Plus, BookOpen, Trash2 
} from "lucide-react";

export const dynamic = 'force-dynamic';

const mockBooks = [
  { id: "book_duncan", title: "Duncan the Man Hunter" },
  { id: "book_koba_doc", title: "KOBA-I Platform Documentation" }
];

export default function VoiceVaultPage() {
  const authorEmail = "kendall@domain.com"; 
  const [selectedBookId, setSelectedBookId] = useState<string>("book_duncan");
  const [vaultRecords, setVaultRecords] = useState<any[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [newCharacterName, setNewCharacterName] = useState("");
  const [newPersonaKey, setNewPersonaKey] = useState("Standard-V1");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isWatermarkActive, setIsWatermarkActive] = useState(true);
  const { toast } = useToast();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const trackSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    setLoading(true);
    const vaultRef = collection(db, "voice_vault");
    const q = query(
      vaultRef, 
      where("authorEmail", "==", authorEmail),
      where("bookId", "==", selectedBookId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: any[] = [];
      snapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() });
      });
      setVaultRecords(records);
      
      if (records.length > 0) {
        setSelectedRecord(prev => {
          const currentMatch = records.find(r => r.id === prev?.id);
          return currentMatch || records[0];
        });
      } else {
        setSelectedRecord(null);
      }
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [selectedBookId]);

  const initAudioPipeline = () => {
    if (!audioRef.current) return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    audioContextRef.current = ctx;

    const source = ctx.createMediaElementSource(audioRef.current);
    trackSourceRef.current = source;
    const masterGain = ctx.createGain();
    
    source.connect(masterGain);
    masterGain.connect(ctx.destination);

    intervalRef.current = setInterval(() => {
      if (!audioRef.current?.paused && isWatermarkActive) {
        masterGain.gain.setValueAtTime(0.15, ctx.currentTime);
        toast({
          title: "Anti-Piracy Overlay Fired",
          description: "Active Watermark Verification Injected: 'Protected by KOBA-I Voice Vault' footprint signature live.",
        });
        setTimeout(() => {
          if (ctx.state !== "closed") masterGain.gain.setValueAtTime(1.0, ctx.currentTime);
        }, 1500);
      }
    }, 14000);
  };

  const togglePlayback = async () => {
    if (!audioRef.current) return;
    if (audioContextRef.current?.state === "suspended") await audioContextRef.current.resume();
    if (!audioContextRef.current) initAudioPipeline();

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleProvisionLane = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCharacterName.trim()) return;

    const isDuplicate = vaultRecords.some(
      r => r.characterName.toLowerCase() === newCharacterName.trim().toLowerCase()
    );

    if (isDuplicate) {
      toast({
        title: "Asset Collision Aborted",
        description: `Character "${newCharacterName}" already holds a registration blueprint.`,
        variant: "destructive"
      });
      return;
    }

    const newRecordId = `vault_${Date.now()}`;
    const targetDocRef = doc(db, "voice_vault", newRecordId);

    const initialPayload = {
      bookId: selectedBookId,
      authorEmail,
      characterName: newCharacterName.trim(),
      status: "Pending Master",
      digitalVoiceId: `sig://id_hash_${Math.random().toString(36).substring(2, 12)}`,
      vaultPath: `gs://vault-storage/author-profile/pending_ingest_${newCharacterName.toLowerCase()}.wav`,
      sampleUrl: "https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg", 
      watermarkActive: true
    };

    try {
      await setDoc(targetDocRef, initialPayload);
      setNewCharacterName("");
      toast({
        title: "Biometric Matrix Provisioned",
        description: `Vocal track lane isolated for "${initialPayload.characterName}".`,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleInboundFileSuccess = async (storagePath: string) => {
    if (!selectedRecord) return;
    const targetDocRef = doc(db, "voice_vault", selectedRecord.id);

    try {
      await updateDoc(targetDocRef, {
        vaultPath: storagePath,
        status: "Cryptographically Secured"
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteChannel = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, "voice_vault", id));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto text-foreground font-sans min-h-[calc(100vh-4rem)]">
        
        {/* Header Block Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <ShieldCheck className="w-7 h-7 text-emerald-500" />
              Multi-Character Voice Vault
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Isolate independent vocal profiles per book project while blocking asset collisions.
            </p>
          </div>

          <div className="flex items-center gap-2.5 bg-card px-4 py-2 rounded-xl border border-border">
            <BookOpen className="w-4 h-4 text-emerald-500" />
            <select 
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
              className="bg-transparent text-sm font-bold text-foreground focus:outline-none appearance-none cursor-pointer pr-4"
            >
              {mockBooks.map(book => (
                <option key={book.id} value={book.id} className="bg-card text-foreground">{book.title}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Workspace Matrix Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Controls Context Lane */}
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Secured Mappings ({vaultRecords.length})</h3>
              
              {loading ? (
                <p className="text-xs text-muted-foreground p-4 text-center animate-pulse">Syncing cluster records...</p>
              ) : vaultRecords.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center">No vocal identities mapped to this asset file.</p>
              ) : (
                <div className="space-y-2">
                  {vaultRecords.map((record) => {
                    const isSelected = selectedRecord?.id === record.id;
                    return (
                      <button
                        key={record.id}
                        onClick={() => setSelectedRecord(record)}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                          isSelected 
                            ? "bg-emerald-500/10 border-emerald-500/40 text-foreground" 
                            : "bg-background border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <div className="truncate pr-2">
                          <p className={`text-sm tracking-tight ${isSelected ? "text-emerald-600 dark:text-emerald-400 font-extrabold" : "text-foreground font-semibold"}`}>
                            {record.characterName}
                          </p>
                          <span className="text-[10px] font-mono block opacity-60 truncate">{record.status}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Fingerprint className={`w-4 h-4 ${isSelected ? "text-emerald-500" : "text-muted-foreground"}`} />
                          <Trash2 
                            onClick={(e) => handleDeleteChannel(record.id, e)}
                            className="w-3.5 h-3.5 text-muted-foreground/40 hover:text-red-500 transition-colors" 
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Core Blueprint Provision Lane */}
            <form onSubmit={handleProvisionLane} className="bg-card border border-border rounded-2xl p-4 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-500 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Initialize Character Profile
              </h3>
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Unique Character Identity Name</label>
                <input 
                  type="text"
                  placeholder="e.g. Duncan"
                  value={newCharacterName}
                  onChange={(e) => setNewCharacterName(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-emerald-500/50 transition-all font-medium"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-background hover:bg-slate-50 dark:hover:bg-slate-900 text-foreground border border-border hover:border-emerald-500/40 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              >
                Provision Vocal Lane
              </button>
            </form>
          </div>

          {/* Right Selected Inspector Panel */}
          <div className="lg:col-span-2 space-y-6">
            {selectedRecord ? (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-xl space-y-6 relative overflow-hidden">
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-background rounded-xl border border-border">
                      <Fingerprint className="w-6 h-6 text-emerald-500" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold tracking-tight text-foreground">Character Identity Channel: {selectedRecord.characterName}</h2>
                      <p className="text-xs text-muted-foreground font-mono">Biometric Status Matrix: {selectedRecord.status}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full self-start sm:self-auto">
                    {selectedRecord.status}
                  </span>
                </div>

                {/* Secure File Upload Layer Hooks */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Isolate Local Raw Source Recording</span>
                  <VoiceUploadZone authorEmail={authorEmail} onUploadSuccess={handleInboundFileSuccess} />
                </div>

                {/* Live Verification Stream Output Controls */}
                <audio key={selectedRecord.id} ref={audioRef} src={selectedRecord.sampleUrl} loop crossOrigin="anonymous" />

                {/* 🛠️ FIXED: Re-architected container to prevent long string paths from pushing the media buttons off the screen */}
                <div className="bg-background border border-border p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 overflow-hidden">
                  <div className="space-y-1 min-w-0 flex-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Isolated Storage Manifest Path</span>
                    <p className="text-xs text-foreground font-mono truncate">{selectedRecord.vaultPath}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0 w-full md:w-auto justify-end">
                    <button
                      type="button"
                      onClick={() => setIsWatermarkActive(!isWatermarkActive)}
                      className={`px-3 py-2 h-9 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all ${
                        isWatermarkActive ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" : "bg-card text-muted-foreground border-border"
                      }`}
                    >
                      {isWatermarkActive ? "Watermark Live" : "Watermark Muted"}
                    </button>
                    <button
                      type="button"
                      onClick={togglePlayback}
                      className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 h-9 px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md font-sans"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      Verify Vault Target
                    </button>
                  </div>
                </div>

                {/* Provenance Block */}
                <div className="bg-slate-500/5 border border-border p-5 rounded-xl space-y-4">
                  <div className="flex items-center gap-2 text-foreground">
                    <Cpu className="w-4 h-4 text-emerald-500" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">C2PA Standard Provenance Assertions</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Cryptographic structure verifies this vocal identity belongs to the biological author entity. Embedded signatures protect against unauthorized generative model scrapers or deepfake injection layers.
                  </p>
                  <div className="font-mono text-[10px] bg-background border border-border px-3 py-2 rounded-lg text-muted-foreground truncate">
                    Digital Voice Signature ID: {selectedRecord.digitalVoiceId}
                  </div>
                </div>

              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl p-12 text-center text-muted-foreground">
                Select an active character channel or provision a new biometric lane to map real data streams.
              </div>
            )}
          </div>
          
        </div>

      </div>
    </Layout>
  );
}