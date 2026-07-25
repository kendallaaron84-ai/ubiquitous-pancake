"use client";

import { CheckCircle2, DollarSign, MousePointerClick, UserPlus } from "lucide-react";

export interface StatCardsProps {
  monthlyBudget: number;
  onOpenMarketingBudget: () => void;
}

const TRAFFIC = 45200;
const ACTIVE_LEADS = 3100;
const CLOSED_PURCHASES = 185;

export default function StatCards({
  monthlyBudget,
  onOpenMarketingBudget,
}: StatCardsProps) {
  const conversionRate = TRAFFIC > 0
    ? ((CLOSED_PURCHASES / TRAFFIC) * 100).toFixed(1)
    : "0.0";

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article className="space-y-3 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <span>Traffic / Clicks</span>
          <MousePointerClick className="h-4 w-4 text-blue-500" />
        </div>
        <p className="text-2xl font-black">{TRAFFIC.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">Visits to your connected book pages.</p>
      </article>

      <article className="space-y-3 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <span>Active Leads</span>
          <UserPlus className="h-4 w-4 text-purple-500" />
        </div>
        <p className="text-2xl font-black">{ACTIVE_LEADS.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">Readers who have shown purchase interest.</p>
      </article>

      <article className="space-y-3 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <span>Closed Purchases</span>
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        </div>
        <p className="text-2xl font-black">{CLOSED_PURCHASES.toLocaleString()}</p>
        <p className="text-xs font-medium text-muted-foreground">Conversion: {conversionRate}%</p>
      </article>

      <button
        type="button"
        onClick={onOpenMarketingBudget}
        className="space-y-3 rounded-xl border border-border bg-card p-5 text-left text-card-foreground shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]/60"
        aria-label="Open the marketing budget planner"
      >
        <span className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <span>Monthly Budget</span>
          <DollarSign className="h-4 w-4 text-red-500" />
        </span>
        <span className="block text-2xl font-black">${monthlyBudget.toLocaleString()}</span>
        <span className="block text-[10px] text-muted-foreground">Review your marketing budget and sales targets.</span>
      </button>
    </section>
  );
}
