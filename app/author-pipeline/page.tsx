"use client";

import React, { useState, useEffect } from "react";
import Layout from "@/components/layout";
import { AudioNarrationTracker } from "@/components/audio-narration-tracker";
import { auth, db } from "@/core/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { BookOpen } from "lucide-react";

interface NarrationRequest {
  id: string;
  title?: string;
  currentStage?: number;
  queuePosition?: number;
  [key: string]: unknown;
}

export default function NexusPipelinePage() {
  const [authorEmail, setAuthorEmail] = useState<string | null>(null);
  const [activeRequests, setActiveRequests] = useState<NarrationRequest[]>([]);
  const [selectedRequestIndex, setSelectedRequestIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setAuthorEmail(user?.email?.trim().toLowerCase() ?? null);
    setLoading(false);
  }), []);

  // 🔑 SMART LOGIC DATA STREAM: Listens to all active requests for this author
  useEffect(() => {
    if (!authorEmail) {
      setActiveRequests([]);
      return;
    }

    setLoading(true);
    const requestsRef = collection(db, "audiobook_requests");
    const q = query(requestsRef, where("authorEmail", "==", authorEmail));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: NarrationRequest[] = [];
      snapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() } as NarrationRequest);
      });
      
      // Sort so highest progress or newest appears top-level
      setActiveRequests(records);
      setSelectedRequestIndex((currentIndex) => (
        currentIndex < records.length ? currentIndex : 0
      ));
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

        {/* 3. Production guidance for the selected narration request */}
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
    </Layout>
  );
}
