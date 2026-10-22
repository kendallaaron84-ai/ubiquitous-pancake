export class NexusStoryWorldAuthoringError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly code?: string;

  constructor(status: number, publicMessage: string, code?: string) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = code;
  }
}

export interface StoryWorldOwner {
  studioKey: string;
  authorId: string;
}

export function assertOwnedStoryWorld(
  exists: boolean,
  data: Record<string, unknown>,
  owner: StoryWorldOwner,
  options: { requireActive?: boolean } = {}
): void {
  if (
    !exists ||
    data.studioKey !== owner.studioKey ||
    data.authorId !== owner.authorId ||
    (options.requireActive === true && data.status !== "active")
  ) {
    throw new NexusStoryWorldAuthoringError(404, "The selected Story World was not found.", "NEXUS_STORY_WORLD_NOT_FOUND");
  }
}

export function assertCanonicalReferenceGuide(
  worldData: Record<string, unknown>,
  guideExists: boolean,
  guideData: Record<string, unknown>,
  input: StoryWorldOwner & { universeId: string; referenceGuideId: string }
): void {
  if (
    worldData.defaultReferenceGuideId !== input.referenceGuideId ||
    !guideExists ||
    guideData.studioKey !== input.studioKey ||
    guideData.authorId !== input.authorId ||
    guideData.universeId !== input.universeId ||
    guideData.status !== "ready"
  ) {
    throw new NexusStoryWorldAuthoringError(
      409,
      "Select the active Canonical Guide for this Story World before creating a draft.",
      "NEXUS_CANONICAL_REFERENCE_GUIDE_REQUIRED"
    );
  }
}

export function buildStoryWorldAuthorPatch(body: Record<string, unknown> | null): {
  title: string;
  genre: string;
  description: string;
  status: "active" | "archived";
} {
  const title = cleanText(body?.title, 200);
  const genre = cleanText(body?.genre, 120);
  const description = cleanText(body?.description, 3_000);
  const status = body?.status === "archived" ? "archived" : body?.status === "active" ? "active" : null;
  if (!title || !genre || !description || !status) {
    throw new NexusStoryWorldAuthoringError(400, "Title, genre, description, and a valid Story World status are required.");
  }
  return { title, genre, description, status };
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}
