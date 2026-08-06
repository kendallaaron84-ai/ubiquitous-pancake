import type { DecodedIdToken } from "firebase-admin/auth";

import type { ReaderPlatformDb } from "./services/service-support.ts";
import {
  requireActiveVerifiedReader,
  upsertReaderProfile,
} from "./services/reader-profile-service.ts";
import {
  createReaderSession,
  validateReaderSession,
} from "./services/reader-session-service.ts";
import type { ReaderSessionCookieValue } from "./reader-session-cookie.ts";

export const READER_AUTH_ERROR_CODES = {
  emailRequired: "READER_EMAIL_REQUIRED",
  emailVerificationRequired: "READER_EMAIL_VERIFICATION_REQUIRED",
  passwordProviderRequired: "READER_PASSWORD_PROVIDER_REQUIRED",
  accountNotActive: "READER_ACCOUNT_NOT_ACTIVE",
  sessionInvalid: "READER_SESSION_INVALID",
} as const;

export class ReaderAuthError extends Error {
  readonly status: 400 | 401 | 403;
  readonly code: (typeof READER_AUTH_ERROR_CODES)[keyof typeof READER_AUTH_ERROR_CODES];

  constructor(
    status: 400 | 401 | 403,
    code: (typeof READER_AUTH_ERROR_CODES)[keyof typeof READER_AUTH_ERROR_CODES],
    message: string
  ) {
    super(message);
    this.name = "ReaderAuthError";
    this.status = status;
    this.code = code;
  }
}

function normalizedEmail(claims: DecodedIdToken): string {
  return typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
}

function passwordProviderWasUsed(claims: DecodedIdToken): boolean {
  return claims.firebase?.sign_in_provider === "password";
}

function mapProfileError(error: unknown): never {
  if (error instanceof ReaderAuthError) throw error;
  const code = error instanceof Error ? error.message : "";
  if (code === "READER_EMAIL_NOT_VERIFIED") {
    throw new ReaderAuthError(
      403,
      READER_AUTH_ERROR_CODES.emailVerificationRequired,
      "Verify your email address before opening a reader session."
    );
  }
  if (
    code === "READER_ACCOUNT_NOT_ACTIVE" ||
    code === "READER_ACCOUNT_DELETED"
  ) {
    throw new ReaderAuthError(
      403,
      READER_AUTH_ERROR_CODES.accountNotActive,
      "This reader account is not active."
    );
  }
  throw error;
}

export async function establishReaderIdentity(
  db: ReaderPlatformDb,
  claims: DecodedIdToken,
  correlationId: string
): Promise<{
  readerUid: string;
  email: string;
  displayName: string | null;
  sessionId: string;
  token: string;
  expiresAt: Date;
}> {
  const readerUid = claims.uid?.trim();
  const email = normalizedEmail(claims);
  if (!readerUid || !email) {
    throw new ReaderAuthError(
      400,
      READER_AUTH_ERROR_CODES.emailRequired,
      "The verified Firebase identity must contain an email address."
    );
  }
  if (claims.email_verified !== true) {
    throw new ReaderAuthError(
      403,
      READER_AUTH_ERROR_CODES.emailVerificationRequired,
      "Verify your email address before opening a reader session."
    );
  }
  if (!passwordProviderWasUsed(claims)) {
    throw new ReaderAuthError(
      403,
      READER_AUTH_ERROR_CODES.passwordProviderRequired,
      "Reader access requires Firebase email and password authentication."
    );
  }

  const displayName =
    typeof claims.name === "string" && claims.name.trim()
      ? claims.name.trim()
      : null;

  try {
    await upsertReaderProfile(db, {
      uid: readerUid,
      email,
      emailVerified: true,
      displayName,
      authProvider: "password",
      correlationId,
    });
    await requireActiveVerifiedReader(db, readerUid);
  } catch (error: unknown) {
    mapProfileError(error);
  }

  const session = await createReaderSession(db, {
    readerUid,
    scope: "central",
    correlationId,
  });
  return { readerUid, email, displayName, ...session };
}

export async function resolveReaderIdentitySession(
  db: ReaderPlatformDb,
  cookie: ReaderSessionCookieValue | null,
  now = new Date()
): Promise<{
  readerUid: string;
  profile: Record<string, unknown>;
}> {
  if (!cookie) {
    throw new ReaderAuthError(
      401,
      READER_AUTH_ERROR_CODES.sessionInvalid,
      "A valid reader session is required."
    );
  }
  const result = await validateReaderSession(
    db,
    cookie.sessionId,
    cookie.token,
    now
  );
  if (!result.valid || !result.readerUid) {
    throw new ReaderAuthError(
      401,
      READER_AUTH_ERROR_CODES.sessionInvalid,
      "The reader session is invalid or expired."
    );
  }
  try {
    const profile = await requireActiveVerifiedReader(db, result.readerUid);
    return { readerUid: result.readerUid, profile };
  } catch (error: unknown) {
    mapProfileError(error);
  }
}
