import { FirebaseAdminConfigurationError, getFirebaseAdminServices } from "@/core/firebase-admin";
import { createReaderMediaHandoffHandler } from "@/core/security/reader-media-handoff";
import { createPaidReaderLaunchHandler } from "@/core/security/reader-paid-launch";
import { signReaderToken } from "@/core/security/reader-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const handoff = createReaderMediaHandoffHandler({
      db: getFirebaseAdminServices().db,
      issueToken: signReaderToken,
    });
    return createPaidReaderLaunchHandler(handoff)(request);
  } catch (error: unknown) {
    const configured = error instanceof FirebaseAdminConfigurationError;
    return Response.json(
      {
        success: false,
        code: configured
          ? "FIREBASE_ADMIN_NOT_CONFIGURED"
          : "READER_PAID_LAUNCH_UNAVAILABLE",
        error: configured
          ? "Reader access is not configured on this server."
          : "The paid publication launcher is unavailable.",
      },
      { status: configured ? 500 : 503 }
    );
  }
}
