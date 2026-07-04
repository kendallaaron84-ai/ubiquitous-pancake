"use client";

import React, { useState } from "react";
import { db, auth } from "@/lib/firebase";
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
      // 1. Identify the active operator
      const userEmail = auth.currentUser?.email || "kendallaaron84@gmail.com";
      
      // 2. Inject payload directly into the Cloud Run execution matrix
      await addDoc(collection(db, "content_blueprints"), {
        authorEmail: userEmail,
        topicTitle: formData.title,
        title: formData.title, // Saved twice to support both your pipeline pages
        brandAllocation: formData.brand,
        targetAudience: formData.audience,
        synopsis: formData.description,
        executionState: "initializing",
        currentStage: 1, // Triggers the visual narration tracker
        queuePosition: Math.floor(Math.random() * 5) + 1, // Simulated queue line
        createdAt: serverTimestamp(),
      });

      toast({
        title: "Pipeline Triggered",
        description: `"${formData.title}" added to the execution matrix.`,
      });

      // 3. Clear the form for the next book
      setFormData({ title: "", brand: "personal", audience: "", description: "" });
    } catch (error: any) {
      console.error("Pipeline Injection Failed:", error);
      toast({ title: "Pipeline Fault", description: error.message, variant: "destructive" });
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
        {/* Project Title */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Project Title
          </label>
          <input 
            type="text" 
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full bg-slate-950/50 border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
            placeholder="e.g. Duncan the Man Hunter - Chapter 2"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Brand Allocation */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Briefcase className="w-3 h-3" /> Brand Vector
            </label>
            <select 
              value={formData.brand}
              onChange={(e) => setFormData({...formData, brand: e.target.value})}
              className="w-full bg-slate-950/50 border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
            >
              <option value="personal">Personal Brand (Default)</option>
              <option value="koba">KOBA-I Commercial</option>
              <option value="jubilee">Jubilee Works</option>
            </select>
          </div>

          {/* Target Audience */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3 h-3" /> Target Demographic
            </label>
            <input 
              type="text" 
              value={formData.audience}
              onChange={(e) => setFormData({...formData, audience: e.target.value})}
              className="w-full bg-slate-950/50 border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
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
          disabled={isSubmitting}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <span className="animate-pulse">Initializing Blueprint...</span>
          ) : (
            <>Queue Generation <Sparkles className="w-4 h-4" /></>
          )}
        </button>
      </div>

    </form>
  );
}