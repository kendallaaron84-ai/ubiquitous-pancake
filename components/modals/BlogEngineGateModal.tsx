"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { Bot, Clock3, Palette, Sparkles, Target } from "lucide-react"

interface BlogEngineGateModalProps {
  isSubscribed: boolean
  isLoading?: boolean
  children: ReactNode
}

const BENEFITS = [
  {
    icon: Clock3,
    title: "More time to write",
    description: "Build promotional articles and SEO campaigns without losing your writing time.",
  },
  {
    icon: Palette,
    title: "Content shaped around your books",
    description: "Create articles, social copy, and artwork grounded in your story world and author voice.",
  },
  {
    icon: Sparkles,
    title: "WordPress draft delivery",
    description: "Send completed campaigns to your private WordPress drafts for review before publishing.",
  },
  {
    icon: Target,
    title: "A clear path back to your books",
    description: "Guide interested readers toward your audiobook player and e-reader storefront.",
  },
]

export function BlogEngineGateModal({
  isSubscribed,
  isLoading = false,
  children,
}: BlogEngineGateModalProps) {
  if (isLoading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center text-sm text-slate-300">
        Checking your Blog Engine access…
      </div>
    )
  }

  if (isSubscribed) return <>{children}</>

  return (
    <section className="relative min-h-[650px] overflow-hidden rounded-2xl border border-white/10 bg-[#18223b]">
      <div
        aria-hidden="true"
        className="pointer-events-none select-none opacity-45 blur-[3px] saturate-75"
      >
        {children}
      </div>

      <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#081121]/55 p-4 backdrop-blur-[2px] sm:p-8">
        <div className="w-full max-w-2xl rounded-2xl border border-[#f6b63c]/45 bg-[#18223b]/82 p-6 text-center shadow-[0_24px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/10 backdrop-blur-2xl sm:p-8">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#f6b63c]/30 bg-[#f6b63c]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#f6b63c]">
            <Bot className="h-4 w-4" aria-hidden="true" />
            Automated author growth
          </div>

          <h1 className="mt-5 text-2xl font-bold leading-tight text-white sm:text-3xl">
            Imagine never worrying about book marketing alone again.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300">
            Meet your always-available digital marketing studio—built to turn your books,
            ideas, and author voice into discoverable campaigns that lead readers back to you.
          </p>

          <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
            {BENEFITS.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-xl border border-white/10 bg-[#111a2e] p-4">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#f6b63c]" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-bold text-white">{title}</h2>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Link
            href="/visibility-cure"
            className="mt-7 flex w-full items-center justify-center rounded-xl bg-[#f97316] px-6 py-3.5 text-sm font-bold text-black shadow-lg transition hover:bg-[#ff8a35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6b63c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a2238] sm:text-base"
          >
            Explore the Visibility Cure
          </Link>
          <p className="mt-3 text-xs text-slate-400">
            Compare plans and choose what fits your author business.
          </p>
        </div>
      </div>
    </section>
  )
}
