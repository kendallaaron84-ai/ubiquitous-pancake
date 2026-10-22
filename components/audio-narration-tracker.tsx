"use client";

import React from "react";
import { CheckCircle2, Clock, AudioLines, Sparkles, Disc } from "lucide-react";

interface PipelineStage {
  number: number;
  label: string;
  description: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

interface AudioNarrationTrackerProps {
  currentStage: number; 
  queuePosition: number; 
}

const STAGES: PipelineStage[] = [
  { number: 1, label: "Ingestion", description: "Manuscript text analyzed", icon: Clock },
  { number: 2, label: "Voice Casting", description: "Designing character tones", icon: AudioLines },
  { number: 3, label: "Author Review", description: "Awaiting voice sign-off", icon: Sparkles },
  { number: 4, label: "Mastering", description: "Normalizing LUFS targets", icon: Disc },
  { number: 5, label: "Live Deployment", description: "Vault player active", icon: CheckCircle2 },
];

export function AudioNarrationTracker({ currentStage, queuePosition }: AudioNarrationTrackerProps) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-6 shadow-md">
      
      {/* Header and Queue Position Info Row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-border/60 pb-4">
        <div>
          <h3 className="font-bold text-base text-foreground">Audio-Narration Tracker</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Real-time processing queue for your secure narration tracks[cite: 2].</p>
        </div>
        {queuePosition > 0 && (
          <div className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs px-3 py-1.5 rounded-xl font-semibold animate-pulse">
            {queuePosition} Authors Ahead in Production Queue[cite: 2]
          </div>
        )}
      </div>

      {/* Visual Progression Grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 relative">
        {STAGES.map((stage) => {
          const Icon = stage.icon;
          const isCompleted = stage.number < currentStage;
          const isActive = stage.number === currentStage;

          return (
            <div 
              key={stage.number} 
              className={`p-4 rounded-xl border transition-all relative z-10 flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-2.5 ${
                isActive 
                  ? "bg-primary/10 border-primary shadow-sm" 
                  : isCompleted 
                  ? "bg-emerald-500/5 border-emerald-500/30" 
                  : "bg-background/40 border-border opacity-60"
              }`}
            >
              {/* Stage Icon Badge */}
              <div className={`p-2 rounded-lg border shrink-0 ${
                isActive 
                  ? "bg-primary text-primary-foreground border-primary" 
                  : isCompleted 
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
                  : "bg-slate-900 text-muted-foreground border-border"
              }`}>
                <Icon className="w-4 h-4" />
              </div>

              {/* Text Layout Stack */}
              <div className="space-y-0.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider block ${
                  isActive ? "text-primary" : isCompleted ? "text-emerald-500" : "text-muted-foreground"
                }`}>
                  Stage {stage.number}: {stage.label}
                </span>
                <p className="text-xs font-semibold text-foreground truncate max-w-[160px]">{stage.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
