import type { DashboardSessionClaims } from "@/core/security/dashboard-session";

export class PlatformOwnerAuthorizationError extends Error {
  readonly status: 401 | 403;
  readonly code: string;
  readonly publicMessage: string;

  constructor(
    status: 401 | 403,
    code: string,
    publicMessage: string
  ) {
    super(publicMessage);
    this.name = "PlatformOwnerAuthorizationError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function requirePlatformOwner(
  session: DashboardSessionClaims,
  configuredOwnerEmails = process.env.KOBA_OWNER_EMAILS || ""
): DashboardSessionClaims {
  const owners = new Set(
    configuredOwnerEmails
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  if (
    session.accessScope !== "full" ||
    !owners.has(session.email.trim().toLowerCase())
  ) {
    throw new PlatformOwnerAuthorizationError(
      403,
      "PLATFORM_OWNER_REQUIRED",
      "Platform-owner access is required."
    );
  }
  return session;
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin")?.trim();
  if (!origin || origin !== new URL(request.url).origin) {
    throw new PlatformOwnerAuthorizationError(
      403,
      "TRUSTED_ORIGIN_REQUIRED",
      "A trusted dashboard origin is required."
    );
  }
}
