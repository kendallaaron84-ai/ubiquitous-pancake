"use client";

import React, { useMemo, useState } from "react";

type Timeline = "month" | "quarter" | "year";

export interface BookSalesGoalProduct {
  id: string;
  name?: string | null;
  targetUnits?: number | null;
  unitPrice?: number | null;
  currentSales?: number | null;
  salesGoal?: number | null;
  status?: string | null;
}

const MONTHLY_DATASET = [
  { month: "Jan", clicks: 12400, leads: 850, sales: 45 },
  { month: "Feb", clicks: 14200, leads: 920, sales: 52 },
  { month: "Mar", clicks: 18500, leads: 1100, sales: 68 },
  { month: "Apr", clicks: 22000, leads: 1400, sales: 85 },
  { month: "May", clicks: 28400, leads: 1950, sales: 120 },
  { month: "Jun", clicks: 31000, leads: 2200, sales: 145 },
  { month: "Jul", clicks: 35000, leads: 2500, sales: 168 },
  { month: "Aug", clicks: 32000, leads: 2100, sales: 150 },
  { month: "Sep", clicks: 38000, leads: 2700, sales: 195 },
  { month: "Oct", clicks: 42000, leads: 3100, sales: 220 },
  { month: "Nov", clicks: 45200, leads: 3400, sales: 255 },
  { month: "Dec", clicks: 48000, leads: 3800, sales: 290 },
] as const;

const TIMELINE_CONFIG = {
  month: { multiplier: 1, label: "Month", costLabel: "/mo" },
  quarter: { multiplier: 3, label: "Quarter", costLabel: "/quarter" },
  year: { multiplier: 12, label: "Fiscal Year", costLabel: "/year" },
} as const satisfies Record<Timeline, {
  multiplier: number;
  label: string;
  costLabel: string;
}>;

