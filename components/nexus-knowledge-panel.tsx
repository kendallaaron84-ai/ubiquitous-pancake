"use client";

import React, { useEffect, useState } from "react";
import { BookOpen, Building2, Compass, Globe2, Upload } from "lucide-react";

type Website = { websiteConnectionId: string; displayName: string; wordpressOrigin: string; contentRole: string; defaultUniverseId?: string | null; status: string };
type Guide = { id: string; displayName?: string; version?: number };
type World = { id: string; title?: string; genre?: string; referenceGuides?: Guide[] };
type Strategy = { id: string; displayName: string; description: string; goals: string[] };
type ContextPayload = { websites?: Website[]; storyWorlds?: World[]; strategies?: Strategy[]; businessProfile?: Record<string, unknown> | null };

const inputClass = "w-full rounded-lg border border-border bg-slate-950/50 px-3 py-2 text-xs text-white focus:border-emerald-500/50 focus:outline-none";

export function NexusKnowledgePanel() {
  const [context, setContext] = useState<ContextPayload>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [business, setBusiness] = useState({ businessName: "", coreValues: "", toneOfVoice: "", targetAudience: "", brandSummary: "" });
  const [world, setWorld] = useState({ title: "", genre: "", description: "" });
  const [site, setSite] = useState({ targetWpOrigin: "", wpUsername: "", wpAppPassword: "", displayName: "", contentRole: "both" });

  async function refresh() {
    const response = await fetch("/api/nexus/context", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json() as ContextPayload & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Knowledge settings could not be loaded.");
    setContext(payload);
    if (payload.businessProfile) setBusiness((current) => ({
      businessName: stringValue(payload.businessProfile?.businessName) || current.businessName,
      coreValues: stringValue(payload.businessProfile?.coreValues) || current.coreValues,
      toneOfVoice: stringValue(payload.businessProfile?.toneOfVoice) || current.toneOfVoice,
      targetAudience: stringValue(payload.businessProfile?.targetAudience) || current.targetAudience,
      brandSummary: stringValue(payload.businessProfile?.brandSummary) || current.brandSummary,
    }));
  }

  useEffect(() => { refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Knowledge settings could not be loaded.")); }, []);

  async function submitJson(path: string, method: "POST" | "PUT" | "PATCH", body: unknown, success: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "The request could not be completed.");
      setMessage(success); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The request could not be completed."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
    <div><h2 className="text-lg font-bold text-white">Knowledge</h2><p className="text-xs text-muted-foreground">Manage the approved sources and destinations used by Nexus SEO drafts.</p></div>

    <details className="rounded-lg border border-border p-3" open>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-foreground"><Building2 className="h-4 w-4 text-amber-400" />Business Profile</summary>
      <div className="mt-3 space-y-2">
        <input className={inputClass} value={business.businessName} onChange={(e) => setBusiness({ ...business, businessName: e.target.value })} placeholder="Business name" />
        <textarea className={inputClass} value={business.brandSummary} onChange={(e) => setBusiness({ ...business, brandSummary: e.target.value })} placeholder="Brand summary" />
        <textarea className={inputClass} value={business.coreValues} onChange={(e) => setBusiness({ ...business, coreValues: e.target.value })} placeholder="Core values" />
        <input className={inputClass} value={business.toneOfVoice} onChange={(e) => setBusiness({ ...business, toneOfVoice: e.target.value })} placeholder="Tone of voice" />
        <input className={inputClass} value={business.targetAudience} onChange={(e) => setBusiness({ ...business, targetAudience: e.target.value })} placeholder="Target audience" />
        <button disabled={busy} className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={() => submitJson("/api/nexus/business-profile", "PUT", business, "Business Profile saved.")}>Save Business Profile</button>
      </div>
    </details>

    <details className="rounded-lg border border-border p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-foreground"><BookOpen className="h-4 w-4 text-indigo-400" />Story Worlds & Reference Guides</summary>
      <div className="mt-3 space-y-3">
        {(context.storyWorlds || []).map((item) => <div key={item.id} className="rounded-lg bg-slate-950/30 p-3 text-xs">
          <p className="font-bold text-white">{item.title}</p><p className="text-muted-foreground">{item.genre} · {item.referenceGuides?.length || 0} ready guide(s)</p>
          {(item.referenceGuides || []).map((guide) => <div key={guide.id} className="mt-2 flex items-center justify-between gap-2 rounded border border-border p-2"><span className="min-w-0"><strong className="block truncate text-white">{guide.displayName}</strong><span className="text-muted-foreground">Version {guide.version || 1}</span></span><ReferenceUpload universeId={item.id} referenceGuideId={guide.id} label="Replace" onComplete={refresh} /></div>)}
          <ReferenceUpload universeId={item.id} label="Add Reference Guide" onComplete={refresh} />
        </div>)}
        <input className={inputClass} value={world.title} onChange={(e) => setWorld({ ...world, title: e.target.value })} placeholder="Story World title" />
        <input className={inputClass} value={world.genre} onChange={(e) => setWorld({ ...world, genre: e.target.value })} placeholder="Genre" />
        <textarea className={inputClass} value={world.description} onChange={(e) => setWorld({ ...world, description: e.target.value })} placeholder="World description" />
        <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={() => submitJson("/api/nexus/story-worlds", "POST", world, "Story World created.")}>Create Story World</button>
      </div>
    </details>

    <details className="rounded-lg border border-border p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-foreground"><Compass className="h-4 w-4 text-cyan-400" />Strategy Guide Library</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{(context.strategies || []).map((strategy) => <div key={strategy.id} className="rounded-lg bg-slate-950/30 p-3 text-xs"><p className="font-bold text-white">{strategy.displayName}</p><p className="mt-1 text-muted-foreground">{strategy.description}</p><p className="mt-2 text-[10px] uppercase tracking-wide text-cyan-300">Read-only · {strategy.goals.length} supported goal(s)</p></div>)}</div>
    </details>

    <details className="rounded-lg border border-border p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-foreground"><Globe2 className="h-4 w-4 text-emerald-400" />Connected Websites ({context.websites?.filter((item) => item.status === "active").length || 0}/2)</summary>
      <div className="mt-3 space-y-3">
        {(context.websites || []).map((item) => <WebsiteEditor key={item.websiteConnectionId} website={item} worlds={context.storyWorlds || []} busy={busy} onSave={(patch) => submitJson("/api/nexus/websites", "PATCH", { websiteConnectionId: item.websiteConnectionId, ...patch }, "Website settings saved.")} />)}
        {(context.websites?.filter((item) => item.status === "active").length || 0) < 2 && <>
          <input className={inputClass} value={site.displayName} onChange={(e) => setSite({ ...site, displayName: e.target.value })} placeholder="Website label" />
          <input className={inputClass} value={site.targetWpOrigin} onChange={(e) => setSite({ ...site, targetWpOrigin: e.target.value })} placeholder="https://author-site.com" />
          <input className={inputClass} value={site.wpUsername} onChange={(e) => setSite({ ...site, wpUsername: e.target.value })} placeholder="WordPress username" />
          <input className={inputClass} type="password" value={site.wpAppPassword} onChange={(e) => setSite({ ...site, wpAppPassword: e.target.value })} placeholder="WordPress Application Password" />
          <select className={inputClass} value={site.contentRole} onChange={(e) => setSite({ ...site, contentRole: e.target.value })}><option value="both">Business Brand and Story World</option><option value="business_brand">Business Brand only</option><option value="story_world">Story World only</option></select>
          <button disabled={busy} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={() => submitJson("/api/connections/verify", "POST", site, "WordPress website connected.")}>Verify and connect website</button>
        </>}
      </div>
    </details>
    {message && <p role="status" className="rounded-lg border border-border bg-slate-950/30 p-2 text-xs text-muted-foreground">{message}</p>}
  </section>;
}

function ReferenceUpload({ universeId, referenceGuideId, label, onComplete }: { universeId: string; referenceGuideId?: string; label: string; onComplete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true);
    const body = new FormData(); body.set("universeId", universeId); body.set("file", file); body.set("spoilerLevel", "public_safe"); if (referenceGuideId) body.set("referenceGuideId", referenceGuideId);
    try { const response = await fetch("/api/nexus/reference-guides", { method: "POST", credentials: "same-origin", body }); const payload = await response.json().catch(() => null) as { error?: string } | null; if (!response.ok) throw new Error(payload?.error || "Reference Guide upload failed."); await onComplete(); } finally { setBusy(false); event.target.value = ""; }
  }
  return <label className="mt-2 flex cursor-pointer items-center gap-1 text-indigo-300"><Upload className="h-3 w-3" />{busy ? "Processing guide…" : label}<input className="hidden" type="file" accept=".pdf,.docx,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={upload} disabled={busy} /></label>;
}

function WebsiteEditor({ website, worlds, busy, onSave }: { website: Website; worlds: World[]; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const [draft, setDraft] = useState({ displayName: website.displayName, contentRole: website.contentRole, defaultUniverseId: website.defaultUniverseId || "", status: website.status });
  return <div className="space-y-2 rounded-lg bg-slate-950/30 p-3 text-xs">
    <p className="break-all text-muted-foreground">{website.wordpressOrigin}</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <input className={inputClass} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} aria-label="Website display name" />
      <select className={inputClass} value={draft.contentRole} onChange={(event) => setDraft({ ...draft, contentRole: event.target.value })}><option value="both">Business Brand and Story World</option><option value="business_brand">Business Brand only</option><option value="story_world">Story World only</option></select>
      <select className={inputClass} value={draft.defaultUniverseId} onChange={(event) => setDraft({ ...draft, defaultUniverseId: event.target.value })}><option value="">No default Story World</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.title}</option>)}</select>
      <select className={inputClass} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="active">Active and verified</option><option value="disabled">Disabled</option></select>
    </div>
    <button disabled={busy} className="w-full rounded-lg border border-emerald-500/30 px-3 py-2 font-bold text-emerald-300 disabled:opacity-50" onClick={() => onSave(draft)}>Save website settings</button>
  </div>;
}

function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
