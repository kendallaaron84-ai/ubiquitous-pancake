"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Check, Loader2, Sparkles } from "lucide-react"

import Layout from "@/components/layout"

type SubscriptionPlan = "starter" | "pro"

const PLANS: Array<{
  id: SubscriptionPlan
  name: string
  price: string
  description: string
  features: string[]
  featured?: boolean
}> = [
  {
    id: "starter",
    name: "Traffic Generator & Asset Vault",
    price: "$30 / month",
    description: "A steady content system for authors ready to become easier to discover.",
    features: [
      "Long-form blog draft generation",
      "SEO-focused campaign planning",
      "Custom featured artwork",
      "Private WordPress draft delivery",
    ],
    featured: true,
  },
  {
    id: "pro",
    name: "Cinematic Multi-Channel Engine",
    price: "$60 / month",
    description: "Expanded campaign power for authors building across multiple audience channels.",
    features: [
      "Everything in Starter",
      "Expanded multi-channel campaign tools",
      "Advanced visual storytelling workflows",
      "Priority growth automation features",
    ],
  },
]

export default function VisibilityCurePage() {
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlan | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get("checkout")
    if (state === "cancelled") {
      setMessage("Checkout was cancelled. Nothing was charged, and you can return whenever you are ready.")
    } else if (state === "success") {
      setMessage("Payment received. Your Blog Engine access is being activated now.")
    }
  }, [])

  async function beginCheckout(plan: SubscriptionPlan) {
    if (checkoutPlan) return
    setCheckoutPlan(plan)
    setMessage("")

    try {
      const response = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ plan }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { checkoutUrl?: string; error?: string }
        | null
      if (!response.ok || !payload?.checkoutUrl) {
        throw new Error(payload?.error || "Secure checkout could not be opened.")
      }
      window.location.assign(payload.checkoutUrl)
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Secure checkout could not be opened. Please try again."
      )
      setCheckoutPlan(null)
    }
  }

  return (
    <Layout>
      <main className="min-h-full bg-[#1a2238] px-4 py-8 text-white sm:px-6 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <header className="mx-auto max-w-3xl text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#f6b63c]/30 bg-[#f6b63c]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[#f6b63c]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              The Independent Author&apos;s Visibility Cure
            </div>
            <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
              Let your marketing keep working while you write.
            </h1>
            <p className="mt-4 text-sm leading-6 text-slate-300 sm:text-base">
              Create useful articles, search-ready campaigns, social copy, and original artwork
              grounded in your books—then review everything safely in WordPress before it goes live.
            </p>
          </header>

          {message ? (
            <p role="status" className="mx-auto mt-7 max-w-2xl rounded-xl border border-[#f6b63c]/30 bg-[#f6b63c]/10 p-4 text-center text-sm text-slate-100">
              {message}
            </p>
          ) : null}

          <div className="mt-9 grid gap-6 md:grid-cols-2">
            {PLANS.map((plan) => (
              <section
                key={plan.id}
                className={`flex min-h-[420px] flex-col rounded-2xl border p-6 shadow-[0_18px_50px_rgba(0,0,0,0.38)] sm:p-8 ${
                  plan.featured
                    ? "border-[#f97316] bg-[#2d4179]"
                    : "border-[#8b4528] bg-[#222b45]"
                }`}
              >
                {plan.featured ? (
                  <span className="w-fit rounded-full bg-[#f97316] px-3 py-1 text-xs font-bold text-black">
                    Best place to start
                  </span>
                ) : null}
                <h2 className="mt-5 text-xl font-bold">{plan.name}</h2>
                <p className="mt-2 text-3xl font-bold text-[#f6b63c]">{plan.price}</p>
                <p className="mt-4 text-sm leading-6 text-slate-300">{plan.description}</p>
                <ul className="mt-6 space-y-3 text-sm text-slate-100">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={checkoutPlan !== null}
                  onClick={() => beginCheckout(plan.id)}
                  className={`mt-auto flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-lg transition disabled:cursor-wait disabled:opacity-60 ${
                    plan.featured
                      ? "bg-[#f97316] text-black hover:bg-[#ff8a35]"
                      : "bg-[#8b4528] hover:bg-[#733026]"
                  }`}
                >
                  {checkoutPlan === plan.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {checkoutPlan === plan.id ? "Opening secure checkout…" : `Choose ${plan.id === "starter" ? "Starter" : "Pro"}`}
                </button>
              </section>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link href="/nexus-engine" className="text-sm font-semibold text-[#f6b63c] hover:text-white">
              Return to the Blog Engine
            </Link>
          </div>
        </div>
      </main>
    </Layout>
  )
}
