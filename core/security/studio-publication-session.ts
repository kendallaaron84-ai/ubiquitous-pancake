import { cookies } from "next/headers";

import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
  type DashboardSessionClaims,
} from "@/core/security/dashboard-session";
import {
  StudioPublicationAccessError,
  assertActiveStudioLicense,
  type StudioAuthorContext,
} from "@/core/security/studio-publication-access";

export async function requireStudioAuthorContext(
  database: FirebaseFirestore.Firestore
): Promise<StudioAuthorContext> {
  const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
  if (!token) {
    throw new StudioPublicationAccessError(
      401,
      "STUDIO_AUTHENTICATION_REQUIRED",
      "Authentication is required."
    );
  }

  let session: DashboardSessionClaims;
  try {
    session = await verifyDashboardSession(token, resolveDashboardSessionSecret());
  } catch {
    throw new StudioPublicationAccessError(
      401,
      "STUDIO_SESSION_INVALID",
      "Your dashboard session is invalid or expired."
    );
  }

  const studioKey = session.studioKey?.trim() || "";
  if (!studioKey) {
    throw new StudioPublicationAccessError(
      403,
      "STUDIO_WORKSPACE_REQUIRED",
      "Your dashboard session is not connected to an author workspace."
    );
  }

  const snapshot = await database.collection("plugin_licenses").doc(studioKey).get();
  return assertActiveStudioLicense(
    session,
    snapshot.id,
    snapshot.exists ? snapshot.data() : null
  );
}
