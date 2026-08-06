"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ClaimState =
  | { kind: "loading" }
  | { kind: "pending"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "success"; entitlementCount: number }
  | { kind: "error"; message: string; code?: string };

export function ReaderPurchaseClaim({
  checkoutSessionId,
}: {
  checkoutSessionId: string;
}) {
  const [state, setState] = useState<ClaimState>({ kind: "loading" });
  const claimPath = `/reader/claim?session_id=${encodeURIComponent(
    checkoutSessionId
  )}`;
  const signInHref = `/reader/signin?next=${encodeURIComponent(claimPath)}`;
  const signUpHref = `/reader/signup?next=${encodeURIComponent(claimPath)}`;

  const claim = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/reader/purchases/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkoutSessionId }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        pending?: boolean;
        code?: string;
        error?: string;
        entitlementCount?: number;
      };
      if (response.status === 401) {
        setState({
          kind: "auth",
          message: "Sign in with the verified email used at checkout.",
        });
        return;
      }
      if (response.status === 202 || data.pending) {
        setState({
          kind: "pending",
          message:
            data.error ||
            "Stripe is still confirming the payment. Retry in a moment.",
        });
        return;
      }
      if (!response.ok || !data.success) {
        setState({
          kind: "error",
          code: data.code,
          message: data.error || "KOBA-I could not claim this purchase.",
        });
        return;
      }
      setState({
        kind: "success",
        entitlementCount: Number(data.entitlementCount || 0),
      });
    } catch {
      setState({
        kind: "error",
        message: "KOBA-I could not reach the purchase claim service.",
      });
    }
  }, [checkoutSessionId]);

  useEffect(() => {
    void claim();
  }, [claim]);

  return (
    <Card className="w-full border border-[#7084b5]/35 bg-[#243665] text-white shadow-2xl">
      <CardHeader className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#EFB752]">
          KOBA-I Reader
        </p>
        <CardTitle className="text-2xl">Claim your purchase</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        {state.kind === "loading" && (
          <p role="status" className="text-slate-200">
            Confirming your purchase with Stripe...
          </p>
        )}
        {state.kind === "auth" && (
          <>
            <p className="text-slate-200">{state.message}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button asChild className="bg-[#f47b20] text-slate-950 hover:bg-[#EFB752]">
                <Link href={signInHref}>Reader sign in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={signUpHref}>Create reader account</Link>
              </Button>
            </div>
          </>
        )}
        {state.kind === "pending" && (
          <>
            <p role="status" className="text-slate-200">{state.message}</p>
            <Button onClick={() => void claim()}>Retry payment check</Button>
          </>
        )}
        {state.kind === "success" && (
          <>
            <p role="status" className="text-slate-100">
              Purchase claimed. {state.entitlementCount} publication
              {state.entitlementCount === 1 ? " is" : "s are"} now attached to
              your reader account.
            </p>
            <Button asChild className="bg-[#f47b20] text-slate-950 hover:bg-[#EFB752]">
              <Link href="/reader/account">Open reader account</Link>
            </Button>
          </>
        )}
        {state.kind === "error" && (
          <>
            <div role="alert" className="rounded-md border border-red-400/50 bg-red-950/40 p-3 text-sm">
              {state.message}
              {state.code ? <p className="mt-2 text-xs">Reference: {state.code}</p> : null}
            </div>
            <Button onClick={() => void claim()}>Retry claim</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
