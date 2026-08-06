"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  collection,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, type User } from "firebase/auth";

import Layout from "@/components/layout";
import { AuthorIntakeForm } from "@/components/author-intake-form";
import { NexusKnowledgePanel } from "@/components/nexus-knowledge-panel";
import { BlogEngineGateModal } from "@/components/modals/BlogEngineGateModal";
import {
  AuthorPipelineList,
  type PipelineItem,
} from "@/components/author-pipeline-list";
import { db } from "@/core/firebase";

const PAGE_SIZE = 25;

type PageAnchor =
  | { kind: "first" }
  | { kind: "after"; document: QueryDocumentSnapshot<DocumentData> }
  | { kind: "at"; document: QueryDocumentSnapshot<DocumentData> };

export default function NexusEnginePage() {
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [pipelineItems, setPipelineItems] = useState<PipelineItem[]>([]);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [hasContentEngineAccess, setHasContentEngineAccess] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageAnchor, setPageAnchor] = useState<PageAnchor>({ kind: "first" });
  const [lastVisible, setLastVisible] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [isPageTransitioning, setIsPageTransitioning] = useState(false);
  const pageStartCursors = useRef<
    Array<QueryDocumentSnapshot<DocumentData> | null>
  >([null]);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      setCurrentUserEmail(user?.email || null);
      setPipelineItems([]);
      setPageNumber(1);
      setPageAnchor({ kind: "first" });
      setLastVisible(null);
      setIsPageTransitioning(false);
      pageStartCursors.current = [null];
      setLoadingAuth(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | {
              authenticated?: boolean;
              isOwner?: boolean;
              hasContentEngineAccess?: boolean;
            }
          | null;
        if (!response.ok || payload?.authenticated !== true) {
          throw new Error("Your Blog Engine access could not be verified.");
        }
        setHasContentEngineAccess(payload.hasContentEngineAccess === true);
        setIsOwner(payload.isOwner === true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Blog Engine access check failed:", error);
        setHasContentEngineAccess(false);
        setIsOwner(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAccess(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!currentUserEmail || !hasContentEngineAccess) {
      setPipelineItems([]);
      return;
    }

    const constraints: QueryConstraint[] = [
      where("authorEmail", "==", currentUserEmail),
      orderBy("createdAt", "desc"),
    ];

    if (pageAnchor.kind === "after") {
      constraints.push(startAfter(pageAnchor.document));
    } else if (pageAnchor.kind === "at") {
      constraints.push(startAt(pageAnchor.document));
    }

    constraints.push(limit(PAGE_SIZE));

    const pageQuery = query(
      collection(db, "content_blueprints"),
      ...constraints
    );

    const unsubscribe = onSnapshot(
      pageQuery,
      (snapshot) => {
        const items: PipelineItem[] = snapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            title: data.topicTitle || data.title || "Untitled Blog",
            brandAllocation: data.brandAllocation || "personal",
            executionState: normalizeExecutionState(data.executionState),
            createdAt: data.createdAt ?? null,
            liveDraftUrl: data.liveDraftUrl || undefined,
            facebookCopy: data.facebookCopy || undefined,
            instagramCopy: data.instagramCopy || undefined,
            imagePrompt: data.imagePrompt || undefined,
          };
        });

        setPipelineItems(items);
        setLastVisible(snapshot.docs.at(-1) || null);
        pageStartCursors.current[pageNumber - 1] = snapshot.docs[0] || null;
        setIsPageTransitioning(false);
      },
      (error) => {
        console.error("Live Blogs synchronization failed:", error);
        setIsPageTransitioning(false);
      }
    );

    return unsubscribe;
  }, [currentUserEmail, hasContentEngineAccess, pageAnchor, pageNumber]);

  const goToNextPage = () => {
    if (
      isPageTransitioning ||
      pipelineItems.length < PAGE_SIZE ||
      !lastVisible
    ) {
      return;
    }

    setIsPageTransitioning(true);
    setPageNumber((current) => current + 1);
    setPageAnchor({ kind: "after", document: lastVisible });
  };

  const goToPreviousPage = () => {
    if (isPageTransitioning || pageNumber === 1) {
      return;
    }

    const targetPage = pageNumber - 1;
    setIsPageTransitioning(true);

    if (targetPage === 1) {
      pageStartCursors.current = [null];
      setPageNumber(1);
      setPageAnchor({ kind: "first" });
      return;
    }

    const targetCursor = pageStartCursors.current[targetPage - 1];
    if (!targetCursor) {
      setIsPageTransitioning(false);
      return;
    }

    setPageNumber(targetPage);
    setPageAnchor({ kind: "at", document: targetCursor });
  };

  if (loadingAuth || loadingAccess) {
    return (
      <Layout>
        <div className="p-12 text-center text-sm text-muted-foreground animate-pulse">
          Authenticating your studio workspace...
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <BlogEngineGateModal isSubscribed={hasContentEngineAccess}>
      <div className="p-6 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-300">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Nexus SEO Engine
          </h1>
          <p className="text-sm text-muted-foreground">
            Create grounded SEO drafts and follow each one through production.
          </p>
        </div>

        <AuthorIntakeForm />

        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">Knowledge &amp; Strategy</h2>
          <p className="text-xs text-muted-foreground">Manage brand knowledge, Story Worlds, Reference Guides, strategy methods, and verified destinations.</p>
        </div>
        <NexusKnowledgePanel isOwner={isOwner} />

        <div className="space-y-3 pt-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">
              SEO Draft Pipeline
            </h2>
            <p className="text-xs text-muted-foreground">
              Follow current drafts and review completed blog assets.
            </p>
          </div>

          <AuthorPipelineList items={pipelineItems} onRefresh={() => undefined} />

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goToPreviousPage}
              disabled={pageNumber === 1 || isPageTransitioning}
              className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous Page
            </button>
            <span className="text-xs font-semibold text-muted-foreground">
              Page {pageNumber}
            </span>
            <button
              type="button"
              onClick={goToNextPage}
              disabled={
                pipelineItems.length < PAGE_SIZE || isPageTransitioning
              }
              className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next Page
            </button>
          </div>
        </div>
      </div>
      </BlogEngineGateModal>
    </Layout>
  );
}

function normalizeExecutionState(value: unknown): PipelineItem["executionState"] {
  switch (value) {
    case "initializing":
    case "queued":
    case "drafting":
    case "artwork":
    case "staging":
    case "retrying":
    case "completed":
    case "failed":
      return value;
    case "processing":
      return "drafting";
    default:
      return "initializing";
  }
}
