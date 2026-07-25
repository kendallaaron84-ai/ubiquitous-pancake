"use client";

import React from "react";
import { Calculator, Info } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BookSalesGoalProduct } from "./UsageChartSection";
import type { MarketingBudgetValues, PlanTier } from "./useMarketingBudgetPlanner";

interface MarketingBudgetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanTier;
  isPlanLoading: boolean;
  subscriptionCost: number;
  products: readonly BookSalesGoalProduct[];
  isBookPriceLoading: boolean;
  budget: MarketingBudgetValues;
  onBudgetChange: (budget: MarketingBudgetValues) => void;
}

function normalizeBudget(value: string): number {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function MarketingBudgetModal({
  open,
  onOpenChange,
  plan,
  isPlanLoading,
  subscriptionCost,
  products,
  isBookPriceLoading,
  budget,
  onBudgetChange,
}: MarketingBudgetModalProps) {
  const updateBudget = (field: keyof MarketingBudgetValues, value: string) => {
    onBudgetChange({ ...budget, [field]: normalizeBudget(value) });
  };

  const activeBooks = products.filter((product) => (Number(product.unitPrice) || 0) > 0);
  const blendedPrice = activeBooks.length > 0
    ? activeBooks.reduce((sum, product) => sum + (Number(product.unitPrice) || 0), 0) / activeBooks.length
    : 0;
  const monthlyMarketingCost = subscriptionCost + budget.paidTrafficBudget + budget.printAndEventsBudget;
  const monthlyBreakEvenUnits = blendedPrice > 0 ? Math.ceil(monthlyMarketingCost / blendedPrice) : null;
  const annualRevenueUnits = blendedPrice > 0 ? Math.ceil(budget.annualRevenueGoal / blendedPrice) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-border bg-card p-0 text-card-foreground shadow-2xl sm:max-w-2xl">
        <DialogHeader className="border-b border-border bg-muted/30 px-5 py-5 pr-12 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-xl font-black tracking-tight">
            <Calculator className="h-5 w-5 text-primary" /> Marketing Budget
          </DialogTitle>
          <DialogDescription>
            Review your monthly marketing costs and annual book revenue target.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 pb-2 sm:px-6">
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-foreground">Monthly marketing costs</h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">KOBA-I Software Subscription</p>
              <p className="mt-2 font-mono text-base font-bold text-foreground">
                  {isPlanLoading ? "Loading…" : `$${subscriptionCost}/mo`}
                </p>
                <p className="mt-1 text-[10px] capitalize text-muted-foreground">{isPlanLoading ? "Checking account" : `${plan} plan`}</p>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="cursor-help rounded-lg border border-border bg-muted/30 p-3 text-left outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Active Book Price <Info className="h-3.5 w-3.5" aria-hidden="true" />
                    </p>
                    <p className="mt-2 font-mono text-base font-bold text-foreground">
                      {isBookPriceLoading ? "Loading…" : blendedPrice > 0 ? formatCurrency(blendedPrice) : "Unavailable"}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">Average retail price across priced catalog books.</p>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={8}
                  className="w-80 max-w-[calc(100vw-2rem)] border border-border bg-popover p-4 text-popover-foreground shadow-xl"
                >
                  <div className="space-y-3 text-xs font-semibold">
                    <p className="uppercase tracking-wide text-muted-foreground">Active Books Matrix</p>
                    {activeBooks.length > 0 ? (
                      <ul className="space-y-2">
                        {activeBooks.map((book) => (
                          <li key={book.id} className="flex items-start justify-between gap-4">
                            <span className="min-w-0 leading-snug">{book.name?.trim() || book.id}</span>
                            <span className="shrink-0 font-mono">{formatCurrency(Number(book.unitPrice))}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">No positively priced catalog books are available.</p>
                    )}
                    <div className="border-t border-border pt-3">
                      <p>Calculation Baseline: Average Blended Price Used</p>
                      {blendedPrice > 0 && (
                        <p className="mt-1 font-mono text-muted-foreground">
                          {formatCurrency(activeBooks.reduce((sum, book) => sum + (Number(book.unitPrice) || 0), 0))} ÷ {activeBooks.length} = {formatCurrency(blendedPrice)}
                        </p>
                      )}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-xs font-bold text-foreground">
                <span>Monthly Paid Traffic Budget</span>
                <span className="flex items-center rounded-lg border border-border bg-background px-3 py-2 shadow-inner focus-within:ring-2 focus-within:ring-ring">
                  <span className="mr-1 text-muted-foreground">$</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={budget.paidTrafficBudget}
                    onChange={(event) => updateBudget("paidTrafficBudget", event.target.value)}
                    className="w-full bg-transparent font-mono text-sm font-bold text-foreground outline-none"
                  />
                </span>
              </label>

              <label className="space-y-2 text-xs font-bold text-foreground">
                <span>Monthly Print &amp; Events Overhead</span>
                <span className="flex items-center rounded-lg border border-border bg-background px-3 py-2 shadow-inner focus-within:ring-2 focus-within:ring-ring">
                  <span className="mr-1 text-muted-foreground">$</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={budget.printAndEventsBudget}
                    onChange={(event) => updateBudget("printAndEventsBudget", event.target.value)}
                    className="w-full bg-transparent font-mono text-sm font-bold text-foreground outline-none"
                  />
                </span>
              </label>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/25 bg-primary/[0.06] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Cost of Marketing</p>
              <p className="shrink-0 font-mono text-lg font-bold text-foreground">${monthlyMarketingCost.toLocaleString()}/mo</p>
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <h3 className="text-sm font-bold text-foreground">Annual revenue runway</h3>

            <label className="block max-w-sm space-y-2 text-xs font-bold text-foreground">
              <span>Annual Revenue Goal</span>
              <span className="flex items-center rounded-lg border border-border bg-background px-3 py-2 shadow-inner focus-within:ring-2 focus-within:ring-ring">
                <span className="mr-1 text-muted-foreground">$</span>
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={budget.annualRevenueGoal}
                  onChange={(event) => updateBudget("annualRevenueGoal", event.target.value)}
                  className="w-full bg-transparent font-mono text-sm font-bold text-foreground outline-none"
                />
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/25 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Monthly Break-Even</p>
              <p className="mt-2 font-mono text-xl font-bold tracking-tight text-foreground">
                  {monthlyBreakEvenUnits === null ? "—" : `${monthlyBreakEvenUnits.toLocaleString()} books`}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/25 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Annual Revenue Goal</p>
              <p className="mt-2 font-mono text-xl font-bold tracking-tight text-foreground">
                  {annualRevenueUnits === null ? "—" : `${annualRevenueUnits.toLocaleString()} books`}
                </p>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="sticky bottom-0 z-10 border-t border-border bg-card px-5 py-3 sm:px-6">
          <DialogClose asChild>
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Close Window
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
