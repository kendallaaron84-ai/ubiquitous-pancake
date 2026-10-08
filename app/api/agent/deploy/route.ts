import { FieldValue } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import {
  PublicationDestinationError,
  assertConfirmedPublicationOrigin,
  productHistoricalOrigin,
  resolvePublicationDestination,
  type ResolvedPublicationDestination,
} from "@/core/nexus/publication-destination";
import {
  DESTINATION_CHANGE_FAILED_MESSAGE,
  buildAuthoritativeDeploymentFields,
  buildFailedDeploymentPatch,
  buildDeploymentHistoryEntry,
  buildPendingDeploymentPatch,
  isConfirmedDestinationChange,
} from "@/core/nexus/publication-migration";
import { listNexusWebsiteConnections } from "@/core/nexus/website-connections";
import {
  AuthorIdentityError,
  requireAuthorizedAuthorIdentity,
} from "@/core/security/author-identity";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";
import {
  StudioPublicationAccessError,
  assertOwnedStudioProduct,
  assertValidStudioAssetId,
} from "@/core/security/studio-publication-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["draft", "ready", "published"]);
const DEFAULT_PRODUCTION_WORDPRESS_GATEWAY =
  "https://wordpress-egress-gateway-prod-aoosgrwosq-uc.a.run.app";
let gatewayAuthClient: GoogleAuth | null = null;

interface WordPressGatewayDeploymentResponse {
  success?: boolean;
  code?: string;
  error?: string;
  targetWpOrigin?: string;
  publication_id?: unknown;
  page_id?: unknown;
  bookshelf_page_id?: unknown;
  url?: unknown;
  bookshelf_url?: unknown;
}

function getGatewayAuthClient(): GoogleAuth {
  if (gatewayAuthClient) return gatewayAuthClient;

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    .trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new WordPressDeploymentError(
      503,
      "WORDPRESS_GATEWAY_NOT_CONFIGURED",
      "The secure WordPress deployment service is not configured.",
      "dashboard_configuration"
    );
  }

  gatewayAuthClient = new GoogleAuth({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });
  return gatewayAuthClient;
}

function resolveWordPressGatewayUrl(): string {
  const configured =
    process.env.WORDPRESS_EGRESS_GATEWAY_URL?.trim() ||
    (process.env.NODE_ENV === "production"
      ? DEFAULT_PRODUCTION_WORDPRESS_GATEWAY
      : "");
  if (!configured) {
    throw new WordPressDeploymentError(
      503,
      "WORDPRESS_GATEWAY_NOT_CONFIGURED",
      "The secure WordPress deployment service is unavailable.",
      "dashboard_configuration"
    );
  }

  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid gateway URL");
    }
    return parsed.origin;
  } catch {
    throw new WordPressDeploymentError(
      503,
      "WORDPRESS_GATEWAY_MISCONFIGURED",
      "The secure WordPress deployment service is misconfigured.",
      "dashboard_configuration"
    );
  }
}

interface ProductBody {
  assetId?: unknown;
  bookTitle?: unknown;
  synopsis?: unknown;
  coverUrl?: unknown;
  bgImageUrl?: unknown;
  type?: unknown;
  price?: unknown;
  status?: unknown;
  chapters?: unknown;
  studioTracks?: unknown;
  ebookPayload?: unknown;
  authorIdentityId?: unknown;
  category?: unknown;
  websiteConnectionId?: unknown;
  universeId?: unknown;
  confirmDestinationChange?: unknown;
}

