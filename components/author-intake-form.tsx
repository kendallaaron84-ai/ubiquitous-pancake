"use client";

import React, { useState } from "react";
import { db, auth } from "@/lib/firebase";
// 🚀 CHANGED: Using doc and setDoc instead of collection and addDoc
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, FileText, Briefcase, Users, LayoutTemplate } from "lucide-react";
import { VoiceUploadZone } from "./voice-upload-zone"; // 🚀 Added import

export function AuthorIntakeForm() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 🚀 ADDED: fileUrl to state so the form remembers the audio/video file
  const [formData, setFormData] = useState({
    title: "",
    brand: "personal",
    audience: "",
    description: "",
    fileUrl: "" 
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title) {
      toast({ title: "Validation Error", description: "Project title is required.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const userEmail = auth.currentUser?.email || "kendallaaron84@gmail.com";
      const authorSlug = "kendall";
      
      // 🚀 1. Generate the exact Canonical Asset Key to prevent duplicates
      const cleanBookSlug = formData.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, '');
      const assetKey = `abk_${authorSlug}_${cleanBookSlug}`;

      // 🚀 2. Force Write to the exact 'products' document WordPress expects
      const productRef = doc(db, "products", assetKey);
      
      await setDoc(productRef, {
        assetKey: assetKey,
        authorEmail: userEmail,
        title: formData.title,
        brandAllocation: formData.brand,
        targetAudience: formData.audience,
        synopsis: formData.description,
        fileUrl: formData.fileUrl, // 🚀 Saves the file stream URL safely
        status: "Active",
        type: "Audiobook",
        updatedAt: serverTimestamp(),
      }, { merge: true }); // Merge ensures we don't overwrite other data like Stripe IDs

      toast({
        title: "Asset Secured",
        description: `"${formData.title}" added to the master products catalog.`,
      });

      // Clear the form
      setFormData({ title: "", brand: "personal", audience: "", description: "", fileUrl: "" });
    } catch (error: any) {
      console.error("Database Write Failed:", error);
      toast({ title: "Write Fault", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-6 shadow-xl space-y-6 relative overflow-hidden">
      
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
          <Sparkles className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white">Generation Pipeline</h2>
          <p className="text-xs text-muted-foreground">Queue a new manuscript or content blueprint.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Project Title
          </label>
          <input 
            type="text" 
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full bg-slate-950/50 border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>

        {/* 🚀 ADDED: The Media Upload Zone is now inside the form */}
        <div className="space-y-1.5 pt-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Media Ingestion
          </label>
          <VoiceUploadZone 
            authorEmail={auth.currentUser?.email || "kendallaaron84@gmail.com"} 
            onUploadSuccess={(url) => setFormData({...formData, fileUrl: url})} 
          />
          {formData.fileUrl && (
             <p className="text-xs text-emerald-400 mt-2">✓ Media securely linked to this asset.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <LayoutTemplate className="w-3 h-3" /> Core Synopsis
          </label>
          <textarea 
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            className="w-full h-24 bg-slate-950/50 border border-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors resize-none"
          />
        </div>
      </div>

      <div className="pt-2 border-t border-border">
        <button 
          type="submit" 
          disabled={isSubmitting}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
        >
          {isSubmitting ? "Securing Asset..." : "Save to Catalog"}
        </button>
      </div>
    </form>
  );
}