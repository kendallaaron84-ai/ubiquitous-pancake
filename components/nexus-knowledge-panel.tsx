"use client";

import React, { useEffect, useState } from "react";
import { Archive, BookOpen, Building2, CheckCircle2, Compass, Eye, Globe2, Pencil, Trash2, Upload, X } from "lucide-react";

type Website = { websiteConnectionId: string; displayName: string; wordpressOrigin: string; contentRole: string; defaultUniverseId?: string | null; status: string };
type GuideStatus = "processing" | "ready" | "failed" | "archived" | "incomplete";
type Guide = { id: string; displayName?: string; version?: number; wordCount?: number; extractedCharacterCount?: number; status?: GuideStatus; active?: boolean; failureReason?: string | null; createdAt?: unknown; updatedAt?: unknown };
type World = { id: string; title?: string; genre?: string; description?: string; status?: "active" | "archived"; defaultReferenceGuideId?: string | null; referenceGuides?: Guide[] };
type GuideDetail = { referenceGuideId: string; displayName: string; version: number; requestedVersion: number; canonical: boolean; status: GuideStatus; normalizedText: string; spoilerPolicy: { thingsSafeToDiscuss: string; thingsNeverToReveal: string }; versions: Array<{ version: number; status: string; wordCount: number; characterCount: number; createdAt?: unknown }> };
type Strategy = { id: string; displayName: string; description: string; goals: string[] };
type ContextPayload = {
  websites?: Website[];
  storyWorlds?: World[];
  strategies?: Strategy[];
  businessProfile?: Record<string, unknown> | null;
  flags?: { storyWorld?: boolean };
};

const inputClass = "w-full rounded-lg border border-border bg-slate-950/50 px-3 py-2 text-xs text-white focus:border-emerald-500/50 focus:outline-none";