export interface BookSalesGoalsProps {
  monthlyBudget?: number;
  annualRevenueGoal?: number;
  bookPrice?: number | null;
  isBookPriceLoading?: boolean;
  products?: readonly BookSalesGoalProduct[];
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatCurrency(value: number | null | undefined) {
  return isFiniteNumber(value) ? `$${value.toLocaleString()}` : "—";
}

export function ReaderJourney() {
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  return (
    <section className="relative min-w-0 space-y-6 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="space-y-0.5">
          <h3 className="text-lg font-bold tracking-tight">Reader Journey</h3>
          <p className="text-xs text-muted-foreground">
            See how readers move from discovering your books to completing a purchase.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] font-bold tracking-tight sm:gap-4">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Traffic / Clicks</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-purple-500" /> Active Leads</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Closed Purchases</span>
        </div>
      </div>

      <div className="relative flex h-48 items-end justify-between border-b border-border px-1 pt-8 sm:px-2">
        {hoveredMonth !== null && (
          <div
            className="pointer-events-none absolute top-0 z-30 space-y-1.5 rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xl"
            style={{ left: `${Math.min((hoveredMonth / MONTHLY_DATASET.length) * 100 + 4, 72)}%` }}
          >
            <div className="border-b border-border pb-1 font-mono font-bold uppercase tracking-wider text-muted-foreground">
              {MONTHLY_DATASET[hoveredMonth].month} Reader Activity
            </div>
            <div className="flex justify-between gap-5"><span>Traffic:</span><span className="font-mono font-bold text-blue-500">{MONTHLY_DATASET[hoveredMonth].clicks.toLocaleString()}</span></div>
            <div className="flex justify-between gap-5"><span>Leads:</span><span className="font-mono font-bold text-purple-500">{MONTHLY_DATASET[hoveredMonth].leads.toLocaleString()}</span></div>
            <div className="flex justify-between gap-5"><span>Purchases:</span><span className="font-mono font-bold text-emerald-500">{MONTHLY_DATASET[hoveredMonth].sales.toLocaleString()}</span></div>
          </div>
        )}

        {MONTHLY_DATASET.map((data, index) => (
          <div
            key={data.month}
            className="group relative flex h-full min-w-0 flex-1 cursor-pointer items-end justify-center px-0.5 sm:px-1"
            onMouseEnter={() => setHoveredMonth(index)}
            onMouseLeave={() => setHoveredMonth(null)}
          >
            <div className="absolute inset-0 rounded-t-md bg-muted/20 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative z-10 flex h-full w-full max-w-[24px] items-end justify-center gap-0.5 sm:gap-1">
              <div style={{ height: `${(data.clicks / 50000) * 100}%` }} className="w-1 rounded-t-sm bg-blue-500 sm:w-1.5" />
              <div style={{ height: `${((data.leads * 10) / 50000) * 100}%` }} className="w-1 rounded-t-sm bg-purple-500 sm:w-1.5" />
              <div style={{ height: `${((data.sales * 100) / 50000) * 100}%` }} className="w-1 rounded-t-sm bg-emerald-500 sm:w-1.5" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex select-none justify-between px-1 font-mono text-[9px] text-muted-foreground sm:px-2 sm:text-[10px]">
        {MONTHLY_DATASET.map((data) => <span key={data.month} className="min-w-0 flex-1 text-center">{data.month}</span>)}
      </div>
    </section>
  );
}

export function BookSalesGoals({
  monthlyBudget = 0,
  annualRevenueGoal = 0,
  bookPrice = null,
  isBookPriceLoading = false,
  products = [],
}: BookSalesGoalsProps) {
  const [timeline, setTimeline] = useState<Timeline>("month");

  const summary = useMemo(() => {
    const config = TIMELINE_CONFIG[timeline];
    return {
      ...config,
      timelineBudget: monthlyBudget * config.multiplier,
      monthBooksToSell: bookPrice ? Math.ceil(monthlyBudget / bookPrice) : null,
      annualBooksToSell: bookPrice ? Math.ceil(annualRevenueGoal / bookPrice) : null,
    };
  }, [annualRevenueGoal, bookPrice, monthlyBudget, timeline]);

  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
      <div className="flex flex-col justify-between gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <h3 className="text-base font-bold tracking-tight">Book Sales Goals</h3>
          <p className="text-[11px] text-muted-foreground">Track product goals and the sales needed to cover marketing.</p>
        </div>
        <div className="grid grid-cols-3 rounded-lg border border-border bg-muted/50 p-1 text-[10px] font-bold">
          {(Object.keys(TIMELINE_CONFIG) as Timeline[]).map((item) => {
            const isActive = timeline === item;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={isActive}
                onClick={() => setTimeline(item)}
                className={isActive
                  ? "rounded-md bg-background px-2.5 py-1.5 text-foreground shadow-sm ring-1 ring-[#f97316]/60"
                  : "rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"}
              >
                {TIMELINE_CONFIG[item].label}
              </button>
            );
          })}
        </div>
      </div>

      {products.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {products.map((product) => {
            const productName = product.name?.trim() || product.id;
            const targetUnits = product.targetUnits;
            const unitPrice = product.unitPrice;
            const hasTarget = isFiniteNumber(targetUnits);
            const hasPrice = isFiniteNumber(unitPrice);

            return (
              <article key={product.id} className="flex min-h-[132px] flex-col rounded-lg border border-border bg-muted/25 p-4">
              <div>
                <div>
                  <h4 className="text-sm font-bold leading-snug text-foreground">{productName}</h4>
                  <p className="mt-1 text-[10px] font-medium text-muted-foreground">
                    {hasTarget && hasPrice
                      ? `Goal ${targetUnits.toLocaleString()} units @ ${unitPrice.toLocaleString()}`
                      : hasPrice
                        ? `Retail price ${formatCurrency(unitPrice)}`
                        : "Sales target not set"}
                  </p>
                </div>
                {product.status?.trim() && (
                  <span className="mt-2 inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-blue-500">
                    {product.status}
                  </span>
                )}
              </div>
              <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border/70 pt-3">
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Current Sales</p>
                  <p className="mt-1 font-mono text-sm font-bold text-emerald-500">{formatCurrency(product.currentSales)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Sales Goal</p>
                  <p className="mt-1 font-mono text-sm font-black text-foreground">{formatCurrency(product.salesGoal)}</p>
                </div>
              </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-foreground">No catalog products are available yet.</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Published author products will appear here automatically.</p>
        </div>
      )}

      <div className="grid grid-cols-1 divide-y divide-border rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Month Books to Sell</p>
          <p className="mt-1 font-mono text-sm font-black text-foreground">
            {isBookPriceLoading ? "Loading…" : summary.monthBooksToSell === null ? "—" : `${summary.monthBooksToSell.toLocaleString()} books`}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Annual Books to Sell</p>
          <p className="mt-1 font-mono text-sm font-black text-foreground">
            {isBookPriceLoading ? "Loading…" : summary.annualBooksToSell === null ? "—" : `${summary.annualBooksToSell.toLocaleString()} books`}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Break-even point</p>
          <p className="mt-1 font-mono text-sm font-black text-emerald-500">${summary.timelineBudget.toLocaleString()}{summary.costLabel}</p>
        </div>
      </div>
    </section>
  );
}

export default function UsageChartSection(props: BookSalesGoalsProps) {
  return (
    <div className="min-w-0 space-y-6">
      <ReaderJourney />
      <BookSalesGoals {...props} />
    </div>
  );
}
