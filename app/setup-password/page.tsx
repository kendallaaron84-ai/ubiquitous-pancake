"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { Check, Lock, Mail, ShieldAlert, Volume2 } from "lucide-react";

import { auth } from "@/core/firebase";

function SetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitationToken = searchParams.get("invite")?.trim() || "";
  const [identity, setIdentity] = useState<{ authorEmail: string; authorName: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!invitationToken) {
      setErrorMsg("This account-establishment invitation is incomplete.");
      setLoading(false);
      return () => controller.abort();
    }
    fetch(`/api/auth/invitation?token=${encodeURIComponent(invitationToken)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.success) throw new Error(payload?.error || "This invitation is unavailable.");
        setIdentity(payload.invitation);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setErrorMsg(error instanceof Error ? error.message : "This invitation is unavailable.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [invitationToken]);

  const criteria = {
    length: password.length >= 8,
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    match: password !== "" && password === confirmPassword,
  };
  const isFormValid = Boolean(identity) && Object.values(criteria).every(Boolean) && !loading;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isFormValid) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const response = await fetch("/api/auth/invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: invitationToken, password }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success || !payload.customToken) throw new Error(payload?.error || "Account establishment failed.");
      const credential = await signInWithCustomToken(auth, payload.customToken);
      const idToken = await credential.user.getIdToken();
      const sessionResponse = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const session = await sessionResponse.json();
      if (!sessionResponse.ok || !session?.success) throw new Error(session?.error || "The dashboard session could not be established.");
      setSuccess(true);
      window.setTimeout(() => router.replace("/products"), 900);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Account establishment failed.");
      setLoading(false);
    }
  }

  return (
    <div className="relative w-full max-w-lg space-y-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
      <header className="relative z-10 space-y-2 text-center">
        <div className="mb-2 inline-flex rounded-full border border-purple-500/20 bg-purple-500/10 p-3 text-purple-400"><Volume2 className="h-7 w-7" /></div>
        <h1 className="text-2xl font-black tracking-tight text-white">KOBA-I <span className="font-light text-purple-400">AUDIO</span></h1>
        <p className="text-sm text-slate-400">Establish your author workspace identity.</p>
      </header>
      {loading && !identity ? <p className="text-center text-sm text-slate-300">Validating your secure invitation…</p> : null}
      {errorMsg ? <div role="alert" className="flex gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300"><ShieldAlert className="h-5 w-5 shrink-0" />{errorMsg}</div> : null}
      {identity ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-300">
            <p className="text-xs uppercase tracking-wider text-slate-500">Author account</p>
            <p className="mt-2 font-semibold text-white">{identity.authorName}</p>
            <p className="mt-1 flex items-center gap-2 text-sm"><Mail className="h-4 w-4" />{identity.authorEmail}</p>
          </div>
          <PasswordField label="Create password" value={password} setValue={setPassword} visible={showPassword} toggle={() => setShowPassword((value) => !value)} />
          <PasswordField label="Confirm password" value={confirmPassword} setValue={setConfirmPassword} visible={showPassword} />
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400">
            {[[criteria.length, "8+ characters"], [criteria.number, "Contains a number"], [criteria.special, "Special symbol"], [criteria.match, "Passwords match"]].map(([ok, label]) => <span key={String(label)} className={ok ? "text-emerald-300" : ""}><Check className="mr-1 inline h-3.5 w-3.5" />{label}</span>)}
          </div>
          <button type="submit" disabled={!isFormValid || success} className="w-full rounded-xl bg-purple-600 py-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {success ? "Workspace identity established" : loading ? "Establishing workspace…" : "Establish Workspace Identity"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function PasswordField({ label, value, setValue, visible, toggle }: { label: string; value: string; setValue(value: string): void; visible: boolean; toggle?: () => void }) {
  return <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">{label}<span className="relative mt-1 block"><Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input type={visible ? "text" : "password"} value={value} onChange={(event) => setValue(event.target.value)} className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3.5 pl-10 pr-12 text-sm text-white" autoComplete="new-password" />{toggle ? <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Show</button> : null}</span></label>;
}

export default function SetupPasswordPage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6"><Suspense fallback={<p className="text-white">Loading…</p>}><SetupForm /></Suspense></main>;
}
