export interface VerifiedBlogConnection {
  studioKey: string;
  targetWpOrigin: string;
  secretCredentialRef: string;
}

const SECRET_VERSION_PATTERN =
  /^projects\/(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{6,20})\/secrets\/[A-Za-z0-9_-]{1,255}\/versions\/(?:latest|[1-9][0-9]*)$/;

export class BlogConnectionError extends Error {}

export function resolveVerifiedBlogConnection(
  value: Record<string, unknown>,
  expectedStudioKey: string
): VerifiedBlogConnection {
  const studioKey = trimString(value.studioKey);
  if (!studioKey || studioKey !== expectedStudioKey) {
    throw new BlogConnectionError("The WordPress connection belongs to another studio.");
  }

  if (trimString(value.status).toLowerCase() !== "active") {
    throw new BlogConnectionError("The WordPress connection is not active.");
  }

  const isVerified =
    value.verified === true ||
    trimString(value.verificationStatus).toLowerCase() === "verified";
  if (!isVerified) {
    throw new BlogConnectionError("The WordPress connection has not been verified.");
  }

  const targetWpOrigin = normalizeHttpsOrigin(value.targetWpOrigin);
  const secretCredentialRef = trimString(value.secretCredentialRef);
  if (!SECRET_VERSION_PATTERN.test(secretCredentialRef)) {
    throw new BlogConnectionError("The WordPress credential reference is invalid.");
  }

  return { studioKey, targetWpOrigin, secretCredentialRef };
}

export function normalizeHttpsOrigin(value: unknown): string {
  const raw = trimString(value);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BlogConnectionError("The WordPress destination is invalid.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new BlogConnectionError(
      "The WordPress destination must be an HTTPS site origin."
    );
  }

  return parsed.origin;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
