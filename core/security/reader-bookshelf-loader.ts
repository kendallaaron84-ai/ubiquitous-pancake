import type { ReaderSessionCookieValue } from "./reader-session-cookie.ts";
import { resolveReaderIdentitySession } from "./reader-auth.ts";
import {
  loadReaderBookshelf,
  type ReaderBookshelfPublication,
} from "./reader-bookshelf.ts";
import type { ReaderPlatformDb } from "./services/service-support.ts";

export interface ReaderBookshelfPageTimings {
  sessionValidationMs: number;
  entitlementQueryMs: number;
  productMetadataJoinMs: number;
  totalServerRenderMs: number;
  productMetadataBatchCount: number;
}

export interface ReaderBookshelfPageData {
  reader: {
    readerUid: string;
    email: string | null;
    displayName: string | null;
  };
  publications: ReaderBookshelfPublication[];
  timings: ReaderBookshelfPageTimings;
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

export async function loadReaderBookshelfPageData(
  db: ReaderPlatformDb,
  cookie: ReaderSessionCookieValue | null
): Promise<ReaderBookshelfPageData> {
  const totalStartedAt = performance.now();
  const sessionStartedAt = performance.now();
  const session = await resolveReaderIdentitySession(db, cookie);
  const sessionValidationMs = elapsed(sessionStartedAt);
  const bookshelf = await loadReaderBookshelf(db, session.readerUid);

  return {
    reader: {
      readerUid: session.readerUid,
      email:
        typeof session.profile.email === "string" ? session.profile.email : null,
      displayName:
        typeof session.profile.displayName === "string"
          ? session.profile.displayName
          : null,
    },
    publications: bookshelf.publications,
    timings: {
      sessionValidationMs,
      entitlementQueryMs: bookshelf.timings.entitlementQueryMs,
      productMetadataJoinMs: bookshelf.timings.productMetadataJoinMs,
      totalServerRenderMs: elapsed(totalStartedAt),
      productMetadataBatchCount: bookshelf.timings.productMetadataBatchCount,
    },
  };
}
