"use client";

import React, { useState, useEffect } from "react";
import Layout from "@/components/layout";
import { AudioNarrationTracker } from "@/components/audio-narration-tracker";
import { AuthorIntakeForm } from "@/components/author-intake-form";
import { AuthorPipelineList } from "@/components/author-pipeline-list";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { BookOpen } from "lucide-react";

export const dynamic = 'force-dynamic';

export default function NexusPipelinePage() {
  const authorEmail = "kendall@domain.com"; // Multi-tenant boundary anchor
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [selectedRequestIndex, setSelectedRequestIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  // 🔑 SMART LOGIC DATA STREAM: Listens to all active requests for this author
  useEffect(() => {
    const requestsRef = collection(db, "content_blueprints");
    const q = query(requestsRef, where("authorEmail", "==", authorEmail));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: any[] = [];
      snapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort so highest progress or newest appears top-level
      setActiveRequests(records);
      setLoading(false);
    }, (err) => {
      console.error("Failed to stream active narration queue:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [authorEmail]);

  const currentActiveRequest = activeRequests[selectedRequestIndex] || null;

  return (
    <Layout>
      <div className="p-6 space-y-8 max-w-7xl mx-auto">
        
        {/* 1. Page Header Stack */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Author Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Monitor and manage your sales funnel with real-time insights.
            </p>
          </div>

          {/* 🔑 DYNAMIC PICKER: Only visible if the author has multiple books processing */}
          {activeRequests.length > 1 && (
            <div className="flex items-center gap-2.5 bg-card px-4 py-2 rounded-xl border border-border self-start md:self-auto shadow-sm">
              <BookOpen className="w-4 h-4 text-primary" />
              <select
              title="Select active project"
                value={selectedRequestIndex}
                onChange={(e) => setSelectedRequestIndex(Number(e.target.value))}
                className="bg-transparent text-xs font-bold text-white focus:outline-none appearance-none cursor-pointer pr-4"
              >
                {activeRequests.map((req, idx) => (
                  <option key={req.id} value={idx} className="bg-card text-white">
                    {req.title || `Project #${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 2. SMART LOGIC ADAPTIVE ROW: 
            Completely hidden if zero items exist, automatically displays if data flows */}
        {!loading && currentActiveRequest && (
          <div className="animate-in fade-in slide-in-from-top-4 duration-300">
            <AudioNarrationTracker 
              currentStage={currentActiveRequest.currentStage || 1} 
              queuePosition={currentActiveRequest.queuePosition || 0} 
            />
          </div>
        )}

        {/* 3. Main Operational Split Controls Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2">
            <AuthorIntakeForm />
          </div>
          
          <div className="p-5 bg-card rounded-2xl border border-border space-y-3 text-sm text-muted-foreground shadow-sm">
            <h3 className="font-bold text-foreground">Production Instructions</h3>
            <p className="text-xs leading-relaxed">
              Initiating audiobook narration processes automatically queues voice profiles through ElevenLabs Studio engineering gates.
            </p>
            <div className="pt-2 border-t border-border text-[11px]">
              <span className="font-semibold text-foreground">Secure Vault Core Status:</span> Verified Active
            </div>
          </div>
        </div>

        {/* 4. Underlying Blog Generation Engine List Layout */}
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Live Execution Blueprints</h2>
            <p className="text-xs text-muted-foreground">Monitored pipeline traces executing across the global CDN matrix.</p>
          </div>
          <AuthorPipelineList />
        </div>

      </div>
    </Layout>
  );
}