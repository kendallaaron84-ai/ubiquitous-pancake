import type { NexusWebsiteConnection } from "./contracts";

export const PUBLICATION_DESTINATION_CODES = {
  required: "PUBLICATION_DESTINATION_REQUIRED",
  forbidden: "PUBLICATION_DESTINATION_FORBIDDEN",
  unavailable: "PUBLICATION_DESTINATION_UNAVAILABLE",
  ambiguous: "PUBLICATION_DESTINATION_AMBIGUOUS",
  confirmationRequired: "PUBLICATION_DESTINATION_CHANGE_CONFIRMATION_REQUIRED",
} as const;

export interface PublicationDestinationEvidence {
  websiteConnectionId?: unknown;
  associatedWebsite?: unknown;
  wordpressDeployment?: unknown;
  hasConfirmedDeployment?: boolean;
}

export interface ResolvedPublicationDestination {
  websiteConnectionId: string;
  targetWpOrigin: string;
  wpUsername: string;
  secretCredentialRef: string;
  contentRole: NexusWebsiteConnection["contentRole"];
  displayName: string;
}

export interface ResolvePublicationDestinationInput {
  studioKey: string;
  authorId: string;
  connections: NexusWebsiteConnection[];
  requestedWebsiteConnectionId?: unknown;
  existingProduct?: PublicationDestinationEvidence | null;
  storyWorldDefaultWebsiteConnectionId?: unknown;
  confirmDestinationChange?: boolean;
}

export class PublicationDestinationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;
  readonly destinationStatus?: "needs_review";

  constructor(
    status: number,
    code: string,
    publicMessage: string,
    destinationStatus?: "needs_review"
  ) {
    super(publicMessage);
    this.name = "PublicationDestinationError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.destinationStatus = destinationStatus;
  }
}

export function resolvePublicationDestination(
  input: ResolvePublicationDestinationInput
): ResolvedPublicationDestination {
  const requestedId = clean(input.requestedWebsiteConnectionId);
  const existing = input.existingProduct || {};
  const existingId = clean(existing.websiteConnectionId);
  const historicalOrigin = productHistoricalOrigin(existing);
  const deployable = input.connections.filter((connection) =>
    isDeployablePublicationConnection(connection, input.studioKey, input.authorId)
  );

  if (requestedId) {
    const selected = requireRequestedConnection(input.connections, requestedId, input);
    const historical = existingId
      ? input.connections.find((connection) => connection.websiteConnectionId === existingId)
      : findByOrigin(input.connections, historicalOrigin);
    if (
      existing.hasConfirmedDeployment === true &&
      (!historical || historical.websiteConnectionId !== selected.websiteConnectionId) &&
      input.confirmDestinationChange !== true
    ) {
      throw new PublicationDestinationError(
        409,
        PUBLICATION_DESTINATION_CODES.confirmationRequired,
        "Confirm that KOBA-I may create new WordPress assets on the newly selected website. Existing assets on the previous website will not be removed."
      );
    }
    return toResolvedDestination(selected, input.studioKey);
  }

  if (existingId) {
    const selected = input.connections.find(
      (connection) => connection.websiteConnectionId === existingId
    );
    if (!selected) {
      throw unavailable("The product's saved publishing destination is no longer available.");
    }
    assertOwned(selected, input.studioKey, input.authorId);
    assertDeployable(selected);
    return toResolvedDestination(selected, input.studioKey);
  }

  if (historicalOrigin) {
    const historicalMatches = deployable.filter(
      (connection) => normalizeOrigin(connection.wordpressOrigin) === historicalOrigin
    );
    if (historicalMatches.length === 1) {
      return toResolvedDestination(historicalMatches[0], input.studioKey);
    }
    if (existing.hasConfirmedDeployment === true || historicalMatches.length > 1) {
      throw new PublicationDestinationError(
        409,
        PUBLICATION_DESTINATION_CODES.ambiguous,
        "Choose the verified website that owns this product's existing WordPress assets before syncing again.",
        "needs_review"
      );
    }
  }

  const storyWorldDefaultId = clean(input.storyWorldDefaultWebsiteConnectionId);
  if (storyWorldDefaultId) {
    const storyWorldDefault = deployable.find(
      (connection) =>
        connection.websiteConnectionId === storyWorldDefaultId &&
        (connection.contentRole === "story_world" || connection.contentRole === "both")
    );
    if (storyWorldDefault) {
      return toResolvedDestination(storyWorldDefault, input.studioKey);
    }
  }

  if (deployable.length === 1) {
    return toResolvedDestination(deployable[0], input.studioKey);
  }
  if (deployable.length > 1) {
    throw new PublicationDestinationError(
      400,
      PUBLICATION_DESTINATION_CODES.required,
      "Choose where KOBA-I should create this book's WordPress page and bookstore assets."
    );
  }
  throw unavailable("Connect and verify a WordPress website before deploying this publication.");
}

