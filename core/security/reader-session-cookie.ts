export const READER_SESSION_COOKIE = "koba_reader_session" as const;
export const READER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export interface ReaderSessionCookieValue {
  sessionId: string;
  token: string;
}

export function serializeReaderSessionCookie(
  value: ReaderSessionCookieValue
): string {
  if (!SESSION_ID_PATTERN.test(value.sessionId)) {
    throw new Error("READER_SESSION_ID_INVALID");
  }
  if (!SESSION_TOKEN_PATTERN.test(value.token)) {
    throw new Error("READER_SESSION_TOKEN_INVALID");
  }
  return `${value.sessionId}.${value.token}`;
}

export function parseReaderSessionCookie(
  value: string | null | undefined
): ReaderSessionCookieValue | null {
  const normalized = value?.trim() ?? "";
  const separator = normalized.indexOf(".");
  if (separator <= 0 || normalized.indexOf(".", separator + 1) !== -1) {
    return null;
  }

  const sessionId = normalized.slice(0, separator);
  const token = normalized.slice(separator + 1);
  if (
    !SESSION_ID_PATTERN.test(sessionId) ||
    !SESSION_TOKEN_PATTERN.test(token)
  ) {
    return null;
  }
  return { sessionId, token };
}

export function readReaderSessionCookie(
  cookieHeader: string | null
): ReaderSessionCookieValue | null {
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = segment.trim().split("=");
    if (rawName === READER_SESSION_COOKIE) {
      try {
        return parseReaderSessionCookie(
          decodeURIComponent(rawValue.join("="))
        );
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function readerSessionCookieOptions(expires?: Date) {
  return {
    path: "/",
    maxAge: READER_SESSION_MAX_AGE_SECONDS,
    expires,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  };
}

export function expiredReaderSessionCookieOptions() {
  return {
    path: "/",
    maxAge: 0,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  };
}
