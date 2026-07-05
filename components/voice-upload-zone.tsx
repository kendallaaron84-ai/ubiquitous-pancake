"use client";

import React, { useState, useRef } from "react";
import { UploadCloud, FileAudio, Loader2, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { storage } from "@/core/firebase"; // Ensure you export storage from your firebase config
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

interface VoiceUploadZoneProps {
  authorEmail: string;
  onUploadSuccess: (storagePath: string) => void;
}

export function VoiceUploadZone({ authorEmail, onUploadSuccess }: VoiceUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileDetails, setFileDetails] = useState<{ name: string; size: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Replace the mock function with this production logic
const processAudioFile = async (file: File) => {
  setUploading(true);
  try {
    // 1. Reference your verified bucket
    const storageRef = ref(storage, `vault/audio/${authorEmail}/${file.name.toLowerCase().replace(/\s+/g, "_")}`);
    
    // 2. Upload the real bytes
    await uploadBytes(storageRef, file);
    
    // 3. Get the REAL public streaming URL
    const downloadUrl = await getDownloadURL(storageRef);
    
    toast({ title: "Ingestion Success", description: "Media linked to production canvas." });
    
    // 4. Update the form with the real URL
    onUploadSuccess(downloadUrl); 
  } catch (error: any) {
    toast({ title: "Pipeline Fault", description: error.message, variant: "destructive" });
  } finally {
    setUploading(false);
  }
};

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) processAudioFile(files[0]);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? "border-emerald-500 bg-emerald-500/5"
            : "border-border bg-slate-950/20 hover:bg-slate-950/40 hover:border-muted-foreground/40"
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => e.target.files?.[0] && processAudioFile(e.target.files[0])}
          accept="audio/*"
          className="hidden"
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className={`p-3 rounded-xl border ${isDragging ? "bg-emerald-500/10 border-emerald-500/30" : "bg-slate-900 border-border"}`}>
            {uploading ? (
              <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
            ) : (
              <UploadCloud className={`w-6 h-6 ${isDragging ? "text-emerald-400" : "text-slate-400"}`} />
            )}
          </div>

          {!fileDetails ? (
            <div>
              <p className="text-sm font-bold text-foreground">Secure Biometric Voice Ingestion</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Drag and drop your high-fidelity source sample here to initiate cloning and cryptographic asset isolation.
              </p>
            </div>
          ) : (
            <div className="space-y-1 animate-in fade-in duration-200">
              <div className="flex items-center gap-1.5 justify-center text-sm font-semibold text-foreground">
                <FileAudio className="w-4 h-4 text-emerald-400" />
                <span className="truncate max-w-[200px]">{fileDetails.name}</span>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">{fileDetails.size}</p>
            </div>
          )}
        </div>
      </div>

      {uploading && (
        <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl flex items-start gap-3 text-xs text-slate-300">
          <ShieldAlert className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
          <div>
            <span className="font-bold text-emerald-400 block">Isolating Vocal Waveforms...</span>
            <span className="opacity-80">Streaming matrix arrays safely to cloud container. System is tracking byte allocations.</span>
          </div>
        </div>
      )}
    </div>
  );
}