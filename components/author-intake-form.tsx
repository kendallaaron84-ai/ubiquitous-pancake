"use client";

import React, { useState } from "react";
import { db, auth } from "@/core/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, FileText, Briefcase, Users, LayoutTemplate } from "lucide-react";

export const dynamic = 'force-dynamic';

export function AuthorIntakeForm() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    brand: "personal",
    audience: "",
    description: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title) {
      toast({ title: "Validation Error", description: "Project title is required.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      // 🚀 STRICT MULTI-TENANT AUTH GATE (No fallbacks)
      const userEmail = auth.currentUser?.email;
      
      if (!userEmail) {
        toast({ 
          title: "Authentication Error", 
          description: "Active session dropped. You must be securely logged in to deploy a blueprint.", 
          variant: "destructive" 
        });
        setIsSubmitting(false);
        return;
      }
      
      // 2. Inject payload directly into the Cloud Run execution matrix, strictly scoped to the active tenant
      await addDoc(collection(db, "content_blueprints"), {
        authorEmail: userEmail,
        topicTitle: formData.title,
        title: formData.title, // Saved twice to support both your pipeline pages
        brandAllocation: formData.brand,
        targetAudience: formData.audience,
        synopsis: formData.description,
        executionState: "initializing",
        createdAt: serverTimestamp(),
      });

      toast({ 
        title: "Blueprint Deployed", 
        description: "Your content matrix has been pushed to the processing queue." 
      });

      // Clear the form for the next request
      setFormData({ title: "", brand: "personal", audience: "", description: "" });
      
    } catch (error: any) {
      console.error("Pipeline submission error:", error);
      toast({ 
        title: "Deployment Failed", 
        description: error.message || "Failed to push blueprint to the cloud.", 
        variant: "destructive" 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg">
      <div className="p-5 border-b border-border bg-slate-950/40">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-500" />
          Content Deployment Engine
        </h2>
        <p className="text-xs text-muted-foreground mt-1">Configure narrative constraints and initiate the Gemini processing pipeline.</p>
      </div>

      <div className="p-5 space-y-5">
        {/* Topic / Title */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Working Title / Topic Directive
          </label>
          <input 
            type="text" 
            required
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full bg-slate-950/50 border border-border rounded-xl px-4 py-3 text-sm font-semibold text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
            placeholder="e.g. 5 Reasons Audiobooks Outsell Print"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Brand Voice Allocation */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Briefcase className="w-3 h-3" /> Voice Allocation
            </label>
            <select 
              value={formData.brand}
              onChange={(e) => setFormData({...formData, brand: e.target.value})}
              className="w-full bg-slate-950/50 border border-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors appearance-none"
            >
              <option value="personal">Personal Author Brand</option>
              <option value="book_lore">Book Specific Lore</option>
              <option value="technical">Technical / Analytical</option>
            </select>
          </div>

          {/* Target Audience */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3 h-3" /> Target Audience
            </label>
            <input 
              type="text" 
              value={formData.audience}
              onChange={(e) => setFormData({...formData, audience: e.target.value})}
              className="w-full bg-slate-950/50 border border-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
              placeholder="e.g. Noir Thriller Fans"
            />
          </div>
        </div>

        {/* Synopsis / Instructions */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <LayoutTemplate className="w-3 h-3" /> Core Synopsis / Agent Instructions
          </label>
          <textarea 
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            className="w-full h-24 bg-slate-950/50 border border-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors resize-none"
            placeholder="Outline the core plot points, tone, or specific processing instructions for the AI..."
          />
        </div>
      </div>

      <div className="pt-2 border-t border-border">
        <button 
          type="submit" 
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSubmitting ? (
            <span className="animate-pulse">Initializing Blueprint...</span>
          ) : (
            <>Queue Generation <Sparkles className="w-4 h-4" /></>
          )}
        </button>
      </div>
    </div>
  );
}