"use client";

import React, { useState, useEffect } from "react";
import Layout from "@/components/layout";
import { db } from "@/lib/firebase";
import { 
  collection, doc, onSnapshot, setDoc, addDoc, 
  getDocs, writeBatch, serverTimestamp 
} from "firebase/firestore";
import { 
  Terminal as TerminalIcon, Play, RefreshCw, CheckCircle2, 
  XCircle, AlertTriangle, ShieldCheck, Database, LayoutGrid, 
  ListFilter, Activity, Layers, ArrowRight, Save, Cpu, Sparkles 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export const dynamic = 'force-dynamic';

// 23 Integration test points template definitions
const STEP_TEMPLATES = [
  // 1. Content Creation & Onboarding (Steps 1–7)
  { id: "step_1", name: "Step 1: User Onboarding Flow", category: "onboarding", description: "Verifies user signup form and active session cookie generation." },
  { id: "step_2", name: "Step 2: Ingest Manuscript Document", category: "onboarding", description: "Uploads raw text manuscript to secure CDN asset directory." },
  { id: "step_3", name: "Step 3: Parse Sections & Structural Hierarchy", category: "onboarding", description: "Processes manuscript sections, titles, and table of contents." },
  { id: "step_4", name: "Step 4: Generate Firebase Audiobook", category: "onboarding", description: "Invokes KOBA-I Studio synthesize audiobook audio tracks." },
  { id: "step_5", name: "Step 5: Publish Product Metadata (CPT)", category: "onboarding", description: "Publishes product details to custom WordPress post type endpoint." },
  { id: "step_6", name: "Step 6: Generate Cover Art Graphics", category: "onboarding", description: "Triggers generative image pipelines to create high-resolution book cover art." },
  { id: "step_7", name: "Step 7: Verify WordPress CPT Sync Pipeline", category: "onboarding", description: "Validates that the production asset key maps cleanly to the custom koba_publication post type endpoint." },

  // 2. Stripe & Product Deployments (Steps 8–17)
  { id: "step_8", name: "Step 8: Verify Bookshelf License Activation", category: "onboarding", description: "Asserts that the public catalog handles shortcode delivery via active entries in the plugin_licenses schema." },
  { id: "step_9", name: "Step 9: Verify Stripe Connect Merchant Authorization", category: "onboarding", description: "Validates merchant ID authentication tokens against active platform profiles." },
  { id: "step_10", name: "Step 10: Verify Dynamic Entitlement Provisioning", category: "onboarding", description: "Asserts that a successful payment intent successfully generates user access rights maps in Firestore." },
  { id: "step_11", name: "Step 11: Deploy Stripe Webhook Listeners", category: "stripe", description: "Listens for payment intent success signals and fires CDN provisioning." },
  { id: "step_12", name: "Step 12: [WIP] Verify Author Modular Purchasing (A-La-Carte)", category: "stripe", description: "Tests user tier upgrades and billing frequency intervals." },
  { id: "step_13", name: "Step 13: [WIP] Verify Author Subscription Packages (Recurring)", category: "stripe", description: "Creates cryptographically-signed license keys upon payment." },
  { id: "step_14", name: "Step 14: Test Credit Card Checkout Flows", category: "stripe", description: "Simulates automated credit card purchase cycles in sandbox environment." },
  { id: "step_15", name: "Step 15: Verify Dynamic Entitlement Authorization", category: "stripe", description: "Validates that a successful purchase generates an active entitlement matrix, securely gating access to the requested asset without exposing direct file downloads." },
  { id: "step_16", name: "Step 16: Audit Platform Revenue Splitting", category: "stripe", description: "Verifies that Stripe Connect split-payout logic correctly routes 100% of the transaction volume directly to the connected author account by default, while supporting dynamic platform fee commission deductions when custom commercial terms are applied." },
  { id: "step_17", name: "Step 17: Verify Secure Gated Media Streaming", category: "stripe", description: "Validates the generation of temporary, 10-hour signed access tokens for direct web player streaming, ensuring media assets remain private and unshared." },

  // 3. WordPress & Bookshelf Validations (Steps 18–23)
  { id: "step_18", name: "Step 18: Verify Universal Page Builder Rendering Engine", category: "wordpress", description: "Audits universal shortcode injection and asset schema initialization, ensuring compatibility across Gutenberg, Divi, Beaver Builder, and classic content layouts." },
  { id: "step_19", name: "Step 19: Verify Dynamic Client Runtime Metadata Injection", category: "wordpress", description: "Validates that the plugin runtime securely streams live author profiles, asset metadata schemas, and real-time pricing directly from the Firestore cloud layer without duplicating data into local WordPress postmeta tables." },
  { id: "step_20", name: "Step 20: [BACKLOG] Validate Audiobook RSS Feed Generation", category: "wordpress", description: "FUTURE EXPANSION: Audits the generation of secure, tokenized XML syndication feeds for external podcast/audiobook player integrations. Currently unbuilt." },
  { id: "step_21", name: "Step 21: Verify Cloud Media Storage Hotlink Prevention", category: "wordpress", description: "Validates that raw media asset URLs stored in the cloud storage bucket throw a 403 Forbidden error when accessed directly without a valid, non-expired 10-hour cryptographic signature token." },
  { id: "step_22", name: "Step 22: Validate Author Workbench Layout Fidelity", category: "wordpress", description: "Verifies that the content engine accurately renders the author's custom text formatting, structural layouts, and embedded images inside the Jubilee Works media player component exactly as configured in the backend workbench." },
  { id: "step_22b", name: "Step 22b: [BACKLOG] Enforce EPUB Standard Validation Checks", category: "wordpress", description: "FUTURE EXPANSION: Audits uploaded .epub digital package structures for compliance with IDPF/W3C schema standards before unpacking them into the layout engine. Currently unbuilt." },
  { id: "step_23", name: "Step 23: Complete Bookshelf Styling & Interactivity Audit", category: "wordpress", description: "Verifies that the core CSS stylesheets and interactive JavaScript packages load seamlessly and render with absolute visual fidelity when injected via shortcode on an external, newly initialized WordPress site instance." },
];

export default function AutomationCenterPage() {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [dbSteps, setDbSteps] = useState<Record<string, any>>({});
  const [selectedStepId, setSelectedStepId] = useState<string>("step_1");
  const [runningStepId, setRunningStepId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(true);
  const { toast } = useToast();

  // Subscribe to real-time updates from Firestore steps collection
  useEffect(() => {
    setSyncing(true);
    const stepsCollection = collection(db, "steps");
    
    const unsubscribe = onSnapshot(stepsCollection, (snapshot) => {
      const stepData: Record<string, any> = {};
      snapshot.forEach((doc) => {
        stepData[doc.id] = doc.data();
      });
      setDbSteps(stepData);
      setSyncing(false);
    }, (error) => {
      console.error("Firestore sync error: ", error);
      setSyncing(false);
    });

    return () => unsubscribe();
  }, []);

  // Handler to execute or retry individual step
  const handleRunStep = async (stepId: string) => {
    setRunningStepId(stepId);
    toast({
      title: "Executing Integration Test",
      description: `Dispatched asynchronous browser interaction thread for ${stepId}...`,
    });

    // Optimistically update local display status to "running"
    setDbSteps(prev => ({
      ...prev,
      [stepId]: {
        ...(prev[stepId] || {}),
        status: "running"
      }
    }));

    try {
    const response = await fetch(`http://localhost:8000/api/v1/automation/run-step/${stepId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

      if (!response.ok) {
        throw new Error(`HTTP Error Status: ${response.status}`);
      }

      const resData = await response.json();
      toast({
        title: "Test Step Enqueued",
        description: `Successfully enqueued step ${stepId}. Mapped target: ${resData.mapped_target_url}`,
      });
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Dispatch Failure",
        description: `Failed to initiate backend execution: ${err.message}`,
        variant: "destructive"
      });
      
      // Revert status to failed locally if dispatch breaks
      setDbSteps(prev => ({
        ...prev,
        [stepId]: {
          ...(prev[stepId] || {}),
          status: "failed",
          execution_history: [
            ...(prev[stepId]?.execution_history || []),
            {
              timestamp: new Date().toISOString(),
              status: "failed",
              errors: [`Failed to dispatch to backend endpoint: ${err.message}`]
            }
          ]
        }
      }));
    } finally {
      setRunningStepId(null);
    }
  };

  // Seeding method to initialize database steps configuration cleanly
  const handleSeedDatabaseSteps = async () => {
    setSyncing(true);
    try {
      const batch = writeBatch(db);
      
      STEP_TEMPLATES.forEach((step) => {
        const docRef = doc(db, "steps", step.id);
        
        // Define default seed data matching backend expectations
        const seedPayload = {
          step_name: step.name,
          status: "idle",
          category: step.category,
          asset_key: `asset_${step.id}`,
          expected_visibility: "Active",
          expected_price: "49.99",
          expected_stripe_account: "acct_12345",
          execution_history: []
        };
        
        batch.set(docRef, seedPayload, { merge: true });
      });

      await batch.commit();
      toast({
        title: "Test Suite Initialized",
        description: "Successfully seeded all 23 automation integration steps into Firestore collection.",
      });
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Seeding Failed",
        description: `Could not initialize steps inside database: ${err.message}`,
        variant: "destructive"
      });
    } finally {
      setSyncing(false);
    }
  };

  // Snapshot/Save view state method for future auditing compliance
  const handleSaveViewSnapshot = async () => {
    try {
      const currentRunState = STEP_TEMPLATES.map(item => {
        const liveData = dbSteps[item.id] || {};
        return {
          id: item.id,
          name: item.name,
          category: item.category,
          status: liveData.status || "idle",
          latest_log: liveData.execution_history?.length > 0 
            ? liveData.execution_history[liveData.execution_history.length - 1] 
            : null
        };
      });

      const totalSuccess = currentRunState.filter(s => s.status === "success").length;
      const totalFailed = currentRunState.filter(s => s.status === "failed").length;

      await addDoc(collection(db, "saved_test_runs"), {
        timestamp: serverTimestamp(),
        totalSteps: 23,
        successCount: totalSuccess,
        failedCount: totalFailed,
        states: currentRunState,
        complianceVerified: totalFailed === 0 && totalSuccess > 0,
        auditedBy: "Jubilee Compliance Core"
      });

      toast({
        title: "Snapshot Captured Successfully",
        description: `Deployment layout run saved with ${totalSuccess} compliant points. Captured in saved_test_runs collection.`,
      });
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Snapshot Failed",
        description: `Could not write compliance records: ${err.message}`,
        variant: "destructive"
      });
    }
  };

  // Compile calculations for status cards
  const totalInDb = Object.keys(dbSteps).length;
  const successCount = STEP_TEMPLATES.filter(s => dbSteps[s.id]?.status === "success").length;
  const failedCount = STEP_TEMPLATES.filter(s => dbSteps[s.id]?.status === "failed").length;
  const runningCount = STEP_TEMPLATES.filter(s => dbSteps[s.id]?.status === "running").length;
  const idleCount = 23 - successCount - failedCount - runningCount;

  // Selected Step detailed metrics
  const selectedTemplate = STEP_TEMPLATES.find(t => t.id === selectedStepId);
  const selectedLiveData = dbSteps[selectedStepId] || {};
  const latestExecutionLog = selectedLiveData.execution_history?.length > 0 
    ? selectedLiveData.execution_history[selectedLiveData.execution_history.length - 1] 
    : null;

  // Filter templates based on category pills
  const filteredTemplates = STEP_TEMPLATES.filter(t => {
    if (activeCategory === "all") return true;
    return t.category === activeCategory;
  });

  return (
    <Layout breadcrumbTitle="Automation Command Center">
      <div style={{ backgroundColor: '#293A71' }} className="p-6 space-y-6 max-w-7xl mx-auto text-foreground font-sans min-h-[calc(100vh-4rem)] text-white rounded-3xl border border-zinc-700 shadow-2xl">
        
        {/* Header Block Row */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
              <Layers className="w-7 h-7 text-primary animate-pulse" />
              KOBA-I Automation Command Center
            </h1>
            <p className="text-sm text-zinc-300 mt-0.5">
              Real-time asynchronous browser orchestration, out-of-band Firestore verification, and deployment compliance auditing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {totalInDb < 23 && (
              <button
                onClick={handleSeedDatabaseSteps}
                className="flex items-center gap-2 h-10 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-zinc-800/40 hover:bg-zinc-800/80 text-zinc-200 border border-zinc-600 transition-all"
              >
                <Database className="w-4 h-4 text-primary" />
                Initialize Test Suite
              </button>
            )}
            <button
              onClick={handleSaveViewSnapshot}
              className="flex items-center gap-2 h-10 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-primary hover:bg-opacity-90 text-white font-sans transition-all shadow-md"
            >
              <Save className="w-4 h-4" />
              Save Current Run View
            </button>
          </div>
        </div>

        {/* Live Performance & Auditing Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="p-4 bg-zinc-800/20 border border-zinc-600/50 rounded-2xl space-y-1 backdrop-blur-sm">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">TOTAL SUITE STEPS</span>
            <div className="text-2xl font-black text-white">23</div>
          </div>
          <div className="p-4 bg-zinc-800/20 border border-zinc-600/50 rounded-2xl space-y-1 backdrop-blur-sm">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">PASSED VERIFICATIONS</span>
            <div className="text-2xl font-black text-emerald-400">{successCount}</div>
          </div>
          <div className="p-4 bg-zinc-800/20 border border-zinc-600/50 rounded-2xl space-y-1 backdrop-blur-sm">
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-300">FAILED INCIDENTS</span>
            <div className="text-2xl font-black text-red-400">{failedCount}</div>
          </div>
          <div className="p-4 bg-zinc-800/20 border border-zinc-600/50 rounded-2xl space-y-1 backdrop-blur-sm">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300">RUNNING FLIGHTS</span>
            <div className="text-2xl font-black text-blue-400">{runningCount}</div>
          </div>
          <div className="p-4 bg-zinc-800/20 border border-zinc-600/50 rounded-2xl col-span-2 md:col-span-1 space-y-1 backdrop-blur-sm">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">IDLE / UNTESTED</span>
            <div className="text-2xl font-black text-zinc-300">{idleCount}</div>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="p-5 bg-zinc-800/10 border border-zinc-600/30 rounded-2xl space-y-2.5 backdrop-blur-sm">
          <div className="flex justify-between items-center text-xs font-semibold text-zinc-300">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Compliance Progress</span>
            <span className="font-mono text-[11px] text-white">
              {successCount} / 23 COMPLETED ({Math.round((successCount / 23) * 100)}%)
            </span>
          </div>
          <div style={{ backgroundColor: '#293A71' }} className="w-full h-2 border border-zinc-600 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-700" 
              style={{ width: `${(successCount / 23) * 100}%` }}
            />
          </div>
        </div>

        {/* Workspace Layout Matrix */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Left Panel: Category Selector & Step Stepper List */}
          <div className="space-y-4 lg:col-span-2">
            
            {/* Horizontal Filter Navigation */}
            <div className="flex flex-wrap gap-2 p-1.5 bg-zinc-800/30 border border-zinc-600/50 rounded-2xl">
              <button
                onClick={() => setActiveCategory("all")}
                className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                  activeCategory === "all" ? "bg-primary text-white" : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                All Steps
              </button>
              <button
                onClick={() => setActiveCategory("onboarding")}
                className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                  activeCategory === "onboarding" ? "bg-primary text-white" : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Onboarding (1–7)
              </button>
              <button
                onClick={() => setActiveCategory("stripe")}
                className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                  activeCategory === "stripe" ? "bg-primary text-white" : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                Stripe & Product (8–17)
              </button>
              <button
                onClick={() => setActiveCategory("wordpress")}
                className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                  activeCategory === "wordpress" ? "bg-primary text-white" : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                WordPress (18–23)
              </button>
              <button
                onClick={() => setActiveCategory("voice_vault")}
                className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                  activeCategory === "voice_vault" ? "bg-primary text-white" : "text-zinc-400 hover:text-zinc-300"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Voice Vault (Security)
              </button>
            </div>

            {/* Step Grid Cards */}
            {activeCategory === "voice_vault" ? (
              <div className="bg-zinc-800/10 border border-zinc-600/40 rounded-2xl p-10 text-center text-zinc-400 flex flex-col items-center justify-center space-y-3">
                <ShieldCheck className="w-12 h-12 text-zinc-400/60 animate-pulse" />
                <h3 className="font-bold text-zinc-300 uppercase text-xs tracking-wider">Voice Vault & Biometric Protection</h3>
                <p className="text-xs max-w-md leading-relaxed text-zinc-400">
                  This bucket is reserved for future security integrations. Custom multi-tenant biometric voice authentication and C2PA provenance pipelines will map here later.
                </p>
              </div>
            ) : syncing ? (
              <div className="p-12 text-center text-zinc-300 animate-pulse font-medium text-sm">
                Synchronizing testing cluster statuses directly with Firestore collection...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTemplates.map((item) => {
                  const liveData = dbSteps[item.id] || {};
                  const isSelected = selectedStepId === item.id;
                  const isRunning = runningStepId === item.id || liveData.status === "running";
                  
                  let statusColor = "bg-zinc-700/50 border-zinc-500 text-zinc-300";
                  if (liveData.status === "success") {
                    statusColor = "bg-emerald-500/20 border-emerald-400/40 text-emerald-300";
                  } else if (liveData.status === "failed") {
                    statusColor = "bg-red-500/20 border-red-400/40 text-red-300";
                  } else if (liveData.status === "running" || isRunning) {
                    statusColor = "bg-blue-500/20 border-blue-400/40 text-blue-300 animate-pulse";
                  }

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedStepId(item.id)}
                      className={`group relative flex flex-col justify-between p-4 rounded-2xl border transition-all cursor-pointer ${
                        isSelected 
                          ? "bg-zinc-800/60 border-primary/80 shadow-xl" 
                          : "bg-zinc-800/20 border-zinc-600/50 hover:border-zinc-500 hover:bg-zinc-800/40"
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Title & Status Row */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono uppercase bg-zinc-700 text-zinc-300 border border-zinc-600 px-2 py-0.5 rounded font-extrabold tracking-wider">
                            {item.id.replace("_", " ")}
                          </span>
                          
                          <span className={`text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 border rounded-full ${statusColor}`}>
                            {liveData.status || "idle"}
                          </span>
                        </div>

                        {/* Text Details */}
                        <div className="space-y-1">
                          <h3 className={`text-sm font-extrabold tracking-tight ${isSelected ? "text-white" : "text-zinc-100"}`}>
                            {item.name}
                          </h3>
                          <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      </div>

                      {/* Run Action Trigger Strip */}
                      <div className="flex items-center justify-between border-t border-white/10 pt-3 mt-4">
                        <span className="text-[10px] text-zinc-400 font-mono tracking-wider">
                          Key: {liveData.asset_key || "N/A"}
                        </span>
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRunStep(item.id);
                          }}
                          disabled={isRunning}
                          className={`flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                            liveData.status === "failed" 
                              ? "bg-red-600 hover:bg-red-500 text-white border-transparent" 
                              : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-100 border-zinc-600"
                          }`}
                        >
                          {isRunning ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          {liveData.status === "failed" ? "Retry Test" : isRunning ? "Running..." : "Run Test"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Panel: Selected Step Inspector & Diagnostics Console */}
          <div className="space-y-6">
            {selectedTemplate ? (
              <div className="bg-zinc-800/30 border border-zinc-600/50 rounded-2xl p-5 shadow-2xl space-y-5 relative overflow-hidden">
                
                {/* Header Information */}
                <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                  <div style={{ backgroundColor: '#293A71' }} className="p-2.5 rounded-xl border border-zinc-600">
                    <TerminalIcon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] font-mono font-bold uppercase bg-zinc-700 border border-zinc-600 text-zinc-300 px-1.5 py-0.5 rounded tracking-wider">
                      {selectedTemplate.id.replace("_", " ")}
                    </span>
                    <h2 className="text-base font-bold tracking-tight text-white mt-1.5 truncate">
                      {selectedTemplate.name}
                    </h2>
                  </div>
                </div>

                {/* Subclass Details */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Test Goal Description</span>
                    <p style={{ backgroundColor: '#293A71' }} className="text-xs text-zinc-200 leading-relaxed p-3 border border-zinc-600/60 rounded-xl">
                      {selectedTemplate.description}
                    </p>
                  </div>

                  {/* Settings expectations parameters */}
                  <div style={{ backgroundColor: '#293A71' }} className="grid grid-cols-2 gap-3 p-3 border border-zinc-600/40 rounded-xl text-[11px] font-mono">
                    <div>
                      <span className="text-[9px] font-bold text-zinc-400 uppercase block tracking-wider">Expected Key</span>
                      <span className="text-zinc-200 truncate block">{selectedLiveData.asset_key || "test_asset"}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-zinc-400 uppercase block tracking-wider">Expected Visibility</span>
                      <span className="text-zinc-200 truncate block">{selectedLiveData.expected_visibility || "Active"}</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase block tracking-wider">Expected Price</span>
                      <span className="text-zinc-200 truncate block">${selectedLiveData.expected_price || "49.99"}</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase block tracking-wider">Expected Account</span>
                      <span className="text-zinc-200 truncate block">{selectedLiveData.expected_stripe_account || "acct_12345"}</span>
                    </div>
                  </div>
                </div>

                {/* Real-time Diagnostics Terminal Stream */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-primary" /> Core Diagnostics Console
                  </span>
                  
                  {/* CRT Styled Terminal Console */}
                  <div style={{ backgroundColor: '#293A71' }} className="border border-zinc-600 rounded-xl p-4 font-mono text-xs text-zinc-200 space-y-2.5 shadow-inner min-h-[160px] flex flex-col justify-between overflow-x-hidden">
                    
                    {/* Header bar controls */}
                    <div className="flex items-center justify-between border-b border-white/10 pb-2 text-[10px] text-zinc-400">
                      <div className="flex gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-red-500/55" />
                        <span className="w-2 h-2 rounded-full bg-yellow-500/55" />
                        <span className="w-2 h-2 rounded-full bg-green-500/55" />
                      </div>
                      <span className="uppercase font-bold tracking-wider text-zinc-300">CONSOLE_MONITOR_STREAM</span>
                    </div>

                    {/* Console Output logs content block */}
                    <div className="flex-1 space-y-2 min-h-0 overflow-y-auto max-h-[180px] pr-1">
                      {selectedLiveData.status === "running" ? (
                        <div className="space-y-1">
                          <p className="text-blue-300 font-bold animate-pulse">&gt; INITIALIZING SELENIUM WORKFLOW THREAD...</p>
                          <p className="text-zinc-300">&gt; BINDING INTERCEPT WORDPRESS ENDPOINTS...</p>
                          <p className="text-zinc-300">&gt; POLLING OUT-OF-BAND FIRESTORE TELEMETRY...</p>
                        </div>
                      ) : selectedLiveData.status === "success" ? (
                        <div className="space-y-1.5">
                          <p className="text-emerald-300 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> COMPLIANCE INTEGRITY PASSED
                          </p>
                          <p className="text-zinc-300">&gt; Timestamp: {latestExecutionLog?.timestamp ? new Date(latestExecutionLog.timestamp).toLocaleString() : "Live Snapshot"}</p>
                          <p className="text-zinc-300">&gt; Target validation passed: expectation values synced cleanly.</p>
                          <p className="text-zinc-400">&gt; Status: Cryptographically Verified.</p>
                        </div>
                      ) : selectedLiveData.status === "failed" ? (
                        <div className="space-y-2 text-[11px]">
                          <p className="text-red-300 font-bold flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" /> SYSTEM INTEGRITY FAULT DETECTED
                          </p>
                          <p className="text-zinc-300">&gt; Timestamp: {latestExecutionLog?.timestamp ? new Date(latestExecutionLog.timestamp).toLocaleString() : "Live Snapshot"}</p>
                          
                          {/* Errors log list */}
                          <div className="space-y-1 bg-red-950/40 border border-red-800/40 p-2.5 rounded-lg">
                            <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider block">Diagnostics Failures:</span>
                            {latestExecutionLog?.errors && latestExecutionLog.errors.map((err: string, idx: number) => {
                              const isFault = err.includes("INTEGRITY_FAULT");
                              return (
                                <p key={idx} className={isFault ? "text-amber-300 font-extrabold" : "text-red-200"}>
                                  {isFault ? "⚠️ " : "- "}{err}
                                </p>
                              );
                            })}
                          </div>

                          {/* Traceback detail */}
                          {latestExecutionLog?.trace && (
                            <details className="group border border-zinc-600 rounded-lg overflow-hidden bg-zinc-800/20">
                              <summary className="px-2 py-1.5 text-[9px] uppercase font-bold tracking-wider text-zinc-300 cursor-pointer hover:bg-zinc-800/50 select-none">
                                View Stack Traceback
                              </summary>
                              <pre style={{ backgroundColor: '#293A71' }} className="p-2 text-[10px] text-zinc-300 overflow-x-auto whitespace-pre font-mono leading-relaxed border-t border-zinc-600/60 max-h-[140px]">
                                {latestExecutionLog.trace}
                              </pre>
                            </details>
                          )}
                        </div>
                      ) : (
                        <p className="text-zinc-400 italic">&gt; Console dormant. Trigger a test cycle execution to start capturing pipeline events.</p>
                      )}
                    </div>

                    {/* Console footer state */}
                    <div className="text-[9px] text-zinc-400 border-t border-white/10 pt-1.5 flex justify-between">
                      <span>Status: {selectedLiveData.status || "Idle"}</span>
                      <span>Logs: {selectedLiveData.execution_history?.length || 0} Runs</span>
                    </div>

                  </div>
                </div>

                {/* Bottom Action run trigger */}
                <button
                  onClick={() => handleRunStep(selectedStepId)}
                  disabled={selectedLiveData.status === "running" || runningStepId !== null}
                  className="w-full flex items-center justify-center gap-2 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 h-10 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${selectedLiveData.status === "running" ? "animate-spin" : ""}`} />
                  Force Step Test Execution
                </button>

              </div>
            ) : (
              <div className="bg-zinc-800/30 border border-zinc-600/50 rounded-2xl p-12 text-center text-zinc-400">
                Select an integration step item from the grid matrix list to inspect console events.
              </div>
            )}
          </div>

        </div>

      </div>
    </Layout>
  );
}