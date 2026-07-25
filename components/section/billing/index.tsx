"use client";

import Link from "next/link";
import { FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  CheckCircle2,
  Building2,
  CreditCard,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { AuthorIdentityCard } from "./AuthorIdentityCard";

type ConnectionStatus = "connected" | "not_connected";
type PaymentModel = "author_direct" | "koba_managed";
type StripeConnectionStatus = "not_configured" | "pending" | "action_required" | "active";
type SetupSection = "wordpress" | "payments" | "author_names";

interface PaymentProfile {
  configured: boolean;
  paymentModel?: PaymentModel;
  stripeAccountType?: "standard" | "express";
  connectionStatus: StripeConnectionStatus;
}

interface ConnectionProfile {
  hasContentEngineAccess: boolean;
  connection: {
    status: ConnectionStatus;
    targetWpOrigin: string;
    wpUsername: string;
  };
}

interface StatusMessage {
  type: "success" | "error" | "neutral";
  text: string;
}

export default function Billing() {
  const [activeSection, setActiveSection] = useState<SetupSection>("wordpress");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasContentEngineAccess, setHasContentEngineAccess] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("not_connected");
  const [targetWpOrigin, setTargetWpOrigin] = useState("");
  const [wpUsername, setWpUsername] = useState("");
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [isEditingConnection, setIsEditingConnection] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [initialLoadIssue, setInitialLoadIssue] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [paymentProfile, setPaymentProfile] = useState<PaymentProfile>({
    configured: false,
    connectionStatus: "not_configured",
  });
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [paymentSubmitting, setPaymentSubmitting] = useState<PaymentModel | null>(null);
  const [stripeDashboardLoading, setStripeDashboardLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/connections/verify", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | (ConnectionProfile & { success?: boolean; error?: string })
          | null;
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || "Your connection settings could not be loaded.");
        }
        setHasContentEngineAccess(payload.hasContentEngineAccess);
        setConnectionStatus(payload.connection.status);
        setTargetWpOrigin(payload.connection.targetWpOrigin || "");
        setWpUsername(payload.connection.wpUsername || "");
        setIsEditingConnection(payload.connection.status !== "connected");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setInitialLoadIssue(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/stripe/connect/sync", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || "Reader payment status could not be loaded.");
        }
        setPaymentProfile({
          configured: Boolean(payload.configured),
          paymentModel: payload.paymentModel,
          stripeAccountType: payload.stripeAccountType,
          connectionStatus: payload.connectionStatus || "not_configured",
        });
        if (new URLSearchParams(window.location.search).get("stripe") === "return") {
          setStatusMessage({
            type: payload.connectionStatus === "active" ? "success" : "neutral",
            text: payload.connectionStatus === "active"
              ? "Reader payments are connected and ready."
              : "Stripe needs a little more information before reader payments can begin.",
          });
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setInitialLoadIssue(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPaymentLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  function retryInitialChecks() {
    setInitialLoadIssue(false);
    setIsLoading(true);
    setPaymentLoading(true);
    setReloadKey((current) => current + 1);
  }

  async function startPaymentSetup(requestedModel: PaymentModel) {
    if (paymentSubmitting) return;
    setPaymentSubmitting(requestedModel);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/stripe/connect/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ requestedModel }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success || !payload?.url) {
        throw new Error(payload?.error || "Stripe setup could not be started.");
      }
      window.location.assign(payload.url);
    } catch (error: unknown) {
      setStatusMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Stripe setup could not be started.",
      });
      setPaymentSubmitting(null);
    }
  }

  async function openStripeDashboard() {
    if (stripeDashboardLoading) return;
    setStripeDashboardLoading(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/stripe/connect/dashboard", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success || !payload?.url) {
        throw new Error(payload?.error || "Stripe account management could not be opened.");
      }
      window.location.assign(payload.url);
    } catch (error: unknown) {
      setStatusMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Stripe account management could not be opened.",
      });
      setStripeDashboardLoading(false);
    }
  }

  async function testConnection() {
    if (isTestingConnection) return;
    setIsTestingConnection(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/connections/verify?test=1", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Your WordPress connection could not be verified.");
      }
      setStatusMessage({
        type: "success",
        text: payload.message || "Your WordPress connection is working.",
      });
    } catch (error: unknown) {
      setStatusMessage({
        type: "neutral",
        text:
          error instanceof Error
            ? error.message
            : "Your WordPress connection could not be verified.",
      });
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function verifyAndSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/connections/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ targetWpOrigin, wpUsername, wpAppPassword }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            error?: string;
            message?: string;
            connection?: {
              status?: ConnectionStatus;
              targetWpOrigin?: string;
              wpUsername?: string;
            };
          }
        | null;
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Your WordPress site could not be connected.");
      }

      setConnectionStatus("connected");
      setTargetWpOrigin(payload.connection?.targetWpOrigin || targetWpOrigin);
      setWpUsername(payload.connection?.wpUsername || wpUsername);
      setWpAppPassword("");
      setIsEditingConnection(false);
      setStatusMessage({
        type: "success",
        text:
          payload.message ||
          "Your WordPress site is connected and ready for blog drafts.",
      });
    } catch (error: unknown) {
      setWpAppPassword("");
      setStatusMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Your WordPress site could not be connected.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-slate-300">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Loading your website connection…
      </div>
    );
  }

  return (
    <main className="min-h-full bg-[#1a2238] px-4 py-8 text-white sm:px-6 lg:px-10">
      <section className="mx-auto w-full max-w-4xl">
        <header className="mb-7">
          <div className="mb-3 flex items-center gap-2 text-[#f6b63c]">
            <Link2 className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-[0.16em]">
              Website connection
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Connect your WordPress site
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Once connected, KOBA-I can place completed blog drafts and featured artwork
            directly in your private WordPress drafts. Nothing is published without your review.
          </p>
        </header>

        {statusMessage ? <MessageBanner message={statusMessage} /> : null}
        {initialLoadIssue ? (
          <NeutralLoadBanner onRetry={retryInitialChecks} />
        ) : null}

        <SetupNavigation
          activeSection={activeSection}
          connectionStatus={connectionStatus}
          paymentStatus={paymentProfile.connectionStatus}
          paymentLoading={paymentLoading}
          onChange={setActiveSection}
        />

        {activeSection === "wordpress" ? (
          <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            {connectionStatus === "connected" && !isEditingConnection ? (
              <ConnectedWordPressSummary
                targetWpOrigin={targetWpOrigin}
                wpUsername={wpUsername}
                testing={isTestingConnection}
                onTest={testConnection}
                onChange={() => {
                  setStatusMessage(null);
                  setWpAppPassword("");
                  setIsEditingConnection(true);
                }}
              />
            ) : (
            <form
              onSubmit={verifyAndSave}
              className="rounded-2xl border border-white/10 bg-[#222b45] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.35)] sm:p-7"
            >
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
                <div>
                  <h2 className="text-lg font-bold">Your publishing site</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Your StudioKey is selected automatically from your account.
                  </p>
                </div>
                <ConnectionBadge status={connectionStatus} />
              </div>

              <div className="grid gap-5">
                <ConnectionField
                  id="targetWpOrigin"
                  label="WordPress website address"
                  type="url"
                  value={targetWpOrigin}
                  placeholder="https://your-author-site.com"
                  onChange={setTargetWpOrigin}
                />
                <ConnectionField
                  id="wpUsername"
                  label="WordPress username"
                  value={wpUsername}
                  placeholder="The username you use in WordPress"
                  onChange={setWpUsername}
                />
                <ConnectionField
                  id="wpAppPassword"
                  label="WordPress Application Password"
                  type="password"
                  value={wpAppPassword}
                  placeholder={
                    connectionStatus === "connected"
                      ? "A new password is required to change this connection"
                      : "Paste the password generated by WordPress"
                  }
                  onChange={setWpAppPassword}
                />
              </div>

              <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-xs leading-5 text-emerald-100">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  Your Application Password is verified once and stored in Google Secret
                  Manager. It is never saved in your browser or displayed again.
                </p>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !wpAppPassword.trim()}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#f97316] px-4 py-3 text-sm font-bold text-black shadow-md transition hover:bg-[#ff8a35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6b63c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#222b45] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                )}
                {isSubmitting
                  ? "Checking your WordPress site…"
                  : connectionStatus === "connected"
                    ? "Verify and update connection"
                    : "Verify and connect my site"}
              </button>
              {connectionStatus === "connected" ? (
                <button
                  type="button"
                  onClick={() => {
                    setWpAppPassword("");
                    setIsEditingConnection(false);
                  }}
                  className="mt-3 w-full rounded-lg px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
                >
                  Cancel
                </button>
              ) : null}
            </form>
            )}

            {connectionStatus === "connected" && !isEditingConnection ? (
              <ConnectedSiteHelp />
            ) : (
              <GettingReadyCard targetWpOrigin={targetWpOrigin} />
            )}
          </div>

          {!hasContentEngineAccess ? (
            <LockedAccessCard connectionStatus={connectionStatus} />
          ) : null}
          </>
        ) : null}

        {activeSection === "payments" ? (
          <PaymentSetupCard
            profile={paymentProfile}
            loading={paymentLoading}
            submitting={paymentSubmitting}
            dashboardLoading={stripeDashboardLoading}
            onStart={startPaymentSetup}
            onOpenDashboard={openStripeDashboard}
          />
        ) : null}

        {activeSection === "author_names" ? <AuthorIdentityCard /> : null}
      </section>
    </main>
  );
}

