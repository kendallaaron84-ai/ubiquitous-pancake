"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/layout";

type Source = { strategyGuideId: string; displayName: string; description: string; status: string; activeVersion: number | null; latestVersion: number; supportedGoals: string[] };

export default function StrategySourcesPage() {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [ownerCheckComplete, setOwnerCheckComplete] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ strategyGuideId: "strategy_persuasion", displayName: "", description: "", supportedGoals: "persuade" });
  async function refresh() {
    const response = await fetch("/api/nexus/strategy-sources", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json() as { strategies?: Source[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Strategy sources could not be loaded.");
    setSources(payload.strategies || []);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Owner session unavailable.");
        return response.json() as Promise<{ isOwner?: boolean }>;
      })
      .then(async (payload) => {
        if (payload.isOwner !== true) { router.replace("/products"); return; }
        setOwnerCheckComplete(true);
        await refresh();
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        router.replace("/products");
      });
    return () => controller.abort();
  }, [router]);
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const body = new FormData(event.currentTarget); Object.entries(form).forEach(([key, value]) => body.set(key, value));
      const response = await fetch("/api/nexus/strategy-sources", { method: "POST", credentials: "same-origin", body });
      const payload = await response.json() as { error?: string; version?: number };
      if (!response.ok) throw new Error(payload.error || "Strategy source ingestion failed.");
      setMessage(`Approved strategy source version ${payload.version} stored privately. Activate it when ready.`); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Strategy source ingestion failed."); } finally { setBusy(false); }
  }
  async function setStatus(strategyGuideId: string, action: "activate" | "deactivate", version?: number) {
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/nexus/strategy-sources", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategyGuideId, action, version }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || "Strategy status could not be changed."); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Strategy status could not be changed."); } finally { setBusy(false); }
  }
  const input = "w-full rounded-lg border border-border bg-slate-950/50 px-3 py-2 text-sm text-white";
  if (!ownerCheckComplete) return null;
  return <Layout><main className="mx-auto max-w-5xl space-y-6 p-6"><header><p className="text-xs font-bold uppercase tracking-widest text-amber-400">Owner Control Plane</p><h1 className="text-2xl font-bold text-white">Strategy Intelligence Management</h1><p className="text-sm text-muted-foreground">Ingest, version, and activate approved KOBA-I strategy sources. Full source text remains private.</p></header>
    <form onSubmit={upload} className="grid gap-3 rounded-xl border border-border bg-card p-5 md:grid-cols-2">
      <select name="strategyGuideId" className={input} value={form.strategyGuideId} onChange={(e) => setForm({ ...form, strategyGuideId: e.target.value })}><option value="strategy_persuasion">Persuasion</option><option value="strategy_brand_positioning">Brand Positioning</option><option value="strategy_audience_building">Audience Building</option><option value="strategy_intrigue">Intrigue</option><option value="strategy_conversion_copy">Conversion Copy</option><option value="strategy_trust_authority">Trust &amp; Authority</option></select>
      <input className={input} name="displayName" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Approved author-facing name" />
      <textarea className={input} name="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Approved author-facing summary" />
      <input className={input} name="supportedGoals" value={form.supportedGoals} onChange={(e) => setForm({ ...form, supportedGoals: e.target.value })} placeholder="Comma-separated supported goal IDs" />
      <label className="text-sm text-muted-foreground">Approved source file<input required className="mt-1 block w-full" name="file" type="file" accept=".pdf,.docx,.txt,.md" /></label>
      <div className="flex gap-4 text-sm text-muted-foreground"><label><input name="primaryEligible" value="true" type="checkbox" defaultChecked /> Primary eligible</label><label><input name="supportingEligible" value="true" type="checkbox" defaultChecked /> Supporting eligible</label></div>
      <button disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2 font-bold text-white disabled:opacity-50 md:col-span-2">{busy ? "Processing…" : "Ingest Approved Strategy Source"}</button>
    </form>
    <section className="space-y-3">{sources.map((source) => <article key={source.strategyGuideId} className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-bold text-white">{source.displayName || source.strategyGuideId}</h2><p className="text-xs text-muted-foreground">{source.strategyGuideId} · Latest v{source.latestVersion} · Active {source.activeVersion ? `v${source.activeVersion}` : "none"}</p><p className="mt-1 text-sm text-muted-foreground">{source.description}</p></div><button disabled={busy} onClick={() => setStatus(source.strategyGuideId, source.status === "active" ? "deactivate" : "activate", source.latestVersion)} className="rounded border border-amber-500/40 px-3 py-2 text-xs font-bold text-amber-300">{source.status === "active" ? "Deactivate" : "Activate Latest"}</button></div></article>)}</section>
    {message && <p role="status" className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{message}</p>}
  </main></Layout>;
}
