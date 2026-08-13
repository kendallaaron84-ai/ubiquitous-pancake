"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/layout";
import type { NexusGoal } from "@/core/nexus/contracts";
import { NEXUS_STRATEGY_CATALOG } from "@/core/nexus/strategy-library";

type Source = { strategyGuideId: string; displayName: string; description: string; status: string; activeVersion: number | null; latestVersion: number; supportedGoals: string[] };

export default function StrategySourcesPage() {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [ownerCheckComplete, setOwnerCheckComplete] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const initialStrategy = NEXUS_STRATEGY_CATALOG[0];
  const [form, setForm] = useState({ strategyGuideId: initialStrategy.id, displayName: "", description: "", supportedGoals: [...initialStrategy.goals] as NexusGoal[] });
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
      const body = new FormData(event.currentTarget);
      body.set("strategyGuideId", form.strategyGuideId);
      body.set("displayName", form.displayName);
      body.set("description", form.description);
      body.delete("supportedGoals");
      form.supportedGoals.forEach((goal) => body.append("supportedGoals", goal));
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
  const selectedCatalogEntry = NEXUS_STRATEGY_CATALOG.find((entry) => entry.id === form.strategyGuideId) || initialStrategy;
  const selectedSlotExists = sources.some((source) => source.strategyGuideId === form.strategyGuideId);
  function selectStrategySlot(strategyGuideId: string) {
    const entry = NEXUS_STRATEGY_CATALOG.find((candidate) => candidate.id === strategyGuideId) || initialStrategy;
    setForm({ ...form, strategyGuideId: entry.id, supportedGoals: [...entry.goals] });
  }
  function toggleGoal(goal: NexusGoal) {
    setForm({ ...form, supportedGoals: form.supportedGoals.includes(goal) ? form.supportedGoals.filter((item) => item !== goal) : [...form.supportedGoals, goal] });
  }
  if (!ownerCheckComplete) return null;
  return <Layout><main className="mx-auto max-w-5xl space-y-6 p-6"><header><p className="text-xs font-bold uppercase tracking-widest text-amber-400">Owner Control Plane</p><h1 className="text-2xl font-bold text-white">Strategy Intelligence Management</h1><p className="text-sm text-muted-foreground">Ingest, version, and activate approved KOBA-I strategy sources. Full source text remains private.</p></header>
    <form onSubmit={upload} className="grid gap-3 rounded-xl border border-border bg-card p-5 md:grid-cols-2">
      <select name="strategyGuideId" className={input} value={form.strategyGuideId} onChange={(e) => selectStrategySlot(e.target.value)}>{NEXUS_STRATEGY_CATALOG.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}</select>
      <input className={input} name="displayName" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Approved author-facing name" />
      <textarea className={input} name="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Approved author-facing summary" />
      <fieldset className="rounded-lg border border-border bg-slate-950/30 p-3"><legend className="px-1 text-sm font-bold text-white">Supported goals</legend><p className="mb-2 text-xs text-muted-foreground">Valid goals for {selectedCatalogEntry.displayName} are selected automatically. You may narrow this version to the goals it supports.</p><div className="grid gap-2 sm:grid-cols-2">{selectedCatalogEntry.goals.map((goal) => <label key={goal} className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={form.supportedGoals.includes(goal)} onChange={() => toggleGoal(goal)} /> {formatGoal(goal)}</label>)}</div></fieldset>
      <label className="text-sm text-muted-foreground">Approved source file<input required className="mt-1 block w-full" name="file" type="file" accept=".pdf,.docx,.txt,.md" /></label>
      <div className="flex gap-4 text-sm text-muted-foreground"><label><input name="primaryEligible" value="true" type="checkbox" defaultChecked /> Primary eligible</label><label><input name="supportingEligible" value="true" type="checkbox" defaultChecked /> Supporting eligible</label></div>
      <button disabled={busy || form.supportedGoals.length === 0} className="rounded-lg bg-amber-600 px-4 py-2 font-bold text-white disabled:opacity-50 md:col-span-2">{busy ? "Processing…" : selectedSlotExists ? "Upload New Version" : "Ingest Approved Strategy Source"}</button>
    </form>
    <section className="space-y-3">{sources.map((source) => <article key={source.strategyGuideId} className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-bold text-white">{source.displayName || source.strategyGuideId}</h2><p className="text-xs text-muted-foreground">{source.strategyGuideId} · Latest v{source.latestVersion} · Active {source.activeVersion ? `v${source.activeVersion}` : "none"}</p><p className="mt-1 text-sm text-muted-foreground">{source.description}</p></div><button disabled={busy} onClick={() => setStatus(source.strategyGuideId, source.status === "active" ? "deactivate" : "activate", source.latestVersion)} className="rounded border border-amber-500/40 px-3 py-2 text-xs font-bold text-amber-300">{source.status === "active" ? "Deactivate" : "Activate Latest"}</button></div></article>)}</section>
    {message && <p role="status" className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{message}</p>}
  </main></Layout>;
}

function formatGoal(goal: string): string {
  return goal.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
