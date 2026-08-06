"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

interface ReaderSummary {
  email: string | null;
  displayName: string | null;
}

export function ReaderAccount() {
  const router = useRouter();
  const [reader, setReader] = useState<ReaderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/reader/session", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Reader session expired.");
        if (active) setReader(body.reader);
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Reader session expired.");
      });
    return () => { active = false; };
  }, []);

  async function logout() {
    const response = await fetch("/api/reader/logout", { method: "POST" });
    if (!response.ok) {
      setError("KOBA-I could not close this reader session.");
      return;
    }
    router.replace("/reader/signin");
    router.refresh();
  }

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p role="alert">{error}</p>
        <Button onClick={() => router.replace("/reader/signin")}>Reader sign in</Button>
      </div>
    );
  }
  if (!reader) return <p>Validating your reader session...</p>;

  return (
    <div className="space-y-5 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#EFB752]">KOBA-I Reader</p>
      <h1 className="text-3xl font-bold">Reader session established</h1>
      <p className="text-slate-200">
        Signed in as {reader.displayName || reader.email}. Your Bookshelf will be connected in Phase 5C.
      </p>
      <Button onClick={logout} variant="outline" className="border-slate-300 bg-transparent text-white hover:bg-white/10 hover:text-white">
        Sign out
      </Button>
    </div>
  );
}
