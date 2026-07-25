import { jwtVerify, SignJWT } from "jose";

export const DASHBOARD_SESSION_COOKIE = "session-token";
export const DASHBOARD_SESSION_ISSUER = "koba-dashboard";
export const DASHBOARD_SESSION_AUDIENCE = "koba-dashboard-ui";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export type DashboardAccessScope = "full" | "mvp";

export interface DashboardSessionClaims {
  uid: string;
  email: string;
  studioKey: string | null;
  accessScope: DashboardAccessScope;
}

const LOCAL_DEVELOPMENT_SECRET =
  "koba-local-development-session-secret-do-not-use-in-production";

export function resolveDashboardSessionSecret(
  source: NodeJS.ProcessEnv = process.env
): string {
  const configuredSecret = source.KOBA_DASHBOARD_SESSION_SECRET?.trim();

  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret;
  }

  if (source.NODE_ENV !== "production") {
    return LOCAL_DEVELOPMENT_SECRET;
  }

  throw new Error(
    "KOBA_DASHBOARD_SESSION_SECRET must contain at least 32 characters in production."
  );
}

export function resolveDashboardAccessScope(
  email: string,
  source: NodeJS.ProcessEnv = process.env
): DashboardAccessScope {
  if (source.NODE_ENV !== "production") {
    return "full";
  }

  const ownerEmails = (source.KOBA_OWNER_EMAILS || "")
    .split(",")
    .map((candidate) => candidate.trim().toLowerCase())
    .filter(Boolean);

  return ownerEmails.includes(email.trim().toLowerCase()) ? "full" : "mvp";
}

export async function issueDashboardSession(
  claims: DashboardSessionClaims,
  secret: string,
  now: Date = new Date()
): Promise<string> {
  assertSecret(secret);

  const issuedAt = Math.floor(now.getTime() / 1000);

  return new SignJWT({
    email: claims.email,
    studioKey: claims.studioKey,
    accessScope: claims.accessScope,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.uid)
    .setIssuer(DASHBOARD_SESSION_ISSUER)
    .setAudience(DASHBOARD_SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + DASHBOARD_SESSION_MAX_AGE_SECONDS)
    .sign(encodeSecret(secret));
}

export async function verifyDashboardSession(
  token: string,
  secret: string
): Promise<DashboardSessionClaims> {
  assertSecret(secret);

  const { payload } = await jwtVerify(token, encodeSecret(secret), {
    algorithms: ["HS256"],
    issuer: DASHBOARD_SESSION_ISSUER,
    audience: DASHBOARD_SESSION_AUDIENCE,
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    (payload.studioKey !== null && typeof payload.studioKey !== "string") ||
    (payload.accessScope !== "full" && payload.accessScope !== "mvp")
  ) {
    throw new Error("Dashboard session claims are malformed.");
  }

  return {
    uid: payload.sub,
    email: payload.email,
    studioKey: payload.studioKey,
    accessScope: payload.accessScope,
  };
}

function assertSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error("Dashboard session secret must contain at least 32 characters.");
  }
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}
