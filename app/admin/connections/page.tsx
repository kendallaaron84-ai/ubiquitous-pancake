"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Link2, Loader2, ShieldCheck } from "lucide-react";

import Layout from "@/components/layout";

type FormState = {
  studioKey: string;
  targetWpOrigin: string;
  wpUsername: string;
  wpAppPassword: string;
};

const EMPTY_FORM: FormState = {
  studioKey: "",
  targetWpOrigin: "",
  wpUsername: "",
  wpAppPassword: "",
};

export default function AdminConnectionsPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [verifiedOrigin, setVerifiedOrigin] = useState("");

  async function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError("");
    setVerifiedOrigin("");

    try {
      const response = await fetch("/api/admin/connections/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(form),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; connection?: { targetWpOrigin?: string } }
        | null;

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "The WordPress connection could not be registered.");
      }

      setVerifiedOrigin(payload.connection?.targetWpOrigin || form.targetWpOrigin);
      setForm((current) => ({ ...current, wpAppPassword: "" }));
    } catch (submissionError: unknown) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "The WordPress connection could not be registered."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Layout>
      <main className="min-h-full bg-[#1a2238] px-4 py-8 text-white sm:px-6 lg:px-10">
        <section className="mx-auto w-full max-w-2xl">
          <header className="mb-7">
            <div className="mb-3 flex items-center gap-2 text-[#f6b63c]">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-[0.16em]">Owner control plane</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Connect an author&apos;s WordPress site</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              Verify the site, protect its credentials, and bind it to one StudioKey.
            </p>
          </header>

          <form
            onSubmit={submitConnection}
            className="rounded-2xl border border-white/10 bg-[#222b45] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.35)] sm:p-7"
          >
            <div className="grid gap-5">
              <ConnectionField
                id="studioKey"
                label="StudioKey"
                value={form.studioKey}
                placeholder="Author's assigned StudioKey"
                onChange={(value) => setForm((current) => ({ ...current, studioKey: value }))}
              />
              <ConnectionField
                id="targetWpOrigin"
                label="WordPress site"
                type="url"
                value={form.targetWpOrigin}
                placeholder="https://author-site.com"
                onChange={(value) => setForm((current) => ({ ...current, targetWpOrigin: value }))}
              />
              <ConnectionField
                id="wpUsername"
                label="WordPress username"
                value={form.wpUsername}
                autoComplete="username"
                placeholder="WordPress account username"
                onChange={(value) => setForm((current) => ({ ...current, wpUsername: value }))}
              />
              <ConnectionField
                id="wpAppPassword"
                label="WordPress Application Password"
                type="password"
                value={form.wpAppPassword}
                autoComplete="new-password"
                placeholder="Paste the Application Password"
                onChange={(value) => setForm((current) => ({ ...current, wpAppPassword: value }))}
              />
            </div>

            <p className="mt-5 text-xs leading-5 text-slate-400">
              The password is tested once, stored in Google Secret Manager, and never returned to this screen.
            </p>

            {error ? (
              <div role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            {verifiedOrigin ? (
              <div role="status" className="mt-5 flex items-start gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span><strong>Connection verified.</strong> {verifiedOrigin} is active for this StudioKey.</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#f97316] px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-[#e06613] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6b63c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#222b45] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
              {isSubmitting ? "Verifying connection…" : "Verify and save connection"}
            </button>
          </form>
        </section>
      </main>
    </Layout>
  );
}

function ConnectionField({
  id,
  label,
  value,
  placeholder,
  onChange,
  type = "text",
  autoComplete,
}: {
  id: keyof FormState;
  label: string;
  value: string;
  placeholder: string;
  onChange(value: string): void;
  type?: "text" | "url" | "password";
  autoComplete?: string;
}) {
  return (
    <label htmlFor={id} className="grid gap-2 text-sm font-semibold text-slate-100">
      {label}
      <input
        id={id}
        name={id}
        type={type}
        required
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-600 bg-[#131826] px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/30"
      />
    </label>
  );
}
