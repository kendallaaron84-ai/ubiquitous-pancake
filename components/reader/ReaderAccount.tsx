"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ReaderBookshelfPublication } from "@/core/security/reader-bookshelf";
import { paidReaderLaunchPath } from "@/core/security/reader-paid-launch";

interface ReaderSummary {
  email: string | null;
  displayName: string | null;
}

export function ReaderAccount({
  reader,
  publications,
}: {
  reader: ReaderSummary;
  publications: ReaderBookshelfPublication[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [openingAssetId, setOpeningAssetId] = useState<string | null>(null);

  function openPublication(assetId: string) {
    setError(null);
    setOpeningAssetId(assetId);
    const launchPath = paidReaderLaunchPath(assetId);
    if (!launchPath) {
      setError("KOBA-I could not open this publication.");
      setOpeningAssetId(null);
      return;
    }
    window.location.assign(launchPath);
  }

  async function logout() {
    const response = await fetch("/api/reader/logout", { method: "POST" });
    if (!response.ok) {
      setError("KOBA-I could not close this reader session.");
      return;
    }
    router.replace("/reader/signin");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 border-b border-white/15 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#EFB752]">
            KOBA-I Reader
          </p>
          <h1 className="mt-2 text-4xl font-bold">My Bookshelf</h1>
          <p className="mt-2 text-slate-200">
            Signed in as {reader.displayName || reader.email}.
          </p>
        </div>
        <Button
          onClick={logout}
          variant="outline"
          className="border-slate-300 bg-transparent text-white hover:bg-white/10 hover:text-white"
        >
          Sign out
        </Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-950/60 p-4 text-red-100">
          {error}
        </p>
      ) : null}

      {publications.length === 0 ? (
        <section className="rounded-2xl border border-white/15 bg-[#1b274a] px-6 py-14 text-center">
          <h2 className="text-2xl font-semibold">Your Bookshelf is ready</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-300">
            Publications you purchase or unlock will appear here after they are
            attached to this reader account.
          </p>
        </section>
      ) : (
        <section
          aria-label="Entitled publications"
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {publications.map((publication) => (
            <article
              key={publication.assetId}
              className="overflow-hidden rounded-2xl border border-white/15 bg-[#1b274a] shadow-xl"
            >
              <div className="aspect-[4/3] bg-[#0b1228]">
                {publication.coverUrl ? (
                  // A plain image supports author-hosted HTTPS artwork without expanding Next image hosts.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={publication.coverUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-bold uppercase tracking-[0.2em] text-[#EFB752]">
                    KOBA-I Publication
                  </div>
                )}
              </div>
              <div className="space-y-3 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#EFB752]">
                  {publication.publicationType}
                </p>
                <h2 className="text-xl font-semibold">{publication.title}</h2>
                <p className="text-sm text-slate-300">by {publication.authorName}</p>
                {publication.description ? (
                  <p className="line-clamp-3 text-sm text-slate-300">
                    {publication.description}
                  </p>
                ) : null}
                {publication.publicationUrl ? (
                  <Button
                    type="button"
                    onClick={() => openPublication(publication.assetId)}
                    disabled={openingAssetId === publication.assetId}
                    className="w-full bg-[#ef7a2e] text-black hover:bg-[#f4934f]"
                  >
                    {openingAssetId === publication.assetId ? "Opening…" : "Open publication"}
                  </Button>
                ) : (
                  <p className="rounded-md bg-white/5 px-3 py-2 text-center text-xs text-slate-300">
                    Available in your Bookshelf
                  </p>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
