"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Headphones, Layers3, Loader2 } from "lucide-react";

type PluginPlanId = "ereader" | "audiobook_player" | "bundle";

type PublicPlan = {
  id: PluginPlanId;
  label: string;
  unitAmount: number;
  currency: string;
  recurringInterval: string | null;
};

const PLAN_COPY: Record<PluginPlanId, {
  description: string;
  features: string[];
  icon: typeof BookOpen;
  featured?: boolean;
}> = {
  ereader: {
    description: "Deliver beautifully paginated digital books from your own WordPress site.",
    features: ["Responsive e-reader", "Reader progress tools", "Protected content delivery"],
    icon: BookOpen,
  },
  audiobook_player: {
    description: "Give listeners an immersive, branded audiobook experience on your website.",
    features: ["Bloom audiobook player", "Chapter navigation", "Secure listener access"],
    icon: Headphones,
  },
  bundle: {
    description: "Publish audiobooks and digital books together under one author workspace.",
    features: ["Audiobook Player", "E-Reader", "One StudioKey and dashboard"],
    icon: Layers3,
    featured: true,
  },
};

function formatPrice(plan: PublicPlan): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: plan.currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(plan.unitAmount / 100);
  return plan.recurringInterval ? `${amount} / ${plan.recurringInterval}` : amount;
}

export default function SignupStorefront() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PluginPlanId>("bundle");
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutState, setCheckoutState] = useState<"success" | "cancelled" | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const state = query.get("checkout");
    if (state === "success" || state === "cancelled") setCheckoutState(state);

    let cancelled = false;
    fetch("/api/checkout/plugin", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as
          | { success?: boolean; plans?: PublicPlan[]; error?: string }
          | null;
        if (!response.ok || payload?.success !== true || !Array.isArray(payload.plans)) {
          throw new Error(payload?.error || "Pricing could not be loaded.");
        }
        if (!cancelled) setPlans(payload.plans);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Pricing could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedPlanDetails = useMemo(
    () => plans.find((plan) => plan.id === selectedPlan) || null,
    [plans, selectedPlan],
  );

  async function startCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/checkout/plugin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName, authorEmail, plan: selectedPlan }),
      });
      const payload = await response.json().catch(() => null) as
        | { success?: boolean; checkoutUrl?: string; error?: string }
        | null;
      if (!response.ok || payload?.success !== true || !payload.checkoutUrl) {
        throw new Error(payload?.error || "Secure checkout could not be started.");
      }
      window.location.assign(payload.checkoutUrl);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Secure checkout could not be started.");
      setLoading(false);
    }
  }

  if (checkoutState === "success") {
    return (
      <main className="min-h-screen bg-[#1f2d53] px-5 py-12 text-white">
        <section className="mx-auto max-w-xl rounded-2xl border border-emerald-400/40 bg-[#2d4179] p-8 text-center shadow-2xl">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400 text-[#10213f]">
            <Check className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold">Your purchase is complete</h1>
          <p className="mt-3 text-sm leading-6 text-slate-200">
            We are creating your StudioKey and sending your KOBA-I plugin package to the email used at checkout.
          </p>
          <p className="mt-5 rounded-lg bg-black/20 p-4 text-sm text-slate-100">
            Check your inbox before creating your dashboard password. Your email contains the StudioKey required for signup.
          </p>
          <Link className="mt-6 inline-flex rounded-lg bg-[#f97316] px-5 py-3 text-sm font-bold text-black" href="/signin">
            Continue to author sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#1f2d53] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#fbbf24]">KOBA-I Audio</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Bring your books directly to your readers</h1>
          <p className="mt-4 text-sm leading-6 text-slate-200 sm:text-base">
            Choose your publishing tools, complete secure checkout, and receive your WordPress plugin and private StudioKey by email.
          </p>
        </header>

        {checkoutState === "cancelled" && (
          <div className="mx-auto mt-7 max-w-2xl rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-center text-sm text-amber-100">
            Checkout was cancelled. Your information has not been submitted, and you can continue whenever you are ready.
          </div>
        )}

        <form onSubmit={startCheckout} className="mt-9 space-y-8">
          <div className="grid gap-5 md:grid-cols-3">
            {pricingLoading && [0, 1, 2].map((index) => (
              <div key={index} className="h-72 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
            ))}
            {!pricingLoading && plans.map((plan) => {
              const copy = PLAN_COPY[plan.id];
              const Icon = copy.icon;
              const active = selectedPlan === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`relative rounded-2xl border p-6 text-left shadow-xl transition focus:outline-none focus:ring-2 focus:ring-[#f97316] ${
                    active
                      ? "border-[#f97316] bg-[#344a86] ring-2 ring-[#f97316]/30"
                      : "border-white/15 bg-[#2d4179] hover:border-white/35"
                  }`}
                >
                  {copy.featured && (
                    <span className="absolute right-4 top-4 rounded-full bg-[#f97316] px-3 py-1 text-[11px] font-bold text-black">Best value</span>
                  )}
                  <Icon className="h-7 w-7 text-[#fbbf24]" />
                  <h2 className="mt-5 text-xl font-bold">{plan.label}</h2>
                  <p className="mt-2 text-2xl font-bold text-[#fbbf24]">{formatPrice(plan)}</p>
                  <p className="mt-3 min-h-12 text-sm leading-5 text-slate-200">{copy.description}</p>
                  <ul className="mt-5 space-y-2 text-sm text-slate-100">
                    {copy.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" />{feature}</li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          <section className="mx-auto max-w-2xl rounded-2xl border border-white/15 bg-[#2d4179] p-6 shadow-2xl sm:p-8">
            <h2 className="text-xl font-bold">Who should receive the author workspace?</h2>
            <p className="mt-2 text-sm text-slate-300">Use the same email you will use to create your KOBA-I dashboard account.</p>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-semibold">
                <span>Author name</span>
                <input
                  value={authorName}
                  onChange={(event) => setAuthorName(event.target.value)}
                  autoComplete="name"
                  required
                  className="w-full rounded-lg border border-[#6f84b5] bg-[#172443] px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/30"
                  placeholder="Sharon Meeks"
                />
              </label>
              <label className="space-y-2 text-sm font-semibold">
                <span>Email address</span>
                <input
                  type="email"
                  value={authorEmail}
                  onChange={(event) => setAuthorEmail(event.target.value)}
                  autoComplete="email"
                  required
                  className="w-full rounded-lg border border-[#6f84b5] bg-[#172443] px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/30"
                  placeholder="author@example.com"
                />
              </label>
            </div>
            {error && <p role="alert" className="mt-5 rounded-lg border border-red-400/50 bg-red-950/40 p-3 text-sm text-red-100">{error}</p>}
            <button
              type="submit"
              disabled={loading || pricingLoading || !selectedPlanDetails}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#f97316] px-5 py-3.5 text-sm font-bold text-black shadow-lg transition hover:bg-[#e06613] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Opening secure checkout..." : `Continue to secure checkout${selectedPlanDetails ? ` — ${formatPrice(selectedPlanDetails)}` : ""}`}
            </button>
            <p className="mt-4 text-center text-xs leading-5 text-slate-400">
              Payment is processed securely by Stripe. Your StudioKey is issued only after Stripe confirms payment.
            </p>
          </section>
        </form>

        <p className="mt-8 text-center text-sm text-slate-300">
          Already purchased? <Link href="/signin" className="font-bold text-[#fbbf24] hover:text-white">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
