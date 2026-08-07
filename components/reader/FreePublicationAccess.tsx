"use client";

import Script from "next/script";
import { useCallback, useRef, useState } from "react";

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function FreePublicationAccess({
  assetId,
  siteKey,
}: {
  assetId: string;
  siteKey: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"ready" | "verifying" | "opening">("ready");
  const [error, setError] = useState<string | null>(null);

  const exchangeChallenge = useCallback(async (turnstileToken: string) => {
    setStatus("opening");
    setError(null);
    try {
      const response = await fetch("/api/reader/media/free-handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, turnstileToken }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.launchUrl !== "string") {
        throw new Error(payload.error || "KOBA-I could not open this publication.");
      }
      window.location.assign(payload.launchUrl);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "KOBA-I could not open this publication.");
      setStatus("ready");
      window.turnstile?.reset(widgetIdRef.current || undefined);
    }
  }, [assetId]);

  const renderChallenge = useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetIdRef.current) return;
    setStatus("verifying");
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: "free_publication",
      cData: assetId,
      theme: "dark",
      size: "flexible",
      callback: exchangeChallenge,
      "error-callback": () => {
        setError("Human verification could not load. Please retry.");
        setStatus("ready");
      },
      "expired-callback": () => setStatus("verifying"),
    });
  }, [assetId, exchangeChallenge, siteKey]);

  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-white/15 bg-[#1b274a] p-8 text-center shadow-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#EFB752]">
        KOBA-I Free Publication
      </p>
      <h1 className="mt-3 text-3xl font-bold">Confirm you are human</h1>
      <p className="mt-3 text-slate-300">
        Complete the managed security check. No account, phone number, email address, or payment is required.
      </p>
      <div ref={containerRef} className="mx-auto mt-7 min-h-[70px] max-w-sm" />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderChallenge}
      />
      <p aria-live="polite" className="mt-4 text-sm text-slate-300">
        {status === "opening" ? "Opening your publication…" : status === "verifying" ? "Waiting for verification…" : "Ready to verify."}
      </p>
      {error ? <p role="alert" className="mt-4 rounded-lg bg-red-950/60 p-3 text-sm text-red-100">{error}</p> : null}
    </section>
  );
}
