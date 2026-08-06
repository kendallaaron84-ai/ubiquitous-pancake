"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type AuthError,
} from "firebase/auth";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth } from "@/core/firebase";

type ReaderAuthMode = "signin" | "signup" | "recover";

function friendlyError(error: unknown): string {
  const code = (error as AuthError)?.code;
  if (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password"
  ) {
    return "The email or password is incorrect.";
  }
  if (code === "auth/email-already-in-use") {
    return "A reader account already exists for this email. Sign in instead.";
  }
  if (code === "auth/weak-password") {
    return "Choose a stronger password with at least six characters.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts were made. Please wait and try again.";
  }
  return error instanceof Error
    ? error.message
    : "KOBA-I could not complete this reader request.";
}

async function openReaderSession(idToken: string) {
  const response = await fetch("/api/reader/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const data = (await response.json()) as {
    success?: boolean;
    error?: string;
  };
  if (!response.ok || !data.success) {
    throw new Error(data.error || "The reader session could not be created.");
  }
}

export function ReaderAuthForm({ mode }: { mode: ReaderAuthMode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "recover") {
        await sendPasswordResetEmail(auth, email.trim(), {
          url: `${window.location.origin}/reader/signin`,
        });
        setNotice("Password recovery instructions were sent if that reader account exists.");
        return;
      }

      if (mode === "signup") {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        if (name.trim()) {
          await updateProfile(credential.user, { displayName: name.trim() });
        }
        await sendEmailVerification(credential.user, {
          url: `${window.location.origin}/reader/signin?verified=1`,
        });
        await signOut(auth);
        setNotice(
          "Your reader account was created. Open the verification email before signing in."
        );
        return;
      }

      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      await credential.user.reload();
      if (!credential.user.emailVerified) {
        await sendEmailVerification(credential.user, {
          url: `${window.location.origin}/reader/signin?verified=1`,
        });
        await signOut(auth);
        throw new Error(
          "Verify your email before signing in. A new verification message was sent."
        );
      }
      await openReaderSession(await credential.user.getIdToken(true));
      router.push("/reader/account");
      router.refresh();
    } catch (requestError: unknown) {
      setError(friendlyError(requestError));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "signin"
      ? "Reader sign in"
      : mode === "signup"
        ? "Create your reader account"
        : "Recover your reader account";

  return (
    <Card className="w-full border border-[#7084b5]/35 bg-[#243665] text-white shadow-2xl">
      <CardHeader className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#EFB752]">
          KOBA-I Reader
        </p>
        <CardTitle className="text-2xl">{title}</CardTitle>
        <p className="text-sm text-slate-200">
          Your reader account is separate from an author dashboard account.
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <div role="alert" className="mb-4 rounded-md border border-red-400/50 bg-red-950/40 p-3 text-sm">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mb-4 rounded-md border border-emerald-400/50 bg-emerald-950/35 p-3 text-sm">
            {notice}
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="reader-name">Display name</Label>
              <Input id="reader-name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} autoComplete="name" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="reader-email">Email address</Label>
            <Input id="reader-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} required autoComplete="email" />
          </div>
          {mode !== "recover" && (
            <div className="space-y-2">
              <Label htmlFor="reader-password">Password</Label>
              <Input id="reader-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required minLength={6} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            </div>
          )}
          <Button type="submit" disabled={busy} className="w-full bg-[#f47b20] text-slate-950 hover:bg-[#EFB752]">
            {busy
              ? "Please wait..."
              : mode === "signin"
                ? "Sign in to your library"
                : mode === "signup"
                  ? "Create reader account"
                  : "Send recovery email"}
          </Button>
        </form>
        <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm">
          {mode !== "signin" && <Link className="text-[#EFB752] underline" href="/reader/signin">Reader sign in</Link>}
          {mode !== "signup" && <Link className="text-[#EFB752] underline" href="/reader/signup">Create account</Link>}
          {mode !== "recover" && <Link className="text-[#EFB752] underline" href="/reader/recover">Forgot password?</Link>}
        </div>
      </CardContent>
    </Card>
  );
}
