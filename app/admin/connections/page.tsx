"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, Loader2, ShieldCheck, UserPlus } from "lucide-react";

import Layout from "@/components/layout";

type FormState = {
  studioKey: string;
  targetWpOrigin: string;
  wpUsername: string;
  wpAppPassword: string;
  contentRole: "business_brand" | "story_world" | "both";
};

type ProvisionFormState = {
  authorName: string;
  authorEmail: string;
  hasAudiobookPlayer: boolean;
  hasEreader: boolean;
  deferWelcome: boolean;
};

const EMPTY_FORM: FormState = {
  studioKey: "",
  targetWpOrigin: "",
  wpUsername: "",
  wpAppPassword: "",
  contentRole: "both",
};

const EMPTY_PROVISION_FORM: ProvisionFormState = {
  authorName: "",
  authorEmail: "",
  hasAudiobookPlayer: true,
  hasEreader: false,
  deferWelcome: true,
};

export default function AdminConnectionsPage() {
  const router = useRouter();
  const [ownerCheckComplete, setOwnerCheckComplete] = useState(false);
  const [provisionForm, setProvisionForm] = useState<ProvisionFormState>(EMPTY_PROVISION_FORM);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState("");
  const [provisionedAuthor, setProvisionedAuthor] = useState<{
    studioKey: string;
    welcomeEmailSent: boolean;
    welcomeEmailStatus: "pending" | "deferred" | "sending" | "sent" | "failed";
    message: string;
  } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [verifiedOrigin, setVerifiedOrigin] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Owner session unavailable.");
        return response.json() as Promise<{ isOwner?: boolean }>;
      })
      .then((payload) => {
        if (payload.isOwner !== true) {
          router.replace("/products");
          return;
        }
        setOwnerCheckComplete(true);
      })
      .catch((sessionError: unknown) => {
        if (sessionError instanceof DOMException && sessionError.name === "AbortError") return;
        router.replace("/products");
      });

    return () => controller.abort();
  }, [router]);

  async function provisionAuthor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAuthorProvisioning(provisionForm.deferWelcome ? "defer" : "send");
  }

  async function submitAuthorProvisioning(welcomeDelivery: "send" | "defer") {
    if (isProvisioning) return;

    setIsProvisioning(true);
    setProvisionError("");
    setProvisionedAuthor(null);

    try {
      const response = await fetch("/api/admin/provision-author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          authorName: provisionForm.authorName,
          authorEmail: provisionForm.authorEmail,
          hasAudiobookPlayer: provisionForm.hasAudiobookPlayer,
          hasEreader: provisionForm.hasEreader,
          welcomeDelivery,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            error?: string;
            message?: string;
            studioKey?: string;
            welcomeEmailSent?: boolean;
            welcomeEmailStatus?: "pending" | "deferred" | "sending" | "sent" | "failed";
          }
        | null;

      if (!response.ok || !payload?.success || !payload.studioKey) {
        throw new Error(payload?.error || "The author workspace could not be provisioned.");
      }

      setProvisionedAuthor({
        studioKey: payload.studioKey,
        welcomeEmailSent: payload.welcomeEmailSent === true,
        welcomeEmailStatus: payload.welcomeEmailStatus || "pending",
        message: payload.message || "The author workspace is ready.",
      });
      setForm((current) => ({ ...current, studioKey: payload.studioKey || "" }));
    } catch (submissionError: unknown) {
      setProvisionError(
        submissionError instanceof Error
          ? submissionError.message
          : "The author workspace could not be provisioned."
      );
    } finally {
      setIsProvisioning(false);
    }
  }

  async function sendDeferredWelcome() {
    await submitAuthorProvisioning("send");
  }

  function continueToConnection() {
    document.getElementById("wordpress-connection")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    window.setTimeout(() => document.getElementById("studioKey")?.focus(), 350);
  }

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

  if (!ownerCheckComplete) {
    return (
      <Layout>
        <main className="flex min-h-full items-center justify-center bg-[#1E2B53] text-white">
          <Loader2 className="h-6 w-6 animate-spin text-[#EFB752]" aria-label="Confirming owner access" />
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <main className="min-h-full bg-[#1E2B53] px-4 py-8 text-white sm:px-6 lg:px-10">
        <section className="mx-auto w-full max-w-2xl">
          <header className="mb-7">
            <div className="mb-3 flex items-center gap-2 text-[#EFB752]">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-[0.16em]">Owner control plane</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Author Connections</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-200">
              Provision an author workspace, then securely connect its WordPress site.
            </p>
          </header>

          <section aria-labelledby="provision-author-heading" className="mb-8">
            <div className="mb-4">
              <h2 id="provision-author-heading" className="text-xl font-bold text-white">
                Provision an Author Workspace
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-200">
                Create or recover the author&apos;s StudioKey and send their welcome package.
              </p>
            </div>

            <form
              onSubmit={provisionAuthor}
              className="rounded-2xl border border-[#EFB752]/20 bg-[#293A71] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)] sm:p-7"
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <ProvisionField
                  id="authorName"
                  label="Author name"
                  value={provisionForm.authorName}
                  placeholder="Author's published name"
                  autoComplete="name"
                  onChange={(value) => setProvisionForm((current) => ({ ...current, authorName: value }))}
                />
                <ProvisionField
                  id="authorEmail"
                  label="Author email"
                  type="email"
                  value={provisionForm.authorEmail}
                  placeholder="author@example.com"
                  autoComplete="email"
                  onChange={(value) => setProvisionForm((current) => ({ ...current, authorEmail: value }))}
                />
              </div>

              <fieldset className="mt-5 rounded-xl border border-[#5b6d9e] bg-[#151d35]/70 p-4">
                <legend className="px-1 text-sm font-semibold text-white">Approved capabilities</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <ProvisionCheckbox
                    label="Audiobook player"
                    checked={provisionForm.hasAudiobookPlayer}
                    onChange={(checked) => setProvisionForm((current) => ({ ...current, hasAudiobookPlayer: checked }))}
                  />
                  <ProvisionCheckbox
                    label="E-reader"
                    checked={provisionForm.hasEreader}
                    onChange={(checked) => setProvisionForm((current) => ({ ...current, hasEreader: checked }))}
                  />
                </div>
              </fieldset>

              <label className="mt-5 flex items-start gap-3 rounded-xl border border-[#EFB752]/20 bg-[#151d35]/70 p-4 text-sm text-slate-100">
                <input
                  type="checkbox"
                  checked={provisionForm.deferWelcome}
                  onChange={(event) => setProvisionForm((current) => ({ ...current, deferWelcome: event.target.checked }))}
                  className="mt-0.5 h-4 w-4 accent-[#EFB752]"
                />
                <span>
                  <strong className="block text-white">Defer welcome package</strong>
                  Create or recover the workspace now. Send the author&apos;s welcome only after site setup is complete.
                </span>
              </label>

              {provisionError ? (
                <div role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {provisionError}
                </div>
              ) : null}

              {provisionedAuthor ? (
                <div role="status" className="mt-5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-50">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">{provisionedAuthor.message}</p>
                      <p className="mt-2 break-all font-mono text-xs text-white">{provisionedAuthor.studioKey}</p>
                      <p className="mt-2 text-xs text-emerald-50/80">
                        {provisionedAuthor.welcomeEmailSent
                          ? "The welcome package was sent to the author."
                          : provisionedAuthor.welcomeEmailStatus === "deferred"
                            ? "The workspace is ready. Welcome delivery is deferred."
                            : "The workspace is ready, but the welcome email was not confirmed."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={continueToConnection}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-400/20"
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Continue to WordPress connection
                  </button>
                  {provisionedAuthor.welcomeEmailStatus === "deferred" ? (
                    <button
                      type="button"
                      disabled={isProvisioning}
                      onClick={sendDeferredWelcome}
                      className="ml-2 mt-4 inline-flex items-center gap-2 rounded-lg border border-[#EFB752]/40 bg-[#EFB752]/10 px-3 py-2 text-xs font-bold text-[#FFE5A3] transition hover:bg-[#EFB752]/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isProvisioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                      Send welcome package now
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isProvisioning}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#733026] px-4 py-3 text-sm font-bold text-[#EFB752] shadow-md transition hover:bg-[#61271f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EFB752] focus-visible:ring-offset-2 focus-visible:ring-offset-[#293A71] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isProvisioning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
                {isProvisioning ? "Provisioning author…" : "Provision author workspace"}
              </button>
            </form>
          </section>

          <section id="wordpress-connection" aria-labelledby="wordpress-connection-heading" className="scroll-mt-6">
            <div className="mb-4">
              <h2 id="wordpress-connection-heading" className="text-xl font-bold text-white">
                Connect an Author&apos;s WordPress Site
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-200">
                Verify the site, protect its credentials, and bind it to one StudioKey.
              </p>
            </div>

            <form
              onSubmit={submitConnection}
              className="rounded-2xl border border-[#EFB752]/20 bg-[#293A71] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.28)] sm:p-7"
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
                <label htmlFor="contentRole" className="grid gap-2 text-sm font-semibold text-white">
                  Content role
                  <select
                    id="contentRole"
                    value={form.contentRole}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      contentRole: event.target.value as FormState["contentRole"],
                    }))}
                    className="w-full rounded-lg border border-[#5b6d9e] bg-[#151d35] px-3 py-3 text-sm text-white outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/30"
                  >
                    <option value="both">Business Brand and Story World</option>
                    <option value="business_brand">Business Brand</option>
                    <option value="story_world">Story World</option>
                  </select>
                </label>
              </div>

              <p className="mt-5 text-xs leading-5 text-slate-300">
                The password is tested once, stored in Google Secret Manager, and never returned to this screen.
              </p>

              {error ? (
                <div role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              ) : null}

              {verifiedOrigin ? (
                <div role="status" className="mt-5 flex items-start gap-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span><strong>Connection verified.</strong> {verifiedOrigin} is active for this StudioKey.</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#f97316] px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-[#e06613] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EFB752] focus-visible:ring-offset-2 focus-visible:ring-offset-[#293A71] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
                {isSubmitting ? "Verifying connection…" : "Verify and save connection"}
              </button>
            </form>
          </section>
        </section>
      </main>
    </Layout>
  );
}

function ProvisionField({
  id,
  label,
  value,
  placeholder,
  onChange,
  type = "text",
  autoComplete,
}: {
  id: "authorName" | "authorEmail";
  label: string;
  value: string;
  placeholder: string;
  onChange(value: string): void;
  type?: "text" | "email";
  autoComplete?: string;
}) {
  return (
    <label htmlFor={id} className="grid gap-2 text-sm font-semibold text-white">
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
        className="w-full rounded-lg border border-[#5b6d9e] bg-[#151d35] px-3 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-[#EFB752] focus:ring-2 focus:ring-[#EFB752]/30"
      />
    </label>
  );
}

function ProvisionCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-slate-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#EFB752]"
      />
      {label}
    </label>
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
    <label htmlFor={id} className="grid gap-2 text-sm font-semibold text-white">
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
        className="w-full rounded-lg border border-[#5b6d9e] bg-[#151d35] px-3 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/30"
      />
    </label>
  );
}
