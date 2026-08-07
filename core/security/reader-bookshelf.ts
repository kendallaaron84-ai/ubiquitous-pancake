import type { ReaderPlatformDb } from "./services/service-support.ts";
import { listActiveReaderEntitlements } from "./services/entitlement-service.ts";

export interface ReaderBookshelfPublication {
  assetId: string;
  title: string;
  description: string;
  authorName: string;
  publicationType: "audiobook" | "ebook" | "publication";
  category: string;
  coverUrl: string | null;
  publicationUrl: string | null;
}

export interface ReaderBookshelfLoadTimings {
  entitlementQueryMs: number;
  productMetadataJoinMs: number;
  totalBookshelfLoadMs: number;
  productMetadataBatchCount: number;
}

export interface ReaderBookshelfLoadResult {
  publications: ReaderBookshelfPublication[];
  timings: ReaderBookshelfLoadTimings;
}

function text(value: unknown, maximum = 500): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeImageUrl(value: unknown): string | null {
  const candidate = text(value, 2_000);
  if (!candidate) return null;
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safePublicationUrl(value: unknown): string | null {
  const candidate = text(value, 2_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function publicationType(value: unknown, assetId: string): ReaderBookshelfPublication["publicationType"] {
  const candidate = text(value, 40).toLowerCase();
  if (candidate === "audiobook" || assetId.startsWith("abk_")) return "audiobook";
  if (candidate === "ebook" || assetId.startsWith("ebk_")) return "ebook";
  return "publication";
}

function isPublishedProduct(data: Record<string, unknown>): boolean {
  const published = data.status === "published" || data.isPublished === true;
  const deployment = data.wordpressDeployment as Record<string, unknown> | undefined;
  return published && (!deployment?.status || deployment.status === "deployed");
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

export async function loadReaderBookshelf(
  db: ReaderPlatformDb,
  readerUid: string
): Promise<ReaderBookshelfLoadResult> {
  const loadStartedAt = performance.now();
  const entitlementStartedAt = performance.now();
  const entitlements = await listActiveReaderEntitlements(db, readerUid);
  const entitlementQueryMs = elapsed(entitlementStartedAt);
  const uniqueEntitlements = new Map<string, { assetId: string; tenantId: string }>();

  for (const entitlement of entitlements) {
    if (entitlement.status !== "active" || entitlement.readerUid !== readerUid) continue;
    const assetId = text(entitlement.assetId, 160);
    const tenantId = text(entitlement.tenantId, 160);
    if (!assetId || !tenantId) continue;
    uniqueEntitlements.set(`${tenantId}\u0000${assetId}`, { assetId, tenantId });
  }

  const productMetadataStartedAt = performance.now();
  const uniqueValues = [...uniqueEntitlements.values()];
  const productReferences = uniqueValues.map(({ assetId }) =>
    db.collection("products").doc(assetId)
  );
  const productSnapshots = productReferences.length
    ? await db.getAll(...productReferences)
    : [];
  const snapshotsByAssetId = new Map(
    productSnapshots.map((snapshot) => [snapshot.id, snapshot])
  );

  const publications = uniqueValues.map(({ assetId, tenantId }) => {
    const snapshot = snapshotsByAssetId.get(assetId);
    if (!snapshot?.exists) return null;
    const data = snapshot.data() || {};
    const productTenantId = text(data.studioKey || data.wpStudioKey, 160);
    if (productTenantId !== tenantId || !isPublishedProduct(data)) return null;

    const deployment = data.wordpressDeployment as
      | Record<string, unknown>
      | undefined;
    return {
      assetId,
      title: text(data.title, 240) || "Untitled publication",
      description: text(data.description || data.synopsis, 1_000),
      authorName: text(data.authorName, 200) || "KOBA-I Author",
      publicationType: publicationType(data.type || data.assetType, assetId),
      category: text(data.category, 100),
      coverUrl: safeImageUrl(data.coverArtUrl || data.coverUrl),
      publicationUrl:
        deployment?.status === "deployed"
          ? safePublicationUrl(deployment.publicationUrl)
          : null,
    } satisfies ReaderBookshelfPublication;
  });

  const safePublications = publications
    .filter((item): item is ReaderBookshelfPublication => Boolean(item))
    .sort((left, right) =>
      left.title.localeCompare(right.title) || left.assetId.localeCompare(right.assetId)
    );
  const productMetadataJoinMs = elapsed(productMetadataStartedAt);

  return {
    publications: safePublications,
    timings: {
      entitlementQueryMs,
      productMetadataJoinMs,
      totalBookshelfLoadMs: elapsed(loadStartedAt),
      productMetadataBatchCount: productReferences.length ? 1 : 0,
    },
  };
}

export async function listReaderBookshelf(
  db: ReaderPlatformDb,
  readerUid: string
): Promise<ReaderBookshelfPublication[]> {
  return (await loadReaderBookshelf(db, readerUid)).publications;
}
