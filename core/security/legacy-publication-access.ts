export class LegacyPublicationAccessError extends Error {
  readonly status = 403;
  readonly code = "LEGACY_PUBLICATION_OWNER_MISMATCH";
  readonly publicMessage = "This publication must be assigned to a registered author name.";

  constructor() {
    super("Legacy publication ownership could not be verified against the active tenant license.");
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Legacy publications predate authorIdentityId. They remain readable only
 * when the immutable tenant binding and the stored publication owner agree
 * with the active license. This is a compatibility check, not an identity
 * bypass, and it does not mutate the publication record.
 */
export function resolveLegacyPublicationAuthorName(input: {
  publicationAuthorEmail: unknown;
  publicationAuthorName: unknown;
  activeLicenseExists: boolean;
  license: Record<string, unknown>;
}): string {
  const publicationAuthorEmail = clean(input.publicationAuthorEmail).toLowerCase();
  const publicationAuthorName = clean(input.publicationAuthorName);

  if (!input.activeLicenseExists) {
    return publicationAuthorName || "Sovereign Author";
  }

  const licenseStatus = clean(input.license.status).toLowerCase();
  const licenseAuthorEmail = clean(
    input.license.authorEmail ||
      input.license.userEmail ||
      input.license.email ||
      input.license.authorId
  ).toLowerCase();
  if (
    licenseStatus !== "active" ||
    !publicationAuthorEmail ||
    !licenseAuthorEmail ||
    publicationAuthorEmail !== licenseAuthorEmail
  ) {
    throw new LegacyPublicationAccessError();
  }

  return publicationAuthorName || clean(input.license.authorName) || "Sovereign Author";
}
