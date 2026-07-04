import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ref, uploadBytes } from "firebase/storage"; // 🔑 Import storage references
import { storage, db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ShieldAlert, Save, UploadCloud, Loader2 } from "lucide-react";

export const dynamic = 'force-dynamic';

export function AdminControlsModal() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [directives, setDirectives] = useState(
    `ROLE & TRAINING:\nYou are an elite growth marketing copywriter deep in high-conversion psychological frameworks. Adhere strictly to the structural rules injected via the active library books.\n\nSEO & GOOGLE CORE UPDATE COMPLIANCE:\n- Deep human analytical insight, high clustering context.\n- Zero introductory fluff sentences. Direct, scannable data layouts.`
  );

  // 🚀 LIVE ADMINISTRATIVE FILE STREAMING PIPELINE
  const handleAdminConfigCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);

    try {
      let gcsUri = "";

      // 1. If a physical core PDF framework was selected, stream it directly to your new folder path
      if (file) {
        const storagePath = `system_config/foundational_constraints.pdf`;
        const fileRef = ref(storage, storagePath);
        
        console.log("Streaming global foundational constraints layer to GCS...");
        const uploadSnapshot = await uploadBytes(fileRef, file);
        gcsUri = `gs://${uploadSnapshot.metadata.bucket}/${uploadSnapshot.metadata.fullPath}`;
      }

      // 2. Commit the text overrides and the new RAG path to Firestore
      const systemConfigRef = doc(db, "system_config", "seo_core");
      await setDoc(systemConfigRef, {
        masterDirectives: directives.trim(),
        foundationalConstraintsUri: gcsUri || null, // 🔑 Read dynamically by Python main.py!
        updatedAt: serverTimestamp(),
        updatedBy: "kendall@domain.com"
      }, { merge: true });

      alert("System core configuration deployed globally across the Nexus engine fabric!");
      setFile(null);
    } catch (err: any) {
      console.error("Administrative storage execution error:", err);
      alert(`Failed to save core systems: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog>
      {/* Dialog buttons and triggers stay exactly as they are defined in your UI */}
      <DialogContent className="sm:max-w-[550px] bg-card text-card-foreground border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white font-bold tracking-tight">
            <ShieldAlert className="w-5 h-5 text-primary" /> Core Engine Controls
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleAdminConfigCommit} className="space-y-5 pt-2">
          {/* Section A: Global PDF Upload */}
          <div className="space-y-2 p-4 rounded-lg bg-background border border-border">
            <h4 className="text-xs font-semibold tracking-wide uppercase text-white">Global Foundational Constraints</h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Upload a master PDF containing compliance guidelines, banned terms, and platform instructions. This document is injected dynamically into every generation request globally.
            </p>
            <div className="flex items-center justify-between p-2 rounded border border-dashed border-border bg-card mt-2">
              <input 
                type="file" 
                accept=".pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="text-muted-foreground text-[11px] file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80 cursor-pointer"
              />
            </div>
          </div>

          {/* Section B: Text Directives Area */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Master System Instruction Overrides</h4>
            <textarea 
              value={directives}
              onChange={(e) => setDirectives(e.target.value)}
              className="w-full min-h-[200px] p-4 rounded-md border border-border bg-background text-foreground font-mono text-xs leading-relaxed resize-y focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>

          <div className="pt-2 flex justify-end border-t border-border">
            <Button type="submit" disabled={uploading} className="bg-primary text-primary-foreground font-bold px-5 gap-2">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Commit System Core
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}