"use client";

import React from "react";
import { Flame, Sparkles, BookmarkCheck, UserCheck } from "lucide-react";

interface ActivityItem {
  id: string;
  type: "high_prospect" | "warm_prospect" | "milestone" | "signup";
  title: string;
  description: string;
  timeLabel: string;
  score?: number;
}

export default function RecentActivity() {
  const currentUserEmail = "kendall.aaron@koba-i.com";
  const isOwner = currentUserEmail === "kendall.aaron@koba-i.com";

  // 👑 DATA SEPARATION LAYER BASED ON IDENTITY
  const ownerProspects: ActivityItem[] = [
    {
      id: "p1",
      type: "high_prospect",
      title: "Hot Lead: Marcus Vance (mvance@enterprise.com)",
      description: "Crossed Traffic Triangle threshold. Inbound from LinkedIn bio -> Opened newsletter -> Spent 22 mins on Audiobook Creations deployment page.",
      timeLabel: "12 mins ago",
      score: 95
    },
    {
      id: "p2",
      type: "warm_prospect",
      title: "Warm Prospect: t.henderson@gmail.com",
      description: "Engaged in long-form content. Completed 3 chapters of your audiobook framework documentation.",
      timeLabel: "2 hours ago",
      score: 75
    },
    {
      id: "p3",
      type: "high_prospect",
      title: "Hot Lead: Jubilee Plugin Click-thru",
      description: "Returning cookie profile from email campaign list just loaded your WordPress checkout matrix.",
      timeLabel: "4 hours ago",
      score: 85
    }
  ];

  const authorActivity: ActivityItem[] = [
    {
      id: "a1",
      type: "milestone",
      title: "Chapter Milestone Achieved",
      description: "A reader just finalized reading Chapter 12 of 'Duncan the Man Hunter: Part 1'.",
      timeLabel: "5 mins ago"
    },
    {
      id: "a2",
      type: "signup",
      title: "New Satellite Reader Registered",
      description: "Reader profile verified and logged into your local custom e-reader portal.",
      timeLabel: "45 mins ago"
    },
    {
      id: "a3",
      type: "milestone",
      title: "Audio Binge-Listening Flag",
      description: "An anonymous listener just spent 2 consecutive hours streaming your Part 2 Audiobook matrix.",
      timeLabel: "Yesterday"
    }
  ];

  const currentFeed = isOwner ? ownerProspects : authorActivity;

  return (
    <div className="p-6 bg-card border text-card-foreground rounded-xl shadow-sm space-y-4 transition-colors duration-200">
      <div>
        <h3 className="font-bold text-base tracking-tight">
          {isOwner ? "Predictive Sales Pipeline Logs" : "Real-Time Reader Engagement Feed"}
        </h3>
        <p className="text-xs text-muted-foreground">
          {isOwner ? "High-affinity prospects mapped across your Social, Email, and Web Traffic Triangle vectors." : "Live milestone traces streaming from your active readership network."}
        </p>
      </div>

      <div className="space-y-3">
        {currentFeed.map((item) => (
          <div key={item.id} className="flex items-start justify-between p-3.5 rounded-xl bg-muted/20 border border-border/50 hover:bg-muted/40 transition-colors gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-background border rounded-lg shrink-0 mt-0.5">
                {item.type === "high_prospect" ? <Flame className="w-4 h-4 text-red-500 animate-pulse" /> :
                 item.type === "warm_prospect" ? <Sparkles className="w-4 h-4 text-orange-400" /> :
                 item.type === "milestone" ? <BookmarkCheck className="w-4 h-4 text-purple-400" /> :
                 <UserCheck className="w-4 h-4 text-blue-400" />}
              </div>
              <div className="space-y-0.5 text-left">
                <h4 className="font-bold text-xs text-foreground tracking-tight">{item.title}</h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed max-w-4xl">{item.description}</p>
                <div className="text-[10px] text-muted-foreground/70 font-mono pt-1">{item.timeLabel}</div>
              </div>
            </div>

            {/* Render a Predictive Score Badge only on your Master Owner view */}
            {isOwner && item.score && (
              <div className="text-right shrink-0">
                <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Affinity</div>
                <div className="text-sm font-black font-mono text-primary">{item.score}/100</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
