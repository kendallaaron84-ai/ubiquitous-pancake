"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Briefcase, FileText, LayoutTemplate, Sparkles, Users } from "lucide-react";

import { useToast } from "@/hooks/use-toast";

type ContentSource = "business_brand" | "story_world";
type Goal = { value: string; label: string };
type Website = { websiteConnectionId: string; displayName: string; wordpressOrigin: string; contentRole: ContentSource | "both"; status: string };
type Guide = { id: string; displayName?: string; status?: string; active?: boolean };
type World = { id: string; title?: string; defaultReferenceGuideId?: string | null; referenceGuides?: Guide[] };
type Strategy = { id: string; displayName: string; description: string };
type ContextPayload = {
  websites?: Website[];
  storyWorlds?: World[];
  strategies?: Strategy[];
  flags?: { storyWorld?: boolean };
  error?: string;
};

const BUSINESS_GOALS: Goal[] = [
  ["automatic", "Automatic"], ["educate", "Educate"], ["build_authority", "Build authority"],
  ["create_intrigue", "Create intrigue"], ["challenge_assumptions", "Challenge assumptions"],
  ["build_audience_trust", "Build audience trust"], ["persuade", "Persuade"],
  ["drive_action", "Drive action"], ["answer_reader_question", "Answer a reader question"],
].map(([value, label]) => ({ value, label }));
const STORY_GOALS: Goal[] = [
  ["automatic", "Automatic"], ["create_intrigue", "Create intrigue"], ["deepen_character", "Deepen character"],
  ["explore_theme", "Explore theme"], ["reveal_story_world", "Reveal story world"],
  ["journal_style_entry", "Journal-style entry"], ["answer_reader_question", "Answer a reader question"],
  ["build_anticipation", "Build anticipation"], ["educate", "Educate"],
].map(([value, label]) => ({ value, label }));

