import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import {
  adminDb,
  adminStorage,
  resolveFirebaseStorageBucketName,
} from "@/core/firebase-admin";
import {
  DashboardRequestAuthError,
  requireDashboardRequestSession,
} from "@/core/security/dashboard-request-auth";
import {
  PlatformOwnerAuthorizationError,
  requirePlatformOwner,
  requireSameOrigin,
} from "@/core/security/platform-owner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DIRECTIVES_LENGTH = 50_000;
const MAX_PDF_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = requirePlatformOwner(
      await requireDashboardRequestSession(request)
    );
    if (!adminDb || !adminStorage) {
      return failure(503, "ADMIN_CONFIGURATION_UNAVAILABLE", "Administrative configuration is unavailable.");
    }

    const body = await request.formData();
    const directives = clean(body.get("masterDirectives"));
    if (!directives || directives.length > MAX_DIRECTIVES_LENGTH) {
      return failure(400, "SYSTEM_CONFIG_INVALID", "Enter valid system directives.");
    }

    const uploaded = body.get("foundationalConstraints");
    let foundationalConstraintsUri: string | undefined;
    if (uploaded instanceof File && uploaded.size > 0) {
      if (uploaded.type !== "application/pdf" || uploaded.size > MAX_PDF_BYTES) {
        return failure(400, "SYSTEM_CONFIG_PDF_INVALID", "The foundational constraints file must be a PDF no larger than 12 MB.");
      }
      const bucketName = resolveFirebaseStorageBucketName();
      const path = "system_config/foundational_constraints.pdf";
      await adminStorage.bucket(bucketName).file(path).save(
        Buffer.from(await uploaded.arrayBuffer()),
        {
          resumable: false,
          contentType: "application/pdf",
          metadata: { cacheControl: "private, no-store" },
        }
      );
      foundationalConstraintsUri = `gs://${bucketName}/${path}`;
    }

    await adminDb.collection("system_config").doc("seo_core").set({
      masterDirectives: directives,
      ...(foundationalConstraintsUri ? { foundationalConstraintsUri } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.email.toLowerCase(),
    }, { merge: true });

    return NextResponse.json(
      { success: true, fileUpdated: Boolean(foundationalConstraintsUri) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (
      error instanceof DashboardRequestAuthError ||
      error instanceof PlatformOwnerAuthorizationError
    ) {
      return failure(error.status, error.code, error.publicMessage);
    }
    console.error("Administrative system configuration failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return failure(500, "SYSTEM_CONFIG_FAILED", "The system configuration could not be saved.");
  }
}

function clean(value: FormDataEntryValue | null): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()
    : "";
}

function failure(status: number, code: string, error: string) {
  return NextResponse.json(
    { success: false, code, error },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}