export function NexusKnowledgePanel({ isOwner = false }: { isOwner?: boolean }) {
  const [context, setContext] = useState<ContextPayload>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [business, setBusiness] = useState({ businessName: "", coreValues: "", toneOfVoice: "", targetAudience: "", brandSummary: "" });
  const [world, setWorld] = useState({ title: "", genre: "", description: "" });
  const [site, setSite] = useState({ targetWpOrigin: "", wpUsername: "", wpAppPassword: "", displayName: "", contentRole: "both" });
  const [managedWorldId, setManagedWorldId] = useState<string | null>(null);
  const [editingWorldId, setEditingWorldId] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/nexus/context", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json() as ContextPayload & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Knowledge settings could not be loaded.");
    setContext(payload);
    window.dispatchEvent(new CustomEvent("koba:nexus-context-updated", { detail: payload }));
    if (payload.businessProfile) setBusiness((current) => ({
      businessName: stringValue(payload.businessProfile?.businessName) || current.businessName,
      coreValues: stringValue(payload.businessProfile?.coreValues) || current.coreValues,
      toneOfVoice: stringValue(payload.businessProfile?.toneOfVoice) || current.toneOfVoice,
      targetAudience: stringValue(payload.businessProfile?.targetAudience) || current.targetAudience,
      brandSummary: stringValue(payload.businessProfile?.brandSummary) || current.brandSummary,
    }));
  }

  const managedWorld = (context.storyWorlds || []).find((item) => item.id === managedWorldId) || null;

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

    {context.flags?.storyWorld === true ? <details className="rounded-lg border border-border p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-foreground"><BookOpen className="h-4 w-4 text-indigo-400" />Story Worlds & Reference Guides</summary>
      <div className="mt-3 space-y-3">
        {(context.storyWorlds || []).map((item) => {
          const guides = item.referenceGuides || [];
          const active = guides.find((guide) => guide.active);
          const count = (status: GuideStatus) => guides.filter((guide) => guide.status === status).length;
          return <div key={item.id} className="rounded-lg border border-indigo-500/20 bg-slate-950/30 p-4 text-xs">
            <p className="text-base font-bold text-white">{item.title || item.id}</p>
            {item.genre && <p className="mt-0.5 text-muted-foreground">{item.genre}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
              <div><dt className="font-semibold text-foreground">Active Guide</dt><dd className="truncate">{active?.displayName || "None"}</dd></div>
              <div><dt className="font-semibold text-foreground">Ready Guides</dt><dd>{count("ready")}</dd></div>
              <div><dt className="font-semibold text-foreground">Processing</dt><dd>{count("processing")}</dd></div>
              <div><dt className="font-semibold text-foreground">Failed</dt><dd>{count("failed") + count("incomplete")}</dd></div>
            </dl>
            {editingWorldId === item.id ? <StoryWorldEditor world={item} busy={busy} onCancel={() => setEditingWorldId(null)} onSave={async (patch) => { await submitJson("/api/nexus/story-worlds", "PATCH", { universeId: item.id, ...patch }, "Story World updated."); setEditingWorldId(null); }} /> : <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="flex-1 rounded-lg border border-indigo-400/40 px-3 py-2 font-bold text-indigo-200 hover:bg-indigo-500/10" onClick={() => setManagedWorldId(item.id)}>Manage Reference Guides</button>
              <button type="button" className="rounded-lg border border-border px-3 py-2 font-bold text-foreground" onClick={() => setEditingWorldId(item.id)}><Pencil className="mr-1 inline h-3 w-3" />Edit Story World</button>
              <button type="button" disabled={busy} className="rounded-lg border border-border px-3 py-2 font-bold text-muted-foreground disabled:opacity-50" onClick={() => submitJson("/api/nexus/story-worlds", "PATCH", { universeId: item.id, title: item.title, genre: item.genre, description: item.description, status: item.status === "archived" ? "active" : "archived" }, item.status === "archived" ? "Story World reactivated." : "Story World archived.")}>{item.status === "archived" ? "Reactivate" : "Archive"}</button>
            </div>}
          </div>;
        })}
        {(context.storyWorlds || []).length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">Create a Story World first. Its Reference Guides will be managed from one focused screen.</p>}
        <input className={inputClass} value={world.title} onChange={(e) => setWorld({ ...world, title: e.target.value })} placeholder="Story World title" />
        <input className={inputClass} value={world.genre} onChange={(e) => setWorld({ ...world, genre: e.target.value })} placeholder="Genre" />
        <textarea className={inputClass} value={world.description} onChange={(e) => setWorld({ ...world, description: e.target.value })} placeholder="World description" />
        <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={() => submitJson("/api/nexus/story-worlds", "POST", world, "Story World created.")}>Create Story World</button>
      </div>
    </details> : <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground"><p className="flex items-center gap-2 font-bold text-foreground"><BookOpen className="h-4 w-4 text-indigo-400" />Story Worlds & Reference Guides</p><p className="mt-2">Story World authoring is not available for your account.</p></div>}

    <details className="rounded-lg border border-border p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-foreground"><Compass className="h-4 w-4 text-cyan-400" />Available Strategies</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{(context.strategies || []).map((strategy) => <div key={strategy.id} className="rounded-lg bg-slate-950/30 p-3 text-xs"><p className="font-bold text-white">{strategy.displayName}</p><p className="mt-1 text-muted-foreground">{strategy.description}</p><p className="mt-2 text-[10px] uppercase tracking-wide text-cyan-300">Read-only · {strategy.goals.length} supported goal(s)</p></div>)}</div>
      {isOwner && <a href="/admin/nexus-strategy-sources" className="mt-3 block rounded-lg border border-amber-500/30 px-3 py-2 text-center text-xs font-bold text-amber-300">Open Strategy Intelligence Management</a>}
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
    {managedWorld && <ReferenceGuideManager world={managedWorld} busy={busy} onClose={() => setManagedWorldId(null)} onRefresh={refresh} onAction={(referenceGuideId, action) => submitJson("/api/nexus/reference-guides", "PATCH", { universeId: managedWorld.id, referenceGuideId, action }, action === "set_active" ? "Active Reference Guide updated." : action === "archive" ? "Reference Guide archived." : action === "delete_incomplete" ? "Incomplete Reference Guide deleted." : "Active Reference Guide cleared.")} />}
  </section>;
}

function ReferenceGuideManager({ world, busy, onClose, onRefresh, onAction }: { world: World; busy: boolean; onClose: () => void; onRefresh: () => Promise<void>; onAction: (referenceGuideId: string, action: "set_active" | "archive" | "clear_active" | "delete_incomplete") => Promise<void> }) {
  const guides = world.referenceGuides || [];
  const processing = guides.some((guide) => guide.status === "processing");
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  return <div role="dialog" aria-modal="true" aria-label={`Manage Reference Guides for ${world.title || world.id}`} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-indigo-500/30 bg-card p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-white">{world.title || world.id}</h3><p className="text-xs text-muted-foreground">Reference Guide lifecycle and active canon source</p></div><button type="button" aria-label="Close Reference Guide manager" onClick={onClose}><X className="h-5 w-5" /></button></div>
      <div className="mt-4 space-y-3">
        {guides.map((guide) => <article key={guide.id} className="rounded-xl border border-border bg-slate-950/30 p-4 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-bold text-white">{guide.displayName || guide.id}</p><p className="text-muted-foreground">ID {guide.id} · Version {guide.version || 1}</p></div><span className={`rounded-full px-2 py-1 font-bold uppercase ${guide.status === "ready" ? "bg-emerald-500/15 text-emerald-300" : guide.status === "failed" || guide.status === "incomplete" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>{guide.active ? "active · " : ""}{guide.status || "incomplete"}</span></div>
          <p className="mt-2 text-muted-foreground">{(guide.wordCount || 0).toLocaleString()} words · {(guide.extractedCharacterCount || 0).toLocaleString()} characters</p>
          <p className="mt-1 text-muted-foreground">Created {formatTimestamp(guide.createdAt)} · Updated {formatTimestamp(guide.updatedAt)}</p>
          {guide.failureReason && <p className="mt-2 rounded bg-red-500/10 p-2 text-red-200">{guide.failureReason}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {guide.status === "ready" && <button disabled={busy} className="rounded border border-indigo-500/30 px-3 py-1.5 font-semibold text-indigo-200 disabled:opacity-50" onClick={() => setSelectedGuideId(guide.id)}><Eye className="mr-1 inline h-3 w-3" />View Current Guide</button>}
            {guide.status === "ready" && !guide.active && <button disabled={busy} className="rounded border border-emerald-500/30 px-3 py-1.5 font-semibold text-emerald-300 disabled:opacity-50" onClick={() => onAction(guide.id, "set_active")}><CheckCircle2 className="mr-1 inline h-3 w-3" />Set Active</button>}
            {!guide.active && guide.status === "ready" && <button disabled={busy} className="rounded border border-border px-3 py-1.5 font-semibold disabled:opacity-50" onClick={() => onAction(guide.id, "archive")}><Archive className="mr-1 inline h-3 w-3" />Archive</button>}
            {!guide.active && (guide.status === "failed" || guide.status === "incomplete") && <button disabled={busy} className="rounded border border-red-500/30 px-3 py-1.5 font-semibold text-red-300 disabled:opacity-50" onClick={() => { if (window.confirm("Permanently delete this unused failed or incomplete Reference Guide?")) void onAction(guide.id, "delete_incomplete"); }}><Trash2 className="mr-1 inline h-3 w-3" />Delete Incomplete</button>}
          </div>
          {guide.status === "ready" && <ReferenceUpload universeId={world.id} referenceGuideId={guide.id} label="Upload New Version" onComplete={onRefresh} disabled={processing} />}
        </article>)}
        {guides.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">No Reference Guides yet. Upload a public-safe guide to make Story World generation available.</p>}
      </div>
      <ReferenceUpload universeId={world.id} label="Add Reference Guide" onComplete={onRefresh} disabled={processing} />
      {guides.some((guide) => guide.active) && <button disabled={busy} type="button" className="mt-3 text-xs text-muted-foreground underline" onClick={() => onAction("", "clear_active")}>Use no active Reference Guide</button>}
      {selectedGuideId && <ReferenceGuideDetail world={world} referenceGuideId={selectedGuideId} onClose={() => setSelectedGuideId(null)} onComplete={async () => { await onRefresh(); }} />}
    </div>
  </div>;
}

function StoryWorldEditor({ world, busy, onCancel, onSave }: { world: World; busy: boolean; onCancel: () => void; onSave: (patch: { title: string; genre: string; description: string; status: "active" | "archived" }) => Promise<void> }) {
  const [draft, setDraft] = useState({ title: world.title || "", genre: world.genre || "", description: world.description || "", status: world.status === "archived" ? "archived" as const : "active" as const });
  return <div className="mt-4 space-y-2 rounded-lg border border-indigo-500/20 p-3">
    <input className={inputClass} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Story World title" />
    <input className={inputClass} value={draft.genre} onChange={(event) => setDraft({ ...draft, genre: event.target.value })} placeholder="Genre" />
    <textarea className={inputClass} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="World description" rows={4} />
    <div className="flex gap-2"><button type="button" disabled={busy || !draft.title.trim() || !draft.genre.trim() || !draft.description.trim()} className="flex-1 rounded bg-indigo-600 px-3 py-2 font-bold text-white disabled:opacity-50" onClick={() => onSave(draft)}>Save Story World</button><button type="button" className="rounded border border-border px-3 py-2" onClick={onCancel}>Cancel</button></div>
  </div>;
}

function ReferenceGuideDetail({ world, referenceGuideId, onClose, onComplete }: { world: World; referenceGuideId: string; onClose: () => void; onComplete: () => Promise<void> }) {
  const [detail, setDetail] = useState<GuideDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [safeToDiscuss, setSafeToDiscuss] = useState("");
  const [neverReveal, setNeverReveal] = useState("");
  const [editing, setEditing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("Loading guide…");
  const [busy, setBusy] = useState(false);

  async function load(version?: number) {
    setBusy(true); setMessage("Loading guide…");
    try {
      const query = new URLSearchParams({ universeId: world.id, referenceGuideId });
      if (version) query.set("version", String(version));
      const response = await fetch(`/api/nexus/reference-guides?${query.toString()}`, { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json().catch(() => null) as { guide?: GuideDetail; error?: string } | null;
      if (!response.ok || !payload?.guide) throw new Error(payload?.error || "The Reference Guide could not be loaded.");
      setDetail(payload.guide); setDraft(payload.guide.normalizedText); setSafeToDiscuss(payload.guide.spoilerPolicy.thingsSafeToDiscuss); setNeverReveal(payload.guide.spoilerPolicy.thingsNeverToReveal); setEditing(false); setAcknowledged(false); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The Reference Guide could not be loaded."); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [referenceGuideId, world.id]);

  async function saveNewVersion() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/nexus/reference-guides", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ universeId: world.id, referenceGuideId, clientRequestId: crypto.randomUUID().replace(/-/g, ""), normalizedText: draft, thingsSafeToDiscuss: safeToDiscuss, thingsNeverToReveal: neverReveal, publicSafeAcknowledged: acknowledged }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "The new Reference Guide version could not be saved.");
      setMessage("New Reference Guide version saved."); await onComplete(); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The new Reference Guide version could not be saved."); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 p-4" role="dialog" aria-modal="true" aria-label="Reference Guide details">
    <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-indigo-500/30 bg-card p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><h4 className="text-lg font-bold text-white">{detail?.displayName || "Reference Guide"}</h4><p className="text-xs text-muted-foreground">{detail?.canonical ? "Canonical Guide" : "Available Guide"} · Version {detail?.requestedVersion || "—"}</p></div><button type="button" aria-label="Close guide details" onClick={onClose}><X className="h-5 w-5" /></button></div>
      {detail && <>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">{detail.versions.map((version) => <button key={version.version} type="button" disabled={busy} className={`rounded border px-3 py-1.5 ${version.version === detail.requestedVersion ? "border-indigo-400 text-indigo-200" : "border-border text-muted-foreground"}`} onClick={() => load(version.version)}>Version {version.version} · {version.wordCount.toLocaleString()} words</button>)}</div>
        <textarea className={`${inputClass} mt-4 min-h-[320px] font-mono leading-relaxed`} value={draft} readOnly={!editing} onChange={(event) => setDraft(event.target.value)} aria-label="Reference Guide text" />
        {editing ? <div className="mt-3 space-y-2"><textarea className={inputClass} value={safeToDiscuss} onChange={(event) => setSafeToDiscuss(event.target.value)} placeholder="Things safe to discuss" rows={2} /><textarea className={inputClass} value={neverReveal} onChange={(event) => setNeverReveal(event.target.value)} placeholder="Things never to reveal" rows={2} /><label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I confirm this version contains only public-facing information the Nexus SEO Engine may discuss.</span></label><div className="flex gap-2"><button type="button" disabled={busy || !acknowledged} className="flex-1 rounded bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={saveNewVersion}>Save as New Version</button><button type="button" className="rounded border border-border px-3 py-2 text-xs" onClick={() => { setEditing(false); setDraft(detail.normalizedText); }}>Cancel</button></div></div> : <button type="button" disabled={busy || detail.requestedVersion !== detail.version} className="mt-3 rounded border border-indigo-500/30 px-3 py-2 text-xs font-bold text-indigo-200 disabled:opacity-50" onClick={() => setEditing(true)}><Pencil className="mr-1 inline h-3 w-3" />Edit as New Version</button>}
      </>}
      {message && <p role="status" className="mt-3 rounded border border-border p-2 text-xs text-muted-foreground">{message}</p>}
    </div>
  </div>;
}

function ReferenceUpload({ universeId, referenceGuideId, label, onComplete, disabled = false }: { universeId: string; referenceGuideId?: string; label: string; onComplete: () => Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [safeToDiscuss, setSafeToDiscuss] = useState("");
  const [neverReveal, setNeverReveal] = useState("");
  const [message, setMessage] = useState("");
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setMessage("");
    const body = new FormData(); body.set("universeId", universeId); body.set("file", file); body.set("clientRequestId", crypto.randomUUID().replace(/-/g, "")); body.set("spoilerLevel", "public_safe"); body.set("publicSafeAcknowledged", String(acknowledged)); body.set("thingsSafeToDiscuss", safeToDiscuss); body.set("thingsNeverToReveal", neverReveal); if (referenceGuideId) body.set("referenceGuideId", referenceGuideId);
    try { const response = await fetch("/api/nexus/reference-guides", { method: "POST", credentials: "same-origin", body }); const payload = await response.json().catch(() => null) as { error?: string; wordCount?: number; characterCount?: number } | null; if (!response.ok) throw new Error(payload?.error || "Reference Guide upload failed."); setMessage(`Ready: ${(payload?.wordCount || 0).toLocaleString()} words and ${(payload?.characterCount || 0).toLocaleString()} characters.`); setAcknowledged(false); await onComplete(); } catch (error) { setMessage(error instanceof Error ? error.message : "Reference Guide upload failed."); } finally { setBusy(false); event.target.value = ""; }
  }
  return <div className="mt-3 space-y-2 rounded-md bg-indigo-950/20 p-2 text-[11px] text-muted-foreground">
    <p>Upload 300–5,000 normalized words, with no more than 30,000 normalized characters. Around 3,000 words is recommended. Oversized files are rejected and never silently shortened.</p>
    <p>Include only public-safe canon the engine may discuss. Put protected outcomes, twists, identities, or future-book material in <strong className="text-foreground">Things never to reveal</strong> before generating.</p>
    <textarea className={inputClass} value={safeToDiscuss} onChange={(event) => setSafeToDiscuss(event.target.value)} placeholder="Things safe to discuss (optional)" rows={2} />
    <textarea className={inputClass} value={neverReveal} onChange={(event) => setNeverReveal(event.target.value)} placeholder="Things never to reveal (spoilers and protected canon)" rows={2} />
    <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5" /><span>I confirm this Reference Guide contains only public-facing information the Nexus SEO Engine may discuss.</span></label>
    <label className={`flex items-center gap-1 ${acknowledged && !busy && !disabled ? "cursor-pointer text-indigo-300" : "cursor-not-allowed opacity-50"}`}><Upload className="h-3 w-3" />{busy ? "Uploading and processing…" : disabled ? "Wait for the current upload to finish" : label}<input className="hidden" type="file" accept=".pdf,.docx,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={upload} disabled={busy || disabled || !acknowledged} /></label>
    {message && <p role="status" className="text-indigo-200">{message}</p>}
  </div>;
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

function formatTimestamp(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toLocaleString();
  }
  if (value && typeof value === "object" && "seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000).toLocaleString();
  }
  return "pending";
}