export function isDeployablePublicationConnection(
  connection: NexusWebsiteConnection,
  studioKey: string,
  authorId: string
): boolean {
  try {
    assertOwned(connection, studioKey, authorId);
    assertDeployable(connection);
    return true;
  } catch {
    return false;
  }
}

export function productHistoricalOrigin(
  product: PublicationDestinationEvidence
): string {
  const deployment = record(product.wordpressDeployment);
  return normalizeOrigin(deployment.targetWpOrigin || product.associatedWebsite);
}

export function assertCredentialReferenceForConnection(
  studioKey: string,
  websiteConnectionId: string,
  secretCredentialRef: string
): string {
  const expectedCredentialScope = websiteConnectionId === "primary"
    ? studioKey
    : `${studioKey}-${websiteConnectionId}`;
  const match = clean(secretCredentialRef).match(
    /^projects\/[0-9]+\/secrets\/WP_CREDS_([A-Za-z0-9_-]+)\/versions\/latest$/
  );
  if (!match || match[1] !== expectedCredentialScope) {
    throw unavailable("The selected website's protected credentials are incomplete. Reconnect that website and retry.");
  }
  return clean(secretCredentialRef);
}

export function assertConfirmedPublicationOrigin(
  expectedOrigin: string,
  confirmedOrigin: unknown
): string {
  const expected = normalizeOrigin(expectedOrigin);
  const confirmed = normalizeOrigin(confirmedOrigin);
  if (!expected || confirmed !== expected) {
    throw new PublicationDestinationError(
      502,
      "WORDPRESS_DEPLOYMENT_FAILED",
      "The secure WordPress service did not confirm the selected publishing destination."
    );
  }
  return confirmed;
}

function requireRequestedConnection(
  connections: NexusWebsiteConnection[],
  requestedId: string,
  input: Pick<ResolvePublicationDestinationInput, "studioKey" | "authorId">
): NexusWebsiteConnection {
  const selected = connections.find(
    (connection) => connection.websiteConnectionId === requestedId
  );
  if (!selected) {
    throw new PublicationDestinationError(
      403,
      PUBLICATION_DESTINATION_CODES.forbidden,
      "The selected website does not belong to this author workspace."
    );
  }
  assertOwned(selected, input.studioKey, input.authorId);
  assertDeployable(selected);
  return selected;
}

function assertOwned(
  connection: NexusWebsiteConnection,
  studioKey: string,
  authorId: string
): void {
  if (connection.studioKey !== studioKey || connection.authorId !== authorId) {
    throw new PublicationDestinationError(
      403,
      PUBLICATION_DESTINATION_CODES.forbidden,
      "The selected website does not belong to this author workspace."
    );
  }
}

function assertDeployable(connection: NexusWebsiteConnection): void {
  if (connection.status !== "active") {
    throw unavailable("The selected publishing destination is disabled or unverified.");
  }
  if (
    !normalizeOrigin(connection.wordpressOrigin) ||
    !clean(connection.wordpressUsername) ||
    !clean(connection.secretCredentialRef)
  ) {
    throw unavailable("The selected publishing destination is incomplete. Reconnect it and retry.");
  }
}

function toResolvedDestination(
  connection: NexusWebsiteConnection,
  studioKey: string
): ResolvedPublicationDestination {
  return {
    websiteConnectionId: connection.websiteConnectionId,
    targetWpOrigin: normalizeOrigin(connection.wordpressOrigin),
    wpUsername: clean(connection.wordpressUsername),
    secretCredentialRef: assertCredentialReferenceForConnection(
      studioKey,
      connection.websiteConnectionId,
      connection.secretCredentialRef
    ),
    contentRole: connection.contentRole,
    displayName: connection.displayName,
  };
}

function findByOrigin(
  connections: NexusWebsiteConnection[],
  origin: string
): NexusWebsiteConnection | undefined {
  if (!origin) return undefined;
  return connections.find(
    (connection) => normalizeOrigin(connection.wordpressOrigin) === origin
  );
}

function unavailable(message: string): PublicationDestinationError {
  return new PublicationDestinationError(
    409,
    PUBLICATION_DESTINATION_CODES.unavailable,
    message
  );
}

function normalizeOrigin(value: unknown): string {
  const candidate = clean(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
