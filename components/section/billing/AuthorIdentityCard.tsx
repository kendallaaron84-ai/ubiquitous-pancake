"use client"

import { FormEvent, useEffect, useState } from "react"
import { CheckCircle2, Loader2, PenLine, ShieldCheck, UserRound } from "lucide-react"

interface Identity {
  id: string
  displayName: string
  type: "primary" | "pen_name"
}

export function AuthorIdentityCard() {
  const [identities, setIdentities] = useState<Identity[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [penName, setPenName] = useState("")
  const [rightsAttested, setRightsAttested] = useState(false)
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/author-identities", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) throw new Error(payload?.error || "Your author names could not be loaded.")
        setIdentities(Array.isArray(payload.identities) ? payload.identities : [])
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage({ type: "error", text: error instanceof Error ? error.message : "Your author names could not be loaded." })
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [])

  async function savePenName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return
    setIsSaving(true)
    setMessage(null)
    try {
      const response = await fetch("/api/author-identities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ displayName: penName, rightsAttested }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "Your pen name could not be registered.")
      setIdentities((current) => [...current.filter((identity) => identity.id !== payload.identity.id), payload.identity])
      setPenName("")
      setRightsAttested(false)
      setMessage({ type: "success", text: "Your pen name is registered and ready for new products." })
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Your pen name could not be registered." })
    } finally {
      setIsSaving(false)
    }
  }

  const penNameIdentity = identities.find((identity) => identity.type === "pen_name")

  return (
    <section className="mb-7 rounded-2xl border border-white/10 bg-[#222b45] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.3)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[#f6b63c]">
            <UserRound className="h-5 w-5" aria-hidden="true" />
            <h2 className="text-lg font-bold">Author &amp; pen names</h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Your individual author license supports your primary author name and one pen name. Every new book is permanently linked to one of these names.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-slate-950/30 px-3 py-1.5 text-xs font-bold text-slate-300">
          {identities.length} of 2 names used
        </span>
      </div>

      {message ? (
        <div role={message.type === "error" ? "alert" : "status"} className={`mt-5 rounded-lg border px-4 py-3 text-sm ${message.type === "error" ? "border-red-400/30 bg-red-500/10 text-red-100" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"}`}>
          {message.text}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-5 flex items-center text-sm text-slate-300"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading your author names…</div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {identities.map((identity) => (
            <div key={identity.id} className="rounded-xl border border-white/10 bg-[#131826] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{identity.type === "primary" ? "Primary author" : "Pen name"}</p>
                  <p className="mt-1 font-bold text-white">{identity.displayName}</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-label="Active" />
              </div>
            </div>
          ))}

          {!penNameIdentity ? (
            <form onSubmit={savePenName} className="rounded-xl border border-dashed border-[#f6b63c]/40 bg-[#131826] p-4">
              <label className="grid gap-2 text-xs font-bold text-slate-200">
                Optional pen name
                <input value={penName} onChange={(event) => setPenName(event.target.value)} required minLength={2} maxLength={120} placeholder="Your published pen name" className="rounded-lg border border-[#7084b5] bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#f97316]" />
              </label>
              <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-300">
                <input type="checkbox" checked={rightsAttested} onChange={(event) => setRightsAttested(event.target.checked)} className="mt-1" />
                I confirm that I own or control the publishing rights for this pen name and its content.
              </label>
              <button type="submit" disabled={isSaving || !rightsAttested || !penName.trim()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#f97316] px-4 py-2.5 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                Register pen name
              </button>
            </form>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-[#f6b63c]/20 bg-[#f6b63c]/5 p-4 text-xs leading-5 text-slate-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#f6b63c]" />
              Both author-name slots are assigned. Contact KOBA-I if your publishing needs have changed.
            </div>
          )}
        </div>
      )}
    </section>
  )
}
