import { NextResponse } from "next/server";

import { NexusAuthorContextError } from "@/core/nexus/author-context";
import { NexusStoryWorldAuthoringError } from "@/core/nexus/story-world-authoring";

export class NexusRouteError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    readonly code?: string,
    message = publicMessage
  ) {
    super(message);
  }
}

export function nexusErrorResponse(error: unknown): NextResponse {
  if (error instanceof NexusRouteError || error instanceof NexusAuthorContextError || error instanceof NexusStoryWorldAuthoringError) {
    return NextResponse.json(
      {
        success: false,
        error: error.publicMessage,
        ...((error instanceof NexusRouteError || error instanceof NexusStoryWorldAuthoringError) && error.code ? { code: error.code } : {}),
      },
      { status: error.status }
    );
  }
  console.error("Nexus SEO Engine request failed:", error);
  return NextResponse.json({ success: false, error: "The Nexus SEO Engine could not complete this request." }, { status: 500 });
}

export function text(value: unknown, maxLength = 500): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}
