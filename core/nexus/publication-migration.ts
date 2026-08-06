export const DESTINATION_CHANGE_FAILED_MESSAGE =
  "The destination change failed. Your existing publication remains connected to the original website.";

export interface PublicationDeploymentIdentity {
  websiteConnectionId: string;
  targetWpOrigin: string;
}

export interface PublicationDeploymentConfirmation
  extends PublicationDeploymentIdentity {
  publicationId: number;
  pageId: number;
  bookshelfPageId: number;
  publicationUrl: string;
  bookshelfUrl: string;
}

export interface PublicationDeploymentHistoryEntry {
  event: "destination_migration";
  previousWebsiteConnectionId: string;
  previousTargetOrigin: string;
  newWebsiteConnectionId: string;
  newTargetOrigin: string;
  migrationTimestamp: string;
  authenticatedAuthor: string;
  resultingPublicationId: number;
  resultingPageId: number;
  resultingBookshelfPageId: number;
  resultingPublicationUrl: string;
  resultingBookshelfUrl: string;
  originalAssetsDeleted: false;
}

export function isConfirmedDestinationChange(input: {
  hasConfirmedDeployment: boolean;
  previousWebsiteConnectionId: unknown;
  previousTargetOrigin: unknown;
  nextWebsiteConnectionId: string;
  nextTargetOrigin: string;
}): boolean {
  if (!input.hasConfirmedDeployment) return false;
  const previousId = clean(input.previousWebsiteConnectionId);
  const previousOrigin = normalizeOrigin(input.previousTargetOrigin);
  return previousId
    ? previousId !== input.nextWebsiteConnectionId
    : Boolean(previousOrigin && previousOrigin !== normalizeOrigin(input.nextTargetOrigin));
}

export function buildDeploymentHistoryEntry(input: {
  previousWebsiteConnectionId: unknown;
  previousTargetOrigin: unknown;
  next: PublicationDeploymentConfirmation;
  migrationTimestamp: string;
  authenticatedAuthor: string;
}): PublicationDeploymentHistoryEntry {
  return {
    event: "destination_migration",
    previousWebsiteConnectionId: clean(input.previousWebsiteConnectionId),
    previousTargetOrigin: normalizeOrigin(input.previousTargetOrigin),
    newWebsiteConnectionId: input.next.websiteConnectionId,
    newTargetOrigin: normalizeOrigin(input.next.targetWpOrigin),
    migrationTimestamp: input.migrationTimestamp,
    authenticatedAuthor: clean(input.authenticatedAuthor).toLowerCase(),
    resultingPublicationId: input.next.publicationId,
    resultingPageId: input.next.pageId,
    resultingBookshelfPageId: input.next.bookshelfPageId,
    resultingPublicationUrl: input.next.publicationUrl,
    resultingBookshelfUrl: input.next.bookshelfUrl,
    originalAssetsDeleted: false,
  };
}

export function buildAuthoritativeDeploymentFields(
  confirmation: PublicationDeploymentConfirmation,
  deployedAt: unknown
): Record<string, unknown> {
  return {
    websiteConnectionId: confirmation.websiteConnectionId,
    associatedWebsite: normalizeOrigin(confirmation.targetWpOrigin),
    destinationStatus: "bound",
    wordpressDeployment: {
      status: "deployed",
      websiteConnectionId: confirmation.websiteConnectionId,
      targetWpOrigin: normalizeOrigin(confirmation.targetWpOrigin),
      publicationId: confirmation.publicationId,
      pageId: confirmation.pageId,
      bookshelfPageId: confirmation.bookshelfPageId,
      publicationUrl: confirmation.publicationUrl,
      bookshelfUrl: confirmation.bookshelfUrl,
      deployedAt,
    },
  };
}

export function pendingDeploymentAttempt(
  destination: PublicationDeploymentIdentity,
  startedAt: unknown
) {
  return {
    status: "deploying" as const,
    websiteConnectionId: destination.websiteConnectionId,
    targetWpOrigin: normalizeOrigin(destination.targetWpOrigin),
    startedAt,
  };
}

export function failedDeploymentAttempt(input: {
  destination: PublicationDeploymentIdentity;
  failedAt: unknown;
  code: string;
  boundary: string;
}) {
  return {
    status: "failed" as const,
    websiteConnectionId: input.destination.websiteConnectionId,
    targetWpOrigin: normalizeOrigin(input.destination.targetWpOrigin),
    failedAt: input.failedAt,
    code: clean(input.code) || "WORDPRESS_DEPLOYMENT_FAILED",
    boundary: clean(input.boundary) || "unknown",
  };
}

export function buildPendingDeploymentPatch(
  destination: PublicationDeploymentIdentity,
  startedAt: unknown
): Record<string, unknown> {
  return {
    pendingWordpressDeployment: pendingDeploymentAttempt(destination, startedAt),
    updatedAt: startedAt,
  };
}

export function buildFailedDeploymentPatch(input: {
  destination: PublicationDeploymentIdentity;
  failedAt: unknown;
  code: string;
  boundary: string;
}): Record<string, unknown> {
  const attempt = failedDeploymentAttempt(input);
  return {
    pendingWordpressDeployment: attempt,
    lastDeploymentAttempt: attempt,
    updatedAt: input.failedAt,
  };
}

function normalizeOrigin(value: unknown): string {
  const candidate = clean(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
