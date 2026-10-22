import type { ReaderTokenClaims } from "@/core/security/reader-token";

export type CanonicalReaderMediaClaims = ReaderTokenClaims & {
  principalType: "firebase_uid" | "anonymous_free";
};

export class UnsupportedReaderMediaPrincipalError extends Error {
  readonly status = 401;
  readonly code = "READER_MEDIA_PRINCIPAL_UNSUPPORTED";

  constructor() {
    super("This reader authorization method is no longer supported.");
    this.name = "UnsupportedReaderMediaPrincipalError";
  }
}

export function requireCanonicalReaderMediaPrincipal(
  claims: ReaderTokenClaims
): asserts claims is CanonicalReaderMediaClaims {
  if (
    claims.principalType !== "firebase_uid" &&
    claims.principalType !== "anonymous_free"
  ) {
    throw new UnsupportedReaderMediaPrincipalError();
  }
}