export async function POST(request: Request) {
  try {
    const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    if (!token) return failure(401, "Sign in to save your publication.");
    const session = await verifyDashboardSession(
      token,
      resolveDashboardSessionSecret()
    ).catch(() => null);
    if (!session?.studioKey) return failure(403, "Your dashboard session is not connected to a StudioKey.");

    const body = (await request.json().catch(() => null)) as ProductBody | null;
    const title = clean(body?.bookTitle);
    const mediaType = clean(body?.type).toLowerCase() === "ebook" ? "ebook" : "audiobook";
    const price = Number(body?.price ?? 0);
    const status = clean(body?.status).toLowerCase() || "draft";
    const category = clean(body?.category) || (mediaType === "ebook" ? "E-Books" : "Audiobooks");
    if (!title) return failure(400, "Enter a book title.");
    if (!Number.isFinite(price) || price < 0) return failure(400, "Enter a valid price of zero or greater.");
    if (!ALLOWED_STATUSES.has(status)) return failure(400, "Choose a valid publishing status.");

    const licenseRef = adminDb.collection("plugin_licenses").doc(session.studioKey);
    const licenseSnapshot = await licenseRef.get();
    if (!licenseSnapshot.exists) return failure(403, "Your active author license was not found.");
    const license = licenseSnapshot.data() || {};
    const licenseEmail = clean(license.authorEmail || license.authorId).toLowerCase();
    if (licenseEmail !== session.email.toLowerCase()) {
      return failure(403, "This StudioKey belongs to another author account.");
    }
    const authorId = clean(license.authorId) || session.email.toLowerCase();

    const identity = await requireAuthorizedAuthorIdentity(
      adminDb,
      session.studioKey,
      session.email,
      clean(body?.authorIdentityId) || "primary"
    );
    const requestedAssetId = clean(body?.assetId);
    const assetKey = requestedAssetId
      ? assertValidStudioAssetId(requestedAssetId)
      : `${mediaType === "ebook" ? "ebk_" : "abk_"}${slug(title)}`;
    const productRef = adminDb.collection("products").doc(assetKey);
    const existingSnapshot = await productRef.get();
    const existing = existingSnapshot.data() || {};
    if (requestedAssetId) {
      assertOwnedStudioProduct({
        session,
        studioKey: session.studioKey,
        authorEmail: session.email.toLowerCase(),
      }, existingSnapshot.exists ? existing : null);
    }
    const existingWordPressDeployment =
      existing.wordpressDeployment &&
      typeof existing.wordpressDeployment === "object"
        ? existing.wordpressDeployment as Record<string, unknown>
        : {};
    const hasConfirmedWordPressDeployment =
      clean(existingWordPressDeployment.status) === "deployed" &&
      positiveInteger(existingWordPressDeployment.publicationId) > 0 &&
      positiveInteger(existingWordPressDeployment.pageId) > 0;
    const existingStudioKey = clean(existing.studioKey || existing.wpStudioKey);
    const existingAuthor = clean(existing.authorEmail || existing.authorId).toLowerCase();
    if (
      existingSnapshot.exists &&
      ((existingStudioKey && existingStudioKey !== session.studioKey) ||
        (existingAuthor && existingAuthor !== session.email.toLowerCase()))
    ) {
      return failure(
        403,
        "This product belongs to another author workspace.",
        "PUBLICATION_DESTINATION_FORBIDDEN"
      );
    }
    const universeId = clean(body?.universeId || existing.universeId || existing.storyWorldId);
    const [connections, storyWorldDefaultWebsiteConnectionId] = await Promise.all([
      listNexusWebsiteConnections(adminDb, session.studioKey, authorId),
      loadStoryWorldDefaultWebsiteConnectionId(
        universeId,
        session.studioKey,
        authorId
      ),
    ]);
    let destination: ResolvedPublicationDestination;
    try {
      destination = resolvePublicationDestination({
        studioKey: session.studioKey,
        authorId,
        connections,
        requestedWebsiteConnectionId: body?.websiteConnectionId,
        storyWorldDefaultWebsiteConnectionId,
        confirmDestinationChange: body?.confirmDestinationChange === true,
        existingProduct: {
          websiteConnectionId: existing.websiteConnectionId,
          associatedWebsite: existing.associatedWebsite,
          wordpressDeployment: existingWordPressDeployment,
          hasConfirmedDeployment: hasConfirmedWordPressDeployment,
        },
      });
    } catch (error) {
      if (
        error instanceof PublicationDestinationError &&
        error.destinationStatus === "needs_review" &&
        existingSnapshot.exists
      ) {
        await productRef.set({
          destinationStatus: "needs_review",
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      throw error;
    }
    const associatedWebsite = destination.targetWpOrigin;
    const previousWebsiteConnectionId = clean(
      existingWordPressDeployment.websiteConnectionId ||
      existing.websiteConnectionId
    );
    const previousTargetOrigin = productHistoricalOrigin({
      associatedWebsite: existing.associatedWebsite,
      wordpressDeployment: existingWordPressDeployment,
    });
    const destinationChanged = isConfirmedDestinationChange({
      hasConfirmedDeployment: hasConfirmedWordPressDeployment,
      previousWebsiteConnectionId,
      previousTargetOrigin,
      nextWebsiteConnectionId: destination.websiteConnectionId,
      nextTargetOrigin: destination.targetWpOrigin,
    });
    console.info("[Publication Deployment] Destination resolved.", {
      assetKey,
      selectedWebsiteConnectionId: destination.websiteConnectionId,
      resolvedTargetOrigin: destination.targetWpOrigin,
      destinationChanged,
    });
    const chapters = Array.isArray(body?.chapters)
      ? body.chapters
      : Array.isArray(body?.studioTracks)
        ? body.studioTracks
        : Array.isArray(existing.chapters)
          ? existing.chapters
          : [];

    const timestamp = FieldValue.serverTimestamp();
    await productRef.set({
      id: assetKey,
      assetKey,
      title,
      synopsis: clean(body?.synopsis) || clean(existing.synopsis),
      description: clean(body?.synopsis) || clean(existing.description),
      coverUrl: clean(body?.coverUrl) || clean(existing.coverUrl),
      coverArtUrl: clean(body?.coverUrl) || clean(existing.coverArtUrl),
      bgImageUrl: clean(body?.bgImageUrl) || clean(existing.bgImageUrl),
      type: mediaType,
      category,
      price,
      currency: "usd",
      // A new publication is not public until WordPress confirms that its
      // destination page exists. Existing confirmed publications remain live
      // while a later metadata sync is in progress.
      status: hasConfirmedWordPressDeployment
        ? clean(existing.status) || status
        : "draft",
      isPublished: hasConfirmedWordPressDeployment
        ? existing.isPublished === true || existing.status === "published"
        : false,
      requestedPublishingStatus: status,
      chapters,
      studioTracks: chapters,
      ebookPayload: body?.ebookPayload ?? existing.ebookPayload ?? null,
      authorId: session.email.toLowerCase(),
      authorEmail: session.email.toLowerCase(),
      authorIdentityId: identity.id,
      authorName: identity.displayName,
      studioKey: session.studioKey,
      wpStudioKey: session.studioKey,
      // Payment destinations belong to the tenant payment profile, never a product or browser payload.
      stripeConnectId: FieldValue.delete(),
      stripeAccountId: FieldValue.delete(),
      ...buildPendingDeploymentPatch(
        {
          websiteConnectionId: destination.websiteConnectionId,
          targetWpOrigin: associatedWebsite,
        },
        timestamp
      ),
      createdAt: existing.createdAt || timestamp,
      updatedAt: timestamp,
    }, { merge: true });

    let wordpress: WordPressDeploymentResult;
    try {
      wordpress = await deployPublicationToWordPress({
        studioKey: session.studioKey,
        destination,
        assetKey,
        title,
        authorName: identity.displayName,
        synopsis: clean(body?.synopsis) || clean(existing.synopsis),
        coverUrl: clean(body?.coverUrl) || clean(existing.coverUrl) || clean(existing.coverArtUrl),
        bgImageUrl: clean(body?.bgImageUrl) || clean(existing.bgImageUrl),
        mediaType,
        category,
        price,
        status,
        chapters,
        ebookPayload: body?.ebookPayload ?? existing.ebookPayload ?? null,
      });
    } catch (error) {
      const classified = classifyDeploymentError(error);
      console.error("[Publication Deployment] Deployment failed.", {
        assetKey,
        selectedWebsiteConnectionId: destination.websiteConnectionId,
        resolvedTargetOrigin: destination.targetWpOrigin,
        boundary: classified.boundary,
        code: classified.code,
        httpStatus: classified.status,
        destinationChanged,
      });
      await productRef.set({
        status: hasConfirmedWordPressDeployment
          ? clean(existing.status) || "published"
          : "draft",
        isPublished: hasConfirmedWordPressDeployment
          ? existing.isPublished === true || existing.status === "published"
          : false,
        ...buildFailedDeploymentPatch({
          destination: {
            websiteConnectionId: destination.websiteConnectionId,
            targetWpOrigin: associatedWebsite,
          },
          failedAt: timestamp,
          code: classified.code,
          boundary: classified.boundary,
        }),
      }, { merge: true });
      if (destinationChanged) {
        throw new WordPressDeploymentError(
          classified.status,
          classified.code,
          DESTINATION_CHANGE_FAILED_MESSAGE,
          classified.boundary
        );
      }
      throw classified;
    }

    const successPatch: Record<string, unknown> = {
      status,
      isPublished: status === "published",
      requestedPublishingStatus: FieldValue.delete(),
      ...buildAuthoritativeDeploymentFields(wordpress, timestamp),
      pendingWordpressDeployment: FieldValue.delete(),
      lastDeploymentAttempt: {
        status: "deployed",
        websiteConnectionId: destination.websiteConnectionId,
        targetWpOrigin: wordpress.targetWpOrigin,
        completedAt: timestamp,
      },
      updatedAt: timestamp,
    };
    if (destinationChanged) {
      successPatch.deploymentHistory = FieldValue.arrayUnion(
        buildDeploymentHistoryEntry({
          previousWebsiteConnectionId,
          previousTargetOrigin,
          next: wordpress,
          migrationTimestamp: new Date().toISOString(),
          authenticatedAuthor: session.email,
        })
      );
    }
    await productRef.set(successPatch, { merge: true });

    const deployedProduct = {
      id: assetKey,
      assetKey,
      title,
      synopsis: clean(body?.synopsis) || clean(existing.synopsis),
      description: clean(body?.synopsis) || clean(existing.description),
      coverUrl: clean(body?.coverUrl) || clean(existing.coverUrl),
      coverArtUrl: clean(body?.coverUrl) || clean(existing.coverArtUrl),
      bgImageUrl: clean(body?.bgImageUrl) || clean(existing.bgImageUrl),
      type: mediaType,
      category,
      price,
      currency: "usd",
      status,
      isPublished: status === "published",
      chapters,
      studioTracks: chapters,
      ebookPayload: body?.ebookPayload ?? existing.ebookPayload ?? null,
      authorId: session.email.toLowerCase(),
      authorEmail: session.email.toLowerCase(),
      authorIdentityId: identity.id,
      authorName: identity.displayName,
      studioKey: session.studioKey,
      wpStudioKey: session.studioKey,
      universeId: universeId || null,
      websiteConnectionId: destination.websiteConnectionId,
      associatedWebsite: wordpress.targetWpOrigin,
      destinationStatus: "bound",
      wordpressDeployment: {
        status: "deployed",
        websiteConnectionId: destination.websiteConnectionId,
        targetWpOrigin: wordpress.targetWpOrigin,
        publicationId: wordpress.publicationId,
        pageId: wordpress.pageId,
        bookshelfPageId: wordpress.bookshelfPageId,
        publicationUrl: wordpress.publicationUrl,
        bookshelfUrl: wordpress.bookshelfUrl,
      },
    };

    return NextResponse.json({
      success: true,
      message: "Your publication and bookstore pages were deployed to WordPress.",
      assetKey,
      seoSlug: assetKey,
      websiteConnectionId: destination.websiteConnectionId,
      targetWpOrigin: wordpress.targetWpOrigin,
      wordpress: {
        publicationId: wordpress.publicationId,
        pageId: wordpress.pageId,
        bookshelfPageId: wordpress.bookshelfPageId,
        publicationUrl: wordpress.publicationUrl,
        bookshelfUrl: wordpress.bookshelfUrl,
      },
      product: deployedProduct,
    });
  } catch (error) {
    if (error instanceof StudioPublicationAccessError) {
      return failure(error.status, error.publicMessage, error.code);
    }
    if (error instanceof AuthorIdentityError) {
      return failure(error.status, error.publicMessage, error.code);
    }
    if (error instanceof PublicationDestinationError) {
      return failure(error.status, error.publicMessage, error.code);
    }
    if (error instanceof WordPressDeploymentError) {
      return failure(error.status, error.message, error.code);
    }
    console.error("Publication save failed:", error);
    return failure(500, "Your publication could not be saved.");
  }
}

interface WordPressDeploymentInput {
  studioKey: string;
  destination: ResolvedPublicationDestination;
  assetKey: string;
  title: string;
  authorName: string;
  synopsis: string;
  coverUrl: string;
  bgImageUrl: string;
  mediaType: "audiobook" | "ebook";
  category: string;
  price: number;
  status: string;
  chapters: unknown[];
  ebookPayload: unknown;
}

interface WordPressDeploymentResult {
  websiteConnectionId: string;
  targetWpOrigin: string;
  publicationId: number;
  pageId: number;
  bookshelfPageId: number;
  publicationUrl: string;
  bookshelfUrl: string;
}

async function deployPublicationToWordPress(
  input: WordPressDeploymentInput
): Promise<WordPressDeploymentResult> {
  const targetWpOrigin = input.destination.targetWpOrigin;
  const wpUsername = input.destination.wpUsername;

  const gatewayUrl = resolveWordPressGatewayUrl();
  let gatewayResponse: {
    status: number;
    data: WordPressGatewayDeploymentResponse;
  };
  try {
    const authenticatedClient =
      await getGatewayAuthClient().getIdTokenClient(gatewayUrl);
    const response =
      await authenticatedClient.request<WordPressGatewayDeploymentResponse>({
        url: `${gatewayUrl}/publish-vault`,
        method: "POST",
        data: {
          studioKey: input.studioKey,
          websiteConnectionId: input.destination.websiteConnectionId,
          secretCredentialRef: input.destination.secretCredentialRef,
          targetWpOrigin,
          wpUsername,
          publication: {
            assetKey: input.assetKey,
            bookTitle: input.title,
            bookSlug: input.assetKey,
            authorSlug: slug(input.authorName),
            authorName: input.authorName,
            synopsis: input.synopsis,
            coverUrl: input.coverUrl,
            bgImageUrl: input.bgImageUrl,
            type: input.mediaType,
            category: input.category,
            price: input.price,
            status: input.status,
            chapters: input.chapters,
            studioTracks: input.chapters,
            ebookPayload: input.ebookPayload,
          },
        },
        timeout: 25_000,
        validateStatus: () => true,
      });
    gatewayResponse = {
      status: response.status,
      data: response.data || {},
    };
  } catch (error) {
    console.error("WordPress publication gateway request failed.", {
      assetKey: input.assetKey,
      targetWpOrigin,
      reason: error instanceof Error ? error.message : "Unknown network failure",
    });
    throw new WordPressDeploymentError(
      503,
      "WORDPRESS_GATEWAY_UNAVAILABLE",
      "KOBA-I could not reach the secure WordPress deployment service. Retry Save & Sync.",
      "gateway_transport"
    );
  }

  const payload = gatewayResponse.data;
  if (
    gatewayResponse.status < 200 ||
    gatewayResponse.status >= 300 ||
    payload.success !== true
  ) {
    const gatewayCode = clean(payload.code) || "WORDPRESS_GATEWAY_REJECTED";
    const responseStatus = gatewayResponse.status === 409
      ? 409
      : gatewayResponse.status === 503
        ? 503
        : 502;
    throw new WordPressDeploymentError(
      responseStatus,
      gatewayCode,
      clean(payload.error) ||
        `The secure WordPress service rejected the deployment (HTTP ${gatewayResponse.status}).`,
      "gateway_response"
    );
  }

  const confirmedOrigin = assertConfirmedPublicationOrigin(
    targetWpOrigin,
    payload.targetWpOrigin
  );
  const publicationId = positiveInteger(payload.publication_id);
  const pageId = positiveInteger(payload.page_id);
  const bookshelfPageId = positiveInteger(payload.bookshelf_page_id);
  const publicationUrl = clean(payload.url);
  const bookshelfUrl = clean(payload.bookshelf_url);
  if (
    !publicationId ||
    !pageId ||
    !bookshelfPageId ||
    !publicationUrl ||
    !bookshelfUrl
  ) {
    throw new WordPressDeploymentError(
      502,
      "WORDPRESS_DEPLOYMENT_INCOMPLETE",
      "The secure WordPress service responded, but did not confirm every required publication page.",
      "gateway_response_validation"
    );
  }

  return {
    websiteConnectionId: input.destination.websiteConnectionId,
    targetWpOrigin: confirmedOrigin,
    publicationId,
    pageId,
    bookshelfPageId,
    publicationUrl,
    bookshelfUrl,
  };
}

class WordPressDeploymentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly boundary: string
  ) {
    super(message);
    this.name = "WordPressDeploymentError";
  }
}

function classifyDeploymentError(error: unknown): WordPressDeploymentError {
  if (error instanceof WordPressDeploymentError) return error;
  return new WordPressDeploymentError(
    500,
    "PUBLICATION_DEPLOYMENT_INTERNAL_ERROR",
    "Your publication could not be deployed.",
    "dashboard_internal"
  );
}

function positiveInteger(value: unknown): number {
  const candidate = Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : 0;
}

function failure(status: number, error: string, code?: string) {
  return NextResponse.json({ success: false, ...(code ? { code } : {}), error }, { status });
}

async function loadStoryWorldDefaultWebsiteConnectionId(
  universeId: string,
  studioKey: string,
  authorId: string
): Promise<string> {
  if (!universeId) return "";

  const snapshot = await adminDb
    .collection("nexus_story_worlds")
    .doc(universeId)
    .get();
  if (!snapshot.exists) return "";

  const storyWorld = snapshot.data() || {};
  if (
    clean(storyWorld.studioKey) !== studioKey ||
    clean(storyWorld.authorId).toLowerCase() !== authorId.toLowerCase() ||
    clean(storyWorld.status) !== "active"
  ) {
    return "";
  }

  return clean(storyWorld.defaultWebsiteConnectionId);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || "untitled-publication";
}
