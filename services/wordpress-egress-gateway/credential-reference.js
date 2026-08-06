const PRIMARY_WEBSITE_CONNECTION_ID = "primary";
const WEBSITE_CONNECTION_ID_PATTERN = /^site_[a-f0-9]{16}$/;

export class CredentialReferenceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "CredentialReferenceError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeGatewayStudioKey(value) {
  const studioKey = clean(value).toUpperCase();
  if (
    !/^(?:KOBA-(?:AUDIO|OWNER)|JUBI-TEST)-[A-Z0-9-]{4,64}$/.test(
      studioKey
    )
  ) {
    throw new CredentialReferenceError(
      "INVALID_STUDIO_KEY",
      "A valid StudioKey is required."
    );
  }
  return studioKey;
}

export function normalizeWebsiteConnectionId(value, options = {}) {
  const candidate = clean(value);
  if (!candidate && options.allowPrimaryDefault === true) {
    return PRIMARY_WEBSITE_CONNECTION_ID;
  }
  if (
    candidate !== PRIMARY_WEBSITE_CONNECTION_ID &&
    !WEBSITE_CONNECTION_ID_PATTERN.test(candidate)
  ) {
    throw new CredentialReferenceError(
      "INVALID_WEBSITE_CONNECTION_ID",
      "A valid website connection is required."
    );
  }
  return candidate;
}

export function credentialSecretId(studioKey, websiteConnectionId) {
  const normalizedStudioKey = normalizeGatewayStudioKey(studioKey);
  const normalizedConnectionId = normalizeWebsiteConnectionId(
    websiteConnectionId,
    { allowPrimaryDefault: true }
  );
  return `WP_CREDS_${normalizedStudioKey}${
    normalizedConnectionId === PRIMARY_WEBSITE_CONNECTION_ID
      ? ""
      : `-${normalizedConnectionId}`
  }`;
}

export function credentialSecretReference(
  projectNumber,
  studioKey,
  websiteConnectionId
) {
  const numericProjectNumber = clean(projectNumber);
  if (!/^[0-9]+$/.test(numericProjectNumber)) {
    throw new CredentialReferenceError(
      "SERVICE_CONFIGURATION_ERROR",
      "The credential project number is not configured.",
      503
    );
  }
  return `projects/${numericProjectNumber}/secrets/${credentialSecretId(
    studioKey,
    websiteConnectionId
  )}/versions/latest`;
}

export function assertCredentialReference({
  projectNumber,
  studioKey,
  websiteConnectionId,
  secretCredentialRef,
}) {
  const expected = credentialSecretReference(
    projectNumber,
    studioKey,
    websiteConnectionId
  );
  if (clean(secretCredentialRef) !== expected) {
    throw new CredentialReferenceError(
      "TENANT_CONNECTION_MISMATCH",
      "The protected credential reference does not match this website connection.",
      403
    );
  }
  return expected;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
