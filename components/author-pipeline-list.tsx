import React, { useState } from "react";
import { deleteDoc, doc } from "firebase/firestore";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { db } from "@/core/firebase";

export interface PipelineItem {
  id: string;
  title: string;
  brandAllocation: string;
  executionState:
    | "initializing"
    | "queued"
    | "drafting"
    | "artwork"
    | "staging"
    | "retrying"
    | "completed"
    | "failed";
  createdAt?: unknown;
  liveDraftUrl?: string;
  facebookCopy?: string;
  instagramCopy?: string;
  imagePrompt?: string;
}

interface AuthorPipelineListProps {
  items: PipelineItem[];
  onRefresh: () => void;
}

interface RetryResponse {
  status?: unknown;
  blueprintId?: unknown;
  error?: unknown;
}

export function AuthorPipelineList({
  items,
  onRefresh,
}: AuthorPipelineListProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});

  const toggleRow = (id: string) => {
    setExpandedRow((current) => (current === id ? null : id));
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this blog record from your history?")) {
      return;
    }

    try {
      await deleteDoc(doc(db, "content_blueprints", id));
      onRefresh();
    } catch (error: unknown) {
      console.error("Failed to remove the blog record:", error);
    }
  };

  const handleRetry = async (id: string) => {
    if (retryingIds.has(id)) {
      return;
    }

    setRetryingIds((current) => new Set(current).add(id));
    setRetryErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    try {
      const response = await fetch("/api/generate-blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ blueprintId: id }),
      });
      const payload = (await response.json().catch(() => null)) as
        | RetryResponse
        | null;

      if (
        !response.ok ||
        response.status !== 202 ||
        payload?.status !== "accepted" ||
        payload.blueprintId !== id
      ) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "The retry could not be accepted. Please try again."
        );
      }
      window.dispatchEvent(new Event("koba:blog-retry-accepted"));
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "The retry could not be completed.";
      setRetryErrors((current) => ({ ...current, [id]: message }));
    } finally {
      setRetryingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="min-w-full divide-y divide-border text-left text-sm">
        <thead className="bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
          <tr>
            <th className="p-4">Topic Title / Core Keyword</th>
            <th className="p-4">Brand Allocation</th>
            <th className="p-4">Date Created</th>
            <th className="p-4">Execution State</th>
            <th className="p-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-white">
          {items.map((item) => {
            const isRetrying = retryingIds.has(item.id);

            return (
              <React.Fragment key={item.id}>
                <tr className="transition-colors hover:bg-muted/20">
                  <td className="max-w-sm truncate p-4 font-medium">
                    {item.title}
                  </td>
                  <td className="p-4 text-muted-foreground">
                    {item.brandAllocation}
                  </td>
                  <td className="whitespace-nowrap p-4 text-muted-foreground">
                    {formatCreatedAt(item.createdAt)}
                  </td>
                  <td className="p-4">
                    <ExecutionStateBadge state={item.executionState} />
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {item.executionState === "completed" &&
                        (item.facebookCopy || item.instagramCopy) && (
                          <button
                            type="button"
                            onClick={() => toggleRow(item.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-all hover:bg-secondary/80"
                          >
                            {expandedRow === item.id ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                            Assets
                          </button>
                        )}

                      {item.liveDraftUrl && (
                        <a
                          href={item.liveDraftUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-primary"
                        >
                          <ExternalLink className="h-3 w-3" /> WordPress Draft
                        </a>
                      )}

                      {item.executionState === "failed" && (
                        <button
                          type="button"
                          onClick={() => void handleRetry(item.id)}
                          disabled={isRetrying}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${
                              isRetrying ? "animate-spin" : ""
                            }`}
                          />
                          {isRetrying ? "Retrying..." : "Retry"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => void handleDelete(item.id)}
                        className="rounded-lg bg-red-500/10 p-1.5 text-red-400 transition-all hover:bg-red-500 hover:text-white"
                        title="Remove blog record"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {retryErrors[item.id] && (
                      <p className="mt-2 max-w-sm text-right text-xs text-red-400">
                        {retryErrors[item.id]}
                      </p>
                    )}
                  </td>
                </tr>

                {expandedRow === item.id && (
                  <tr className="bg-muted/5">
                    <td colSpan={5} className="border-t border-border/50 p-5">
                      <div className="grid grid-cols-1 gap-6 animate-in slide-in-from-top-2 duration-200 md:grid-cols-2">
                        {item.instagramCopy && (
                          <AssetCopyBlock
                            label="Instagram Caption"
                            labelClassName="text-pink-400"
                            text={item.instagramCopy}
                            onCopy={copyToClipboard}
                          />
                        )}

                        {item.facebookCopy && (
                          <AssetCopyBlock
                            label="Facebook Post"
                            labelClassName="text-blue-400"
                            text={item.facebookCopy}
                            onCopy={copyToClipboard}
                          />
                        )}

                        {item.imagePrompt && (
                          <div className="space-y-1.5 md:col-span-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-purple-400">
                                AI Image Prompt
                              </span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(item.imagePrompt!)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="rounded-lg border border-border bg-background p-3 font-mono text-sm text-muted-foreground">
                              {item.imagePrompt}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const STAGE_ORDER = ["queued", "drafting", "artwork", "staging"] as const;

const STATE_DESCRIPTIONS: Record<PipelineItem["executionState"], string> = {
  initializing: "Preparing your blog request.",
  queued:
    "Your topic is safely queued. You can leave this page—your draft will continue building in the background.",
  drafting:
    "Writing your article, applying your brand voice, and preparing search metadata.",
  artwork:
    "Creating original featured artwork for this article using AI image generation.",
  staging:
    "Uploading the artwork to your media library and preparing a private WordPress draft.",
  retrying: "The failed draft is being placed back into the secure queue.",
  completed:
    "Article and featured artwork staged. Your private WordPress draft is ready for review.",
  failed: "The generation process encountered an issue. Click Retry to re-queue this draft.",
};

function ExecutionStateBadge({ state }: { state: PipelineItem["executionState"] }) {
  const styles: Record<PipelineItem["executionState"], string> = {
    initializing: "bg-gray-500/10 text-gray-400",
    queued: "bg-sky-500/10 text-sky-400",
    drafting: "bg-blue-500/10 text-blue-400",
    artwork: "bg-purple-500/10 text-purple-400",
    staging: "bg-cyan-500/10 text-cyan-400",
    retrying: "bg-amber-500/10 text-amber-400",
    completed: "bg-green-500/10 text-green-400",
    failed: "bg-red-500/10 text-red-400",
  };
  const labels: Record<PipelineItem["executionState"], string> = {
    initializing: "Initializing",
    queued: "Request Queued",
    drafting: "Drafting Article",
    artwork: "Generating Artwork",
    staging: "Staging in WordPress",
    retrying: "Retrying",
    completed: "Completed",
    failed: "Failed",
  };

  return (
    <div className="min-w-[280px] space-y-2" title={STATE_DESCRIPTIONS[state]}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${styles[state]} ${
          state !== "completed" && state !== "failed" ? "animate-pulse" : ""
        }`}
      >
        {labels[state]}
      </span>
      <StageStepper state={state} />
    </div>
  );
}

function StageStepper({ state }: { state: PipelineItem["executionState"] }) {
  if (state === "initializing" || state === "failed") return null;

  const activeIndex =
    state === "completed"
      ? STAGE_ORDER.length
      : state === "retrying"
        ? 0
        : STAGE_ORDER.indexOf(state as (typeof STAGE_ORDER)[number]);

  return (
    <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-tight text-muted-foreground">
      {STAGE_ORDER.map((stage, index) => {
        const complete = activeIndex > index || state === "completed";
        const active = activeIndex === index && state !== "completed";
        return (
          <React.Fragment key={stage}>
            {index > 0 && <span className="h-px w-2 bg-border" />}
            <span className={complete ? "text-emerald-400" : active ? "text-amber-300" : ""}>
              {complete ? "✓" : active ? "●" : "○"} {stage}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function AssetCopyBlock({
  label,
  labelClassName,
  text,
  onCopy,
}: {
  label: string;
  labelClassName: string;
  text: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${labelClassName}`}>{label}</span>
        <button
          type="button"
          onClick={() => onCopy(text)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm text-foreground">
        {text}
      </div>
    </div>
  );
}

function formatCreatedAt(value: unknown): string {
  const date = toValidDate(value);
  if (!date) {
    return "Pending";
  }

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toValidDate(value: unknown): Date | null {
  let candidate: Date | null = null;

  if (value instanceof Date) {
    candidate = value;
  } else if (typeof value === "string" && value.trim()) {
    candidate = new Date(value);
  } else if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      candidate = (value as { toDate: () => Date }).toDate();
    } catch {
      candidate = null;
    }
  }

  return candidate && Number.isFinite(candidate.getTime()) ? candidate : null;
}
