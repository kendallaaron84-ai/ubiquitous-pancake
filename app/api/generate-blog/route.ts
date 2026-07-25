import { randomUUID } from "node:crypto";

import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { dispatchBlogGenerationTask } from "@/core/cloud-tasks";
import { adminDb } from "@/core/firebase-admin";
import {
  AuthorIdentityError,
  ensurePrimaryAuthorIdentity,
} from "@/core/security/author-identity";
import {
  BlogConnectionError,
  resolveVerifiedBlogConnection,
  type VerifiedBlogConnection,
} from "@/core/security/blog-connection";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import { loadContentEngineAccess } from "@/core/security/content-engine-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const BLUEPRINT_ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;

interface GenerateBlogRequest {
  blueprintId?: unknown;
}

interface LockedBlueprint {
  attemptId: string;
  blueprintId: string;
  connection: VerifiedBlogConnection;
}

class RouteError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    message = publicMessage
  ) {
    super(message);
  }
}

export async function POST(request: Request) {
  let lockedBlueprint: LockedBlueprint | null = null;

  try {
    if (!adminDb) {
      throw new RouteError(503, "The blog service is temporarily unavailable.");
    }

    const sessionToken = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    if (!sessionToken) {
      throw new RouteError(401, "Authentication is required.");
    }

    let dashboardSession;
    try {
      dashboardSession = await verifyDashboardSession(
        sessionToken,
        resolveDashboardSessionSecret()
      );
    } catch {
      throw new RouteError(401, "Your dashboard session is invalid or expired.");
    }

    const access = await loadContentEngineAccess(adminDb, dashboardSession);
    if (!access.hasContentEngineAccess) {
      throw new RouteError(
        403,
        "An active Blog Engine plan is required before creating a draft."
      );
    }

    const body = (await request.json().catch(() => null)) as
      | GenerateBlogRequest
      | null;
    const blueprintId = trimString(body?.blueprintId);
    if (!BLUEPRINT_ID_PATTERN.test(blueprintId)) {
      throw new RouteError(400, "A valid blueprintId is required.");
    }

    const blueprintReference = adminDb
      .collection("content_blueprints")
      .doc(blueprintId) as DocumentReference<DocumentData>;
    const sessionStudioKey = trimString(dashboardSession.studioKey);
    if (!sessionStudioKey) {
      throw new RouteError(
        403,
        "Your author workspace is not connected to a verified studio."
      );
    }
    let authorIdentity;
    try {
      authorIdentity = await ensurePrimaryAuthorIdentity(
        adminDb,
        sessionStudioKey,
        dashboardSession.email
      );
    } catch (error) {
      if (error instanceof AuthorIdentityError) {
        throw new RouteError(error.status, error.publicMessage);
      }
      throw error;
    }
    const connectionReference = adminDb
      .collection("connections")
      .doc(sessionStudioKey) as DocumentReference<DocumentData>;
    const attemptId = randomUUID();

    const locked = await adminDb.runTransaction(
      async (transaction: Transaction) => {
        const snapshot = await transaction.get(blueprintReference);
        const connectionSnapshot = await transaction.get(connectionReference);
        if (!snapshot.exists) {
          throw new RouteError(404, "The requested blog record was not found.");
        }

        if (!connectionSnapshot.exists) {
          throw new RouteError(
            400,
            "Connect and verify your WordPress site before creating a blog draft."
          );
        }

        let connection: VerifiedBlogConnection;
        try {
          connection = resolveVerifiedBlogConnection(
            connectionSnapshot.data() || {},
            sessionStudioKey
          );
        } catch (error: unknown) {
          if (error instanceof BlogConnectionError) {
            throw new RouteError(
              403,
              "Your WordPress connection is not active and verified.",
              error.message
            );
          }
          throw error;
        }

        const data = snapshot.data() || {};
        const storedEmail = trimString(data.authorEmail).toLowerCase();
        const sessionEmail = dashboardSession.email.trim().toLowerCase();
        if (!storedEmail || storedEmail !== sessionEmail) {
          throw new RouteError(
            403,
            "This blog record belongs to another workspace."
          );
        }

        const currentState = trimString(data.executionState);
        if (currentState !== "initializing" && currentState !== "failed") {
          throw new RouteError(
            409,
            "This blog is already queued or cannot be retried."
          );
        }

        const destinationChanged =
          trimString(data.studioKey) !== connection.studioKey ||
          trimString(data.targetWpOrigin) !== connection.targetWpOrigin ||
          trimString(data.secretCredentialRef) !== connection.secretCredentialRef;
        const destinationReset = destinationChanged
          ? {
              wordpressPostId: FieldValue.delete(),
              liveDraftUrl: FieldValue.delete(),
              wordpressDraftStagedAt: FieldValue.delete(),
              featuredMediaId: FieldValue.delete(),
              featuredMediaUrl: FieldValue.delete(),
              featuredMediaUploadedAt: FieldValue.delete(),
              featuredMediaSkipped: FieldValue.delete(),
              featuredMediaSkippedAt: FieldValue.delete(),
              artworkWarning: FieldValue.delete(),
            }
          : {};

        transaction.update(blueprintReference, {
          ...destinationReset,
          executionState: "queued",
          generationAttemptId: attemptId,
          authorIdentityId: authorIdentity.id,
          authorName: authorIdentity.displayName,
          studioKey: connection.studioKey,
          targetWpOrigin: connection.targetWpOrigin,
          secretCredentialRef: connection.secretCredentialRef,
          connectionBoundAt: FieldValue.serverTimestamp(),
          targetSitePrefix: FieldValue.delete(),
          wordpressUrl: FieldValue.delete(),
          queueRequestedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          errorLog: FieldValue.delete(),
          lastWorkerError: FieldValue.delete(),
        });

        return { attemptId, blueprintId, connection };
      }
    );
    lockedBlueprint = locked;

    const dispatchResult = await dispatchBlogGenerationTask({
      blueprintId,
      generationAttemptId: attemptId,
      studioKey: locked.connection.studioKey,
      targetWpOrigin: locked.connection.targetWpOrigin,
      secretCredentialRef: locked.connection.secretCredentialRef,
    });

    await adminDb.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(blueprintReference);
      if (!snapshot.exists) return;
      const data = snapshot.data() || {};
      if (
        data.generationAttemptId !== attemptId ||
        trimString(data.executionState) !== "queued"
      ) {
        return;
      }
      transaction.update(blueprintReference, {
        cloudTaskName: dispatchResult.taskName,
        queuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json(
      {
        status: "accepted",
        blueprintId,
        message: "The blog draft was accepted into the generation queue.",
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    if (lockedBlueprint) {
      await markAttemptFailed(lockedBlueprint, error);
    }

    if (error instanceof RouteError) {
      return NextResponse.json(
        { status: "error", error: error.publicMessage },
        { status: error.status }
      );
    }

    console.error("Cloud Tasks blog dispatch failed:", error);
    return NextResponse.json(
      {
        status: "error",
        error: "The draft could not be placed in the generation queue.",
      },
      { status: 503 }
    );
  }
}

async function markAttemptFailed(
  blueprint: LockedBlueprint,
  error: unknown
): Promise<void> {
  try {
    const reference = adminDb
      .collection("content_blueprints")
      .doc(blueprint.blueprintId) as DocumentReference<DocumentData>;

    await adminDb.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return;
      const data = snapshot.data() || {};
      if (
        data.generationAttemptId !== blueprint.attemptId ||
        trimString(data.executionState) !== "queued"
      ) {
        return;
      }

      transaction.update(reference, {
        executionState: "failed",
        errorLog: internalErrorMessage(error).slice(0, 500),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (updateError: unknown) {
    console.error("Failed to record the queue dispatch error:", updateError);
  }
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function internalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue dispatch failure.";
}