function NeutralLoadBanner({ onRetry }: { onRetry(): void }) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-500/30 bg-slate-900/30 px-4 py-3 text-sm text-slate-200"
    >
      <span>We couldn’t check your saved setup.</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-slate-500/40 px-3 py-1.5 text-xs font-bold text-white transition hover:border-[#f6b63c]/60 hover:text-[#f6b63c]"
      >
        Retry
      </button>
    </div>
  );
}

function ConnectedWordPressSummary({
  targetWpOrigin,
  wpUsername,
  testing,
  onTest,
  onChange,
}: {
  targetWpOrigin: string;
  wpUsername: string;
  testing: boolean;
  onTest(): void;
  onChange(): void;
}) {
  return (
    <section className="rounded-2xl border border-emerald-400/20 bg-[#222b45] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.35)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
        <div>
          <h2 className="text-lg font-bold">Your publishing site</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Your saved credentials remain protected in Google Secret Manager.
          </p>
        </div>
        <ConnectionBadge status="connected" />
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-[#131826] p-4">
          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
            WordPress site
          </dt>
          <dd className="mt-2 break-all text-sm font-semibold text-white">
            {targetWpOrigin}
          </dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#131826] p-4">
          <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
            WordPress username
          </dt>
          <dd className="mt-2 break-all text-sm font-semibold text-white">
            {wpUsername}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#f97316] px-4 py-3 text-sm font-bold text-black transition hover:bg-[#ff8a35] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          )}
          {testing ? "Testing connection…" : "Test Connection"}
        </button>
        <button
          type="button"
          onClick={onChange}
          className="flex-1 rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:border-[#f6b63c]/50 hover:bg-white/10"
        >
          Change WordPress Site
        </button>
      </div>
    </section>
  );
}

function ConnectedSiteHelp() {
  return (
    <aside className="h-fit rounded-2xl border border-white/10 bg-[#2d3b5e] p-5 shadow-lg sm:p-6">
      <div className="flex items-center gap-2 text-emerald-300">
        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        <h2 className="font-bold">Connection protected</h2>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-200">
        Test the saved connection anytime. Choose Change WordPress Site only when
        moving to another site or replacing your WordPress Application Password.
      </p>
    </aside>
  );
}

function SetupNavigation({
  activeSection,
  connectionStatus,
  paymentStatus,
  paymentLoading,
  onChange,
}: {
  activeSection: SetupSection;
  connectionStatus: ConnectionStatus;
  paymentStatus: StripeConnectionStatus;
  paymentLoading: boolean;
  onChange(section: SetupSection): void;
}) {
  const items: Array<{
    id: SetupSection;
    label: string;
    status: string;
  }> = [
    {
      id: "wordpress",
      label: "WordPress Site",
      status: connectionStatus === "connected" ? "Connected" : "Needs setup",
    },
    {
      id: "payments",
      label: "Reader Payments",
      status: paymentLoading
        ? "Checking"
        : paymentStatus === "active"
          ? "Ready"
          : "Needs setup",
    },
    {
      id: "author_names",
      label: "Author Names",
      status: "Manage",
    },
  ];

  return (
    <nav
      aria-label="Setup and connections"
      className="mb-6 grid gap-2 rounded-2xl border border-white/10 bg-[#222b45] p-2 shadow-[0_10px_30px_rgba(0,0,0,0.25)] sm:grid-cols-3"
    >
      {items.map((item) => {
        const active = item.id === activeSection;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-16 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f6b63c] ${
              active
                ? "border-[#f6b63c]/60 bg-[#131826] shadow-inner"
                : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/5"
            }`}
          >
            <span className={`text-sm font-bold ${active ? "text-white" : "text-slate-300"}`}>
              {item.label}
            </span>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
              item.status === "Connected" || item.status === "Ready"
                ? "bg-emerald-500/15 text-emerald-300"
                : item.status === "Needs setup"
                  ? "bg-amber-500/15 text-amber-200"
                  : "bg-slate-950/50 text-slate-400"
            }`}>
              {item.status}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function PaymentSetupCard({
  profile,
  loading,
  submitting,
  dashboardLoading,
  onStart,
  onOpenDashboard,
}: {
  profile: PaymentProfile;
  loading: boolean;
  submitting: PaymentModel | null;
  dashboardLoading: boolean;
  onStart(model: PaymentModel): void;
  onOpenDashboard(): void;
}) {
  const selectedModel = profile.paymentModel;
  const isReady = profile.connectionStatus === "active";
  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-[#222b45] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.35)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2 text-[#f6b63c]">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-[0.16em]">Reader payments</span>
          </div>
          <h2 className="mt-2 text-lg font-bold">Choose who manages book-sale payments</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
            Choose the service that fits you. Reader checkout begins only after Stripe verifies the selected setup.
          </p>
        </div>
        {loading ? (
          <span className="inline-flex items-center gap-2 text-xs text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking status
          </span>
        ) : (
          <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
            isReady
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-400/30 bg-amber-500/10 text-amber-200"
          }`}>
            {isReady ? "Payments ready" : profile.configured ? "Setup incomplete" : "Choose a service"}
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <PaymentChoice
          icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
          title="Use my own Stripe account"
          description="Sales are charged on your connected Stripe account. You manage payouts, refunds, disputes, and tax settings."
          model="author_direct"
          selectedModel={selectedModel}
          isReady={isReady}
          submitting={submitting}
          dashboardLoading={dashboardLoading}
          onStart={onStart}
          onOpenDashboard={onOpenDashboard}
        />
        <PaymentChoice
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          title="Let KOBA-I manage payments"
          description="KOBA-I manages payment processing and sends your book-sale proceeds to you. No marketing percentage is deducted unless you separately approve a marketing agreement."
          model="koba_managed"
          selectedModel={selectedModel}
          isReady={isReady}
          submitting={submitting}
          dashboardLoading={dashboardLoading}
          onStart={onStart}
          onOpenDashboard={onOpenDashboard}
        />
      </div>
    </section>
  );
}

function PaymentChoice({
  icon,
  title,
  description,
  model,
  selectedModel,
  isReady,
  submitting,
  dashboardLoading,
  onStart,
  onOpenDashboard,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  model: PaymentModel;
  selectedModel?: PaymentModel;
  isReady: boolean;
  submitting: PaymentModel | null;
  dashboardLoading: boolean;
  onStart(model: PaymentModel): void;
  onOpenDashboard(): void;
}) {
  const selected = selectedModel === model;
  const lockedToOtherModel = Boolean(selectedModel && !selected);
  return (
    <article className={`rounded-xl border p-4 ${
      selected ? "border-[#f6b63c]/60 bg-[#131826]" : "border-white/10 bg-[#1a2238]"
    }`}>
      <div className="flex items-center gap-2 text-[#f6b63c]">
        {icon}
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      <p className="mt-3 min-h-[60px] text-xs leading-5 text-slate-300">{description}</p>
      <button
        type="button"
        disabled={lockedToOtherModel || Boolean(submitting) || dashboardLoading}
        onClick={selected && isReady ? onOpenDashboard : () => onStart(model)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[#f97316]/60 bg-[#f97316] px-4 py-2.5 text-xs font-bold text-black transition hover:bg-[#ff8a35] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-700 disabled:text-slate-300"
      >
        {submitting === model || (selected && isReady && dashboardLoading) ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : null}
        {selected && isReady
          ? "Open Stripe Dashboard"
          : selected
            ? "Continue Stripe setup"
            : lockedToOtherModel
              ? "Another service is selected"
              : "Choose this payment service"}
      </button>
    </article>
  );
}

function LockedAccessCard({ connectionStatus }: { connectionStatus: ConnectionStatus }) {
  const isConnected = connectionStatus === "connected";
  return (
    <div className="my-6 rounded-2xl border border-[#f6b63c]/40 bg-[#222b45] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.35)] sm:p-8">
      <div className="flex items-center gap-3 text-[#f6b63c]">
        <LockKeyhole className="h-6 w-6" aria-hidden="true" />
        <h2 className="text-lg font-bold">
          {isConnected ? "Your site is ready for a future Blog Engine upgrade" : "Connect now, activate Blog Engine later"}
        </h2>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
        {isConnected
          ? "Your WordPress credentials are verified and securely stored. Automated draft delivery remains locked until you activate a KOBA-I Blog Engine plan."
          : "You can securely connect your WordPress site now without purchasing the Blog Engine. Automated draft delivery remains locked until you choose a Blog Engine plan."}
      </p>
      <Link
        href="/visibility-cure"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-5 py-3 text-sm font-bold text-black shadow-md transition hover:bg-[#ff8a35]"
      >
        👑 Increase Your Voice’s Reach — Explore Tools
      </Link>
    </div>
  );
}

function GettingReadyCard({ targetWpOrigin }: { targetWpOrigin: string }) {
  const profileUrl = wordpressProfileUrl(targetWpOrigin);
  return (
    <aside className="h-fit rounded-2xl border border-white/10 bg-[#2d3b5e] p-5 shadow-lg sm:p-6">
      <div className="flex items-center gap-2 text-[#f6b63c]">
        <KeyRound className="h-5 w-5" aria-hidden="true" />
        <h2 className="font-bold">Before you connect</h2>
      </div>
      <ol className="mt-4 space-y-4 text-sm leading-6 text-slate-200">
        <li><strong className="text-white">1.</strong> Open your WordPress user profile.</li>
        <li><strong className="text-white">2.</strong> Find “Application Passwords.”</li>
        <li><strong className="text-white">3.</strong> Name it “KOBA-I Content Engine.”</li>
        <li><strong className="text-white">4.</strong> Copy the generated password and paste it here.</li>
      </ol>
      {profileUrl ? (
        <a
          href={profileUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#f6b63c] hover:text-[#ffd071]"
        >
          Open my WordPress profile
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : (
        <p className="mt-5 text-xs leading-5 text-slate-400">
          Enter your website address first and we’ll give you a shortcut to your WordPress profile.
        </p>
      )}
    </aside>
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return status === "connected" ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Connected
    </span>
  ) : (
    <span className="rounded-full border border-slate-500/40 bg-slate-900/30 px-3 py-1.5 text-xs font-bold text-slate-300">
      Not connected
    </span>
  );
}

function MessageBanner({ message }: { message: StatusMessage }) {
  const bannerClass =
    message.type === "success"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      : message.type === "error"
        ? "border-red-400/30 bg-red-500/10 text-red-100"
        : "border-slate-500/40 bg-slate-900/40 text-slate-200";

  return (
    <div
      role={message.type === "error" ? "alert" : "status"}
      className={`mb-6 rounded-xl border px-4 py-3 text-sm ${bannerClass}`}
    >
      {message.text}
    </div>
  );
}

function ConnectionField({
  id,
  label,
  value,
  placeholder,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange(value: string): void;
  type?: "text" | "url" | "password";
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
        autoComplete={type === "password" ? "new-password" : undefined}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-[#7084b5] bg-[#131826] px-3 py-3 text-sm text-white shadow-inner outline-none placeholder:text-slate-500 focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/30"
      />
    </label>
  );
}

function wordpressProfileUrl(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return null;
    return `${url.origin}/wp-admin/profile.php`;
  } catch {
    return null;
  }
}