export function AuthorIntakeForm() {
  const { toast } = useToast();
  const [context, setContext] = useState<ContextPayload>({});
  const [loadingContext, setLoadingContext] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [form, setForm] = useState({
    contentSource: "business_brand" as ContentSource,
    universeId: "", referenceGuideId: "", requestedGoal: "automatic",
    strategyGuideSelectionMode: "automatic", primaryStrategyGuideId: "", supportingStrategyGuideId: "",
    websiteConnectionId: "primary", topicTitle: "", targetAudience: "", customDirectives: "",
    primaryKeyword: "", secondaryKeyword: "", longTailKeyword: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    const load = () => fetch("/api/nexus/context", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ContextPayload;
        if (!response.ok) throw new Error(payload.error || "Nexus context is unavailable.");
        setContext(payload);
      })
      .catch((error) => { if (!controller.signal.aborted) setSubmissionError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingContext(false); });
    const synchronize = (event: Event) => {
      const payload = (event as CustomEvent<ContextPayload>).detail;
      if (payload) setContext(payload);
      else void load();
    };
    void load();
    window.addEventListener("koba:nexus-context-updated", synchronize);
    return () => { controller.abort(); window.removeEventListener("koba:nexus-context-updated", synchronize); };
  }, []);

  const worlds = context.storyWorlds || [];
  const selectedWorld = worlds.find((world) => world.id === form.universeId);
  const guides = (selectedWorld?.referenceGuides || []).filter((guide) => guide.status === "ready");
  const websites = (context.websites || []).filter((site) => site.status === "active");
  const selectedWebsite = websites.find(
    (site) => site.websiteConnectionId === form.websiteConnectionId
  );
  const selectedWebsiteAcceptsSource = Boolean(
    selectedWebsite &&
      (selectedWebsite.contentRole === "both" || selectedWebsite.contentRole === form.contentSource)
  );
  const goals = form.contentSource === "business_brand" ? BUSINESS_GOALS : STORY_GOALS;
  const strategies = context.strategies || [];
  const canSubmit = useMemo(() => Boolean(
    form.topicTitle.trim() && form.targetAudience.trim() && selectedWebsiteAcceptsSource &&
    (form.contentSource === "business_brand" || (form.universeId && form.referenceGuideId))
  ), [form, selectedWebsiteAcceptsSource]);

  useEffect(() => {
    setForm((current) => {
      const eligibleWebsites = (context.websites || []).filter(
        (site) =>
          site.status === "active" &&
          (site.contentRole === "both" || site.contentRole === current.contentSource)
      );
      if (eligibleWebsites.some((site) => site.websiteConnectionId === current.websiteConnectionId)) {
        return current;
      }
      return {
        ...current,
        websiteConnectionId: eligibleWebsites[0]?.websiteConnectionId || "",
      };
    });
  }, [context.websites, form.contentSource]);

  useEffect(() => {
    if (form.contentSource !== "story_world" || !selectedWorld) return;
    const ready = (selectedWorld.referenceGuides || []).filter((guide) => guide.status === "ready");
    const preferred = ready.find((guide) => guide.id === selectedWorld.defaultReferenceGuideId) || ready.find((guide) => guide.active) || (ready.length === 1 ? ready[0] : undefined);
    if (ready.some((guide) => guide.id === form.referenceGuideId)) return;
    setForm((current) => ({ ...current, referenceGuideId: preferred?.id || "" }));
  }, [form.contentSource, form.referenceGuideId, selectedWorld]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      setSubmissionError("Complete the topic, audience, destination website, and required knowledge source.");
      return;
    }
    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const response = await fetch("/api/nexus/blueprints", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          seoKeywords: { primary: form.primaryKeyword, secondary: form.secondaryKeyword, longTail: form.longTailKeyword },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => null) as { blueprintId?: string; error?: string } | null;
      if (response.status !== 202 || !payload?.blueprintId) throw new Error(payload?.error || "The Nexus SEO Engine did not accept this request.");
      toast({ title: "SEO draft queued", description: "The article, SEO package, social copy, and featured image are building in the background." });
      setForm((current) => ({ ...current, topicTitle: "", targetAudience: "", customDirectives: "", primaryKeyword: "", secondaryKeyword: "", longTailKeyword: "" }));
    } catch (error) {
      const message = errorMessage(error);
      setSubmissionError(message);
      toast({ title: "SEO draft request failed", description: message, variant: "destructive" });
    } finally { setIsSubmitting(false); }
  }

  const inputClass = "w-full rounded-xl border border-border bg-slate-950/50 px-4 py-3 text-sm text-white focus:border-emerald-500/50 focus:outline-none";
  return (
    <form onSubmit={handleSubmit} className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <div className="border-b border-border bg-slate-950/40 p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold text-white"><Sparkles className="h-5 w-5 text-emerald-500" />Create SEO Draft</h2>
        <p className="mt-1 text-xs text-muted-foreground">Choose the knowledge source, strategy, audience, and verified WordPress destination.</p>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Content Source" icon={<Briefcase className="h-3 w-3" />}>
            <select className={inputClass} value={form.contentSource} onChange={(e) => {
              const contentSource = e.target.value as ContentSource;
              setForm((current) => ({ ...current, contentSource, universeId: "", referenceGuideId: "", requestedGoal: "automatic", websiteConnectionId: "" }));
            }}><option value="business_brand">Business Brand</option><option value="story_world" disabled={!loadingContext && context.flags?.storyWorld !== true}>Story World</option></select>
          </Field>
          <Field label="Blog Goal" icon={<Sparkles className="h-3 w-3" />}>
            <select className={inputClass} value={form.requestedGoal} onChange={(e) => update("requestedGoal", e.target.value)}>{goals.map((goal) => <option key={goal.value} value={goal.value}>{goal.label}</option>)}</select>
          </Field>
        </div>

        {form.contentSource === "story_world" && <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
          <Field label="Story World"><select className={inputClass} required value={form.universeId} onChange={(e) => setForm((current) => ({ ...current, universeId: e.target.value, referenceGuideId: "" }))}><option value="">Select a Story World</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.title || world.id}</option>)}</select></Field>
          <Field label="Reference Guide"><select className={inputClass} required value={form.referenceGuideId} onChange={(e) => update("referenceGuideId", e.target.value)} disabled={!form.universeId || guides.length === 0}><option value="">{!form.universeId ? "Select a Story World first" : guides.length === 0 ? "No ready guides — manage this Story World" : "Select a ready guide"}</option>{guides.map((guide) => <option key={guide.id} value={guide.id}>{guide.displayName || guide.id}</option>)}</select>{form.universeId && guides.length === 0 && <p className="mt-1 text-[11px] text-amber-300">Upload or finish processing a Reference Guide under Knowledge & Strategy before creating this draft.</p>}</Field>
        </div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Destination Website"><select className={inputClass} required value={form.websiteConnectionId} onChange={(e) => update("websiteConnectionId", e.target.value)}><option value="">Select a verified site</option>{websites.map((site) => { const acceptsSource = site.contentRole === "both" || site.contentRole === form.contentSource; return <option key={site.websiteConnectionId} value={site.websiteConnectionId} disabled={!acceptsSource}>{site.displayName} — {site.wordpressOrigin}{acceptsSource ? "" : " (different content role)"}</option>; })}</select></Field>
          <Field label="Strategy Selection"><select className={inputClass} value={form.strategyGuideSelectionMode} onChange={(e) => update("strategyGuideSelectionMode", e.target.value)}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></Field>
        </div>

        {form.strategyGuideSelectionMode === "manual" && <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <Field label="Primary Strategy Guide"><select required className={inputClass} value={form.primaryStrategyGuideId} onChange={(e) => update("primaryStrategyGuideId", e.target.value)}><option value="">Select one primary guide</option>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.displayName}</option>)}</select></Field>
          <Field label="Supporting Guide (optional)"><select className={inputClass} value={form.supportingStrategyGuideId} onChange={(e) => update("supportingStrategyGuideId", e.target.value)}><option value="">No supporting guide</option>{strategies.filter((strategy) => strategy.id !== form.primaryStrategyGuideId).map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.displayName}</option>)}</select></Field>
        </div>}

        <Field label="Working Title / Topic" icon={<FileText className="h-3 w-3" />}><input className={inputClass} required value={form.topicTitle} onChange={(e) => update("topicTitle", e.target.value)} placeholder="e.g. 5 Reasons Audiobooks Outsell Print" /></Field>
        <Field label="Target Audience" icon={<Users className="h-3 w-3" />}><input className={inputClass} required value={form.targetAudience} onChange={(e) => update("targetAudience", e.target.value)} placeholder="e.g. Independent thriller readers" /></Field>

        <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">SEO Keywords — up to three</p>
          <div className="grid gap-3 md:grid-cols-3">
            <input className={inputClass} maxLength={160} value={form.primaryKeyword} onChange={(e) => update("primaryKeyword", e.target.value)} placeholder="Primary keyword" />
            <input className={inputClass} maxLength={160} value={form.secondaryKeyword} onChange={(e) => update("secondaryKeyword", e.target.value)} placeholder="Secondary keyword" />
            <input className={inputClass} maxLength={200} value={form.longTailKeyword} onChange={(e) => update("longTailKeyword", e.target.value)} placeholder="Long-tail keyword" />
          </div>
        </div>
        <Field label="Custom Directives" icon={<LayoutTemplate className="h-3 w-3" />}><textarea className={`${inputClass} h-28 resize-none`} value={form.customDirectives} onChange={(e) => update("customDirectives", e.target.value)} placeholder="Add tone, message, exclusions, or points the draft must cover." /></Field>
        {loadingContext && <p className="text-xs text-muted-foreground">Loading verified knowledge and website destinations…</p>}
        {submissionError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><p className="font-semibold">Your draft request was not completed.</p><p className="mt-1 text-xs">{submissionError}</p></div>}
      </div>
      <div className="border-t border-border p-2"><button type="submit" disabled={isSubmitting || loadingContext || !canSubmit} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? "Creating SEO Draft…" : <>Create SEO Draft <Sparkles className="h-4 w-4" /></>}</button></div>
    </form>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{icon}{label}</label>{children}</div>;
}
function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "The queue did not confirm this request in time. Your form was preserved.";
  return error instanceof Error ? error.message : "The SEO draft request could not be completed.";
}
