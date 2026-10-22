"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/core/firebase";
import { paidReaderLaunchPath, paidReaderRecoveryPath } from "@/core/security/reader-paid-launch";
import { switchReaderAccountForContinuation } from "@/core/security/reader-purchase-account-switch";

type RecoveryState =
  | { kind: "loading" }
  | { kind: "accountSwitch"; message: string }
  | { kind: "error"; message: string };

export function ReaderPurchaseRecovery({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [state, setState] = useState<RecoveryState>({ kind: "loading" });
  const recoveryPath = paidReaderRecoveryPath(assetId);
  const launchPath = paidReaderLaunchPath(assetId);

  const recover = useCallback(async () => {
    if (!recoveryPath || !launchPath) {
      setState({ kind: "error", message: "This publication link is invalid." });
      return;
    }
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/reader/purchases/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        code?: string;
        error?: string;
      };
      if (response.status === 401) {
        router.replace(`/reader/signin?next=${encodeURIComponent(recoveryPath)}`);
        return;
      }
      if (data.code === "READER_PURCHASE_ACCOUNT_SWITCH_REQUIRED") {
        setState({
          kind: "accountSwitch",
          message:
            "Sign in with the email used at checkout to add this purchase to the correct Bookshelf.",
        });
        return;
      }
      if (!response.ok || !data.success) {
        setState({
          kind: "error",
          message:
            data.code === "READER_PURCHASE_RECOVERY_AMBIGUOUS"
              ? "We found more than one possible purchase. Please contact KOBA-I support so we can help safely."
              : data.error || "We could not find this purchase for the signed-in reader account.",
        });
        return;
      }
      router.replace(launchPath);
      router.refresh();
    } catch {
      setState({
        kind: "error",
        message: "KOBA-I could not reach the purchase recovery service.",
      });
    }
  }, [assetId, launchPath, recoveryPath, router]);

  const switchAccount = useCallback(async () => {
    if (!recoveryPath) return;
    setState({ kind: "loading" });
    try {
      await switchReaderAccountForContinuation({
        continuationPath: recoveryPath,
        logoutReaderSession: () => fetch("/api/reader/logout", { method: "POST" }),
        logoutFirebaseIdentity: () => signOut(auth),
        navigate: (path) => router.replace(path),
      });
    } catch {
      setState({
        kind: "error",
        message: "KOBA-I could not switch reader accounts. Please try again.",
      });
    }
  }, [recoveryPath, router]);

  useEffect(() => {
    void recover();
  }, [recover]);

  return (
    <Card className="mx-auto w-full max-w-md border border-[#7084b5]/35 bg-[#243665] text-white shadow-2xl">
      <CardHeader className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#EFB752]">
          KOBA-I Reader
        </p>
        <CardTitle className="text-2xl">Access your purchase</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        {state.kind === "loading" && (
          <p role="status" className="text-slate-200">
            Checking your Bookshelf and purchase history...
          </p>
        )}
        {state.kind === "accountSwitch" && (
          <>
            <div role="alert" className="space-y-2 text-slate-100">
              <p className="font-semibold">
                This purchase was made with a different email address.
              </p>
              <p className="text-slate-200">
                You&apos;re currently signed in with another KOBA-I Reader account. {state.message}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void switchAccount()}
              className="w-full bg-[#f47b20] text-slate-950 hover:bg-[#EFB752]"
            >
              Switch account
            </Button>
          </>
        )}
        {state.kind === "error" && (
          <>
            <p role="alert" className="rounded-md border border-red-400/50 bg-red-950/40 p-3 text-sm">
              {state.message}
            </p>
            <Button type="button" onClick={() => void recover()}>
              Try again
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
