"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { AlertTriangle } from "lucide-react";

import { auth, db } from "@/core/firebase";

type PaymentReadiness = {
  chargesEnabled?: boolean;
  connectionStatus?: string;
  paymentModel?: "author_direct" | "koba_managed";
  stripeConnectAccountId?: string;
};

export default function PaymentReadinessBanner() {
  const [profile, setProfile] = useState<PaymentReadiness | null>(null);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;

      const email = user?.email?.trim().toLowerCase();
      if (!email) {
        setProfile(null);
        return;
      }

      unsubscribeProfile = onSnapshot(
        doc(db, "users", email),
        (snapshot) => setProfile(snapshot.exists() ? snapshot.data() as PaymentReadiness : {}),
        () => setProfile({}),
      );
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  if (!profile || (profile.chargesEnabled && profile.connectionStatus === "active")) {
    return null;
  }

  const hasStripeAccount = Boolean(profile.stripeConnectAccountId);
  const message = hasStripeAccount
    ? "Stripe needs a little more information before readers can purchase your books."
    : "Set up reader payments before offering paid books for sale.";

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-950/60 p-4 text-amber-100 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold">Reader payments need attention</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/80">{message}</p>
        </div>
      </div>
      <Link
        href="/connect"
        className="shrink-0 rounded-lg bg-amber-400 px-4 py-2 text-center text-xs font-bold text-slate-950 transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
      >
        Finish payment setup
      </Link>
    </div>
  );
}
