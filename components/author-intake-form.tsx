"use client";

import React, { useState } from "react";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  Briefcase,
  FileText,
  LayoutTemplate,
  Sparkles,
  Users,
} from "lucide-react";

import { auth, db } from "@/core/firebase";
import { useToast } from "@/hooks/use-toast";

interface GenerateBlogResponse {
  status?: unknown;
  blueprintId?: unknown;
  error?: unknown;
}

export function AuthorIntakeForm() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    brand: "personal",
    audience: "",
    description: "",
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.title.trim()) {
      toast({
        title: "Title required",
        description: "Enter a working title or topic before creating the blog.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    let blueprintId: string | null = null;

    try {
      const userEmail = auth.currentUser?.email?.trim().toLowerCase();
      if (!userEmail) {
        throw new Error("Your session expired. Sign in again before creating a blog.");
      }

      const blueprintReference = await addDoc(
        collection(db, "content_blueprints"),
        {
          authorEmail: userEmail,
          topicTitle: formData.title.trim(),
          title: formData.title.trim(),
          brandAllocation: formData.brand,
          targetAudience: formData.audience.trim(),
          synopsis: formData.description.trim(),
          executionState: "initializing",
          createdAt: serverTimestamp(),
        }
      );
      blueprintId = blueprintReference.id;

      const response = await fetch("/api/generate-blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ blueprintId }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json().catch(() => null)) as
        | GenerateBlogResponse
        | null;

      if (
        !response.ok ||
        response.status !== 202 ||
        payload?.status !== "accepted" ||
        payload.blueprintId !== blueprintId
      ) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "The blog engine did not accept this request."
        );
      }

      toast({
        title: "Draft generation queued!",
        description:
          "Your article, search metadata, and featured artwork are building in the background. You can safely leave this page.",
      });
      setFormData({
        title: "",
        brand: "personal",
        audience: "",
        description: "",
      });
    } catch (error: unknown) {
      const message = errorMessage(error);

      if (blueprintId) {
        try {
          await updateDoc(doc(db, "content_blueprints", blueprintId), {
            executionState: "failed",
            errorLog: message.slice(0, 500),
            updatedAt: serverTimestamp(),
          });
        } catch (updateError: unknown) {
          console.error("Failed to record the blog submission error:", updateError);
        }
      }

      setSubmissionError(message);
      toast({
        title: "Blog request failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="border-b border-border bg-slate-950/40 p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
          <Sparkles className="h-5 w-5 text-emerald-500" />
          Create a Blog Draft
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Add your topic, audience, and direction. The finished article will be
          staged for review.
        </p>
      </div>

      <div className="space-y-5 p-5">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3 w-3" /> Working Title / Topic
          </label>
          <input
            type="text"
            required
            value={formData.title}
            onChange={(event) =>
              setFormData({ ...formData, title: event.target.value })
            }
            className="w-full rounded-xl border border-border bg-slate-950/50 px-4 py-3 text-sm font-semibold text-white transition-colors focus:border-emerald-500/50 focus:outline-none"
            placeholder="e.g. 5 Reasons Audiobooks Outsell Print"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Briefcase className="h-3 w-3" /> Voice Allocation
            </label>
            <select
              value={formData.brand}
              onChange={(event) =>
                setFormData({ ...formData, brand: event.target.value })
              }
              className="w-full appearance-none rounded-xl border border-border bg-slate-950/50 px-4 py-3 text-sm text-white transition-colors focus:border-emerald-500/50 focus:outline-none"
            >
              <option value="personal">Personal Author Brand</option>
              <option value="book_lore">Book Specific Lore</option>
              <option value="technical">Technical / Analytical</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Users className="h-3 w-3" /> Target Audience
            </label>
            <input
              type="text"
              value={formData.audience}
              onChange={(event) =>
                setFormData({ ...formData, audience: event.target.value })
              }
              className="w-full rounded-xl border border-border bg-slate-950/50 px-4 py-3 text-sm text-white transition-colors focus:border-emerald-500/50 focus:outline-none"
              placeholder="e.g. Noir Thriller Fans"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <LayoutTemplate className="h-3 w-3" /> Synopsis / Instructions
          </label>
          <textarea
            value={formData.description}
            onChange={(event) =>
              setFormData({ ...formData, description: event.target.value })
            }
            className="h-24 w-full resize-none rounded-xl border border-border bg-slate-950/50 px-4 py-3 text-sm text-white transition-colors focus:border-emerald-500/50 focus:outline-none"
            placeholder="Describe the message, tone, or important points to include."
          />
        </div>

        {submissionError && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
          >
            <p className="font-semibold">Your draft request was not completed.</p>
            <p className="mt-1 text-xs">{submissionError}</p>
            <p className="mt-1 text-xs">
              Your form was preserved. You can submit it again or retry the failed
              row in Live Blogs.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-bold text-slate-950 transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? (
            <span className="animate-pulse">Creating Blog Draft...</span>
          ) : (
            <>
              Create Blog Draft <Sparkles className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The queue did not confirm this request in time. Your form has been preserved.";
  }

  return error instanceof Error
    ? error.message
    : "The blog request could not be completed.";
}
