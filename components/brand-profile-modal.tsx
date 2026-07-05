"use client";

import React, { useState, useEffect } from "react";
// 🔑 Added DialogDescription to fix your yellow console warning
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { User, BookOpen, Save, UploadCloud, Settings, Loader2, Trash2 } from "lucide-react";
import { db, storage } from "@/core/firebase"; 
import { ref, uploadBytes } from "firebase/storage";
import { doc, getDoc, setDoc, collection, addDoc, getDocs, deleteDoc } from "firebase/firestore";
// 🔑 Imported the Auth modules
import { getAuth, onAuthStateChanged } from "firebase/auth";

interface Manuscript {
  id: string;
  title: string;
  genre: string;
}

export function BrandProfileModal() {
  // ==========================================
  // 1. STATE DECLARATIONS (No hardcoded emails)
  // ==========================================
  const [authorEmail, setAuthorEmail] = useState<string | null>(null);
  const [brandMode, setBrandMode] = useState<"personal" | "book">("personal");
  
  const [coreValues, setCoreValues] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newGenre, setNewGenre] = useState("");
  const [file, setFile] = useState<File | null>(null); 
  const [bookSaving, setBookSaving] = useState(false);

  // ==========================================
  // 2. EFFECTS (Listening for Auth & Data)
  // ==========================================
  
  // Effect A: Listen for the logged-in user
  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user && user.email) {
            setAuthorEmail(user.email);
        } else {
            setAuthorEmail(null);
        }
    });
    return () => unsubscribe();
  }, []);

  // Effect B: Fetch data ONLY after we have the authorEmail
  useEffect(() => {
    if (!authorEmail) return; // Safety check

    async function loadData() {
      try {
        const pRef = doc(db, "users", authorEmail as string);
        const pSnap = await getDoc(pRef);
        if (pSnap.exists()) {
          const d = pSnap.data();
          setCoreValues(d.coreValues || "");
          setToneOfVoice(d.toneOfVoice || "");
        }
    
        const mSnap = await getDocs(collection(db, "users", authorEmail as string, "manuscripts"));
        setManuscripts(mSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Manuscript)));
      } catch (e) {
        console.error(e);
      }
    }
    loadData();
  }, [authorEmail]);

  // ==========================================
  // 3. CONDITIONAL RETURN (The Loading State)
  // ==========================================
  // If Firebase is still verifying the user, show a disabled button so the UI doesn't break
  if (!authorEmail) {
      return (
          <Button variant="outline" size="sm" disabled className="w-full justify-start gap-2 border-border text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Verifying Session...
          </Button>
      );
  }

  // ==========================================
  // 4. FUNCTIONS (Database Actions)
  // ==========================================
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    try {
      await setDoc(doc(db, "users", authorEmail), { coreValues, toneOfVoice }, { merge: true });
      alert("Brand profile updated!");
    } catch (err) {
      alert("Failed to save profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDeleteManuscript = async (id: string, title: string) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return;
    try {
      await deleteDoc(doc(db, "users", authorEmail, "manuscripts", id));
      setManuscripts(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      console.error("Error deleting manuscript:", error);
      alert("Failed to delete manuscript.");
    }
  };

  const handleBookSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const genresArray = newGenre.split(",").map(g => g.trim()).filter(g => g !== "");
    if (genresArray.length > 3) {
      alert("Please limit the genre to a maximum of 3 comma-separated tags.");
      return;
    }

    if (!newTitle.trim() || !newGenre.trim() || !file) {
      alert("Please fill out all fields and select a .txt manuscript lore file.");
      return;
    }

    setBookSaving(true);
    try {
      const storagePath = `users/${authorEmail}/manuscripts/${Date.now()}_${file.name}`;
      const fileRef = ref(storage, storagePath);
      
      const uploadSnapshot = await uploadBytes(fileRef, file);
      const gcsUri = `gs://${uploadSnapshot.metadata.bucket}/${uploadSnapshot.metadata.fullPath}`;

      const docRef = await addDoc(collection(db, "users", authorEmail, "manuscripts"), {
        title: newTitle.trim(),
        genre: genresArray.join(", "), 
        fileName: file.name,
        gcs_vector_uri: gcsUri, 
        createdAt: new Date()
      });

      alert("Manuscript context loaded successfully!");
      setNewTitle("");
      setNewGenre("");
      setFile(null);
      
      setManuscripts(prev => [...prev, { id: docRef.id, title: newTitle.trim(), genre: genresArray.join(", ") }]);
    } catch (err) {
      alert("Failed to save book context.");
    } finally {
      setBookSaving(false);
    }
  };

  // ==========================================
  // 5. THE JSX RENDER
  // ==========================================
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2 border-border text-foreground hover:bg-muted">
          <Settings className="w-4 h-4 text-primary" /> Brand Profiles & Context
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px] bg-card text-card-foreground border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white font-bold tracking-tight flex items-center gap-2">
            Brand Identity Configuration
          </DialogTitle>
        </DialogHeader>

        <div className="flex border-b border-border mt-2">
          <button type="button" onClick={() => setBrandMode("personal")} className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-colors ${brandMode === "personal" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <User className="w-3.5 h-3.5" /> Core Profile
          </button>
          <button type="button" onClick={() => setBrandMode("book")} className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-colors ${brandMode === "book" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <BookOpen className="w-3.5 h-3.5" /> Book Context
          </button>
        </div>

        <div className="py-3">
          {brandMode === "personal" ? (
            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Core Values & Identity</label>
                <textarea value={coreValues} onChange={(e) => setCoreValues(e.target.value)} className="w-full min-h-[80px] p-2 rounded border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Brand values..."/>
              </div>
 
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Tone of Voice Guidelines</label>
                <textarea value={toneOfVoice} onChange={(e) => setToneOfVoice(e.target.value)} className="w-full min-h-[80px] p-2 rounded border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Tone style..."/>
              </div>
              <div className="flex justify-end pt-1">
                <Button type="submit" size="sm" disabled={profileSaving} className="bg-primary text-primary-foreground text-xs font-bold gap-1">
                  {profileSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Settings
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Registered Lore Vaults</label>
                <div className="max-h-[140px] overflow-y-auto border border-border rounded divide-y divide-border bg-background">
                  {manuscripts.length === 0 ? (
                    <p className="p-3 text-[11px] text-muted-foreground text-center">No reference books added yet.</p>
                  ) : (
                    manuscripts.map(m => (
                      <div key={m.id} className="p-2 flex items-center justify-between text-xs text-foreground group hover:bg-muted/30 transition-colors">
                        <div className="flex flex-col gap-0.5">
                            <span className="font-medium truncate max-w-[200px]">{m.title}</span>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.genre}</span>
                        </div>
                        
                        {/* 🗑️ THE DELETE BUTTON */}
                        <button 
                            type="button"
                            onClick={() => handleDeleteManuscript(m.id, m.title)}
                            className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-all opacity-0 group-hover:opacity-100"
                            title="Delete Manuscript"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <form onSubmit={handleBookSubmit} className="space-y-3 border-t border-border pt-3">
                <p className="text-[11px] font-semibold text-foreground">Link Context Manuscript</p>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Book Title" className="p-2 border border-border rounded bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
                  <input type="text" required value={newGenre} onChange={(e) => setNewGenre(e.target.value)} placeholder="Up to 3 Genres (comma-separated)" className="p-2 border border-border rounded bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                
                {/* 🔒 STRICT .TXT FILE PORTAL */}
                <div className="p-2 rounded border border-dashed border-border bg-background text-xs">
                  <input 
                    type="file" 
                    accept=".txt, text/plain" 
                    required 
                    onChange={(e) => setFile(e.target.files?.[0] || null)} 
                    className="text-muted-foreground text-[11px] cursor-pointer file:mr-2 file:py-0.5 file:px-1.5 file:rounded file:border-0 file:text-xs file:bg-secondary file:text-secondary-foreground" 
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <Button type="submit" size="sm" disabled={bookSaving} className="bg-primary text-primary-foreground text-xs h-8 gap-1">
                    {bookSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />} Inject Lore Context
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}