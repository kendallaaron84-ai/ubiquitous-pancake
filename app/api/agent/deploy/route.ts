import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Buffer } from "node:buffer";
import { FieldValue } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import {
  AuthorIdentityError,
  requireAuthorizedAuthorIdentity,
} from "@/core/security/author-identity";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["draft", "ready", "published"]);
const secretManager = new SecretManagerServiceClient({
  projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim(),
  },
});

interface ProductBody {
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
    if (!title) return failure(400, "Enter a book title.");
    if (!Number.isFinite(price) || price < 0) return failure(400, "Enter a valid price of zero or greater.");
    if (!ALLOWED_STATUSES.has(status)) return failure(400, "Choose a valid publishing status.");

    const licenseRef = adminDb.collection("plugin_licenses").doc(session.studioKey);
    const [licenseSnapshot, userSnapshot, connectionSnapshot] = await Promise.all([
      licenseRef.get(),
      adminDb.collection("users").doc(session.email.toLowerCase()).get(),
      adminDb.collection("connections").doc(session.studioKey).get(),
    ]);
    if (!licenseSnapshot.exists) return failure(403, "Your active author license was not found.");
    const license = licenseSnapshot.data() || {};
    const licenseEmail = clean(license.authorEmail || license.authorId).toLowerCase();
    if (licenseEmail !== session.email.toLowerCase()) {
      return failure(403, "This StudioKey belongs to another author account.");
    }

    const identity = await requireAuthorizedAuthorIdentity(
      adminDb,
      session.studioKey,
      session.email,
      clean(body?.authorIdentityId) || "primary"
    );
    const assetKey = `${mediaType === "ebook" ? "ebk_" : "abk_"}${slug(title)}`;
    const productRef = adminDb.collection("products").doc(assetKey);
    const existingSnapshot = await productRef.get();
    const existing = existingSnapshot.data() || {};
    const user = userSnapshot.data() || {};
    const connection = connectionSnapshot.data() || {};
    const associatedWebsite = normalizeOrigin(
      connection.targetWpOrigin ||
        license.associatedWebsite ||
        user.associatedWebsite ||
        existing.associatedWebsite
    );
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
      associatedWebsite,
      // Payment destinations belong to the tenant payment profile, never a product or browser payload.
      stripeConnectId: FieldValue.delete(),
      stripeAccountId: FieldValue.delete(),
      createdAt: existing.createdAt || timestamp,
      updatedAt: timestamp,
    }, { merge: true });

    const wordpress = await deployPublicationToWordPress({
      studioKey: session.studioKey,
      assetKey,
      title,
      authorName: identity.displayName,
      synopsis: clean(body?.synopsis) || clean(existing.synopsis),
      coverUrl: clean(body?.coverUrl) || clean(existing.coverUrl) || clean(existing.coverArtUrl),
      bgImageUrl: clean(body?.bgImageUrl) || clean(existing.bgImageUrl),
      mediaType,
      price,
      status,
      chapters,
      ebookPayload: body?.ebookPayload ?? existing.ebookPayload ?? null,
    });

    await productRef.set({
      wordpressDeployment: {
        status: "deployed",
        targetWpOrigin: wordpress.targetWpOrigin,
        publicationId: wordpress.publicationId,
        pageId: wordpress.pageId,
        bookshelfPageId: wordpress.bookshelfPageId,
        publicationUrl: wordpress.publicationUrl,
        bookshelfUrl: wordpress.bookshelfUrl,
        deployedAt: timestamp,
      },
      updatedAt: timestamp,
    }, { merge: true });

    return NextResponse.json({
      success: true,
      message: "Your publication and bookstore pages were deployed to WordPress.",
      assetKey,
      seoSlug: assetKey,
      wordpress: {
        publicationId: wordpress.publicationId,
        pageId: wordpress.pageId,
        bookshelfPageId: wordpress.bookshelfPageId,
        publicationUrl: wordpress.publicationUrl,
        bookshelfUrl: wordpress.bookshelfUrl,
      },
    });
  } catch (error) {
    if (error instanceof AuthorIdentityError) {
      return failure(error.status, error.publicMessage, error.code);
    }
    if (error instanceof WordPressDeploymentError) {
      return failure(error.status, error.message, "WORDPRESS_DEPLOYMENT_FAILED");
    }
    console.error("Publication save failed:", error);
    return failure(500, "Your publication could not be saved.");
  }
}

interface WordPressDeploymentInput {
  studioKey: string;
  assetKey: string;
  title: string;
  authorName: string;
  synopsis: string;
  coverUrl: string;
  bgImageUrl: string;
  mediaType: "audiobook" | "ebook";
  price: number;
  status: string;
  chapters: unknown[];
  ebookPayload: unknown;
}

interface WordPressDeploymentResult {
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
  const connectionSnapshot = await adminDb
    .collection("connections")
    .doc(input.studioKey)
    .get();
  const connection = connectionSnapshot.data() || {};
  const targetWpOrigin = normalizeOrigin(connection.targetWpOrigin);
  const secretCredentialRef = clean(connection.secretCredentialRef);
  if (
    !connectionSnapshot.exists ||
    connection.status !== "active" ||
    connection.verificationStatus !== "verified" ||
    !targetWpOrigin ||
    !/^projects\/[0-9]+\/secrets\/WP_CREDS_[A-Za-z0-9_-]+\/versions\/latest$/.test(
      secretCredentialRef
    )
  ) {
    throw new WordPressDeploymentError(
      409,
      "Connect and verify your WordPress site before deploying this publication."
    );
  }

  let secretResponse:
    | [{ payload?: { data?: Uint8Array | string | null } }]
    | { payload?: { data?: Uint8Array | string | null } };
  try {
    secretResponse = (await secretManager.accessSecretVersion({
      name: secretCredentialRef,
    })) as typeof secretResponse;
  } catch {
    throw new WordPressDeploymentError(
      503,
      "Your WordPress connection is protected, but its credentials could not be accessed. Retry in a moment."
    );
  }

  const secretVersion = Array.isArray(secretResponse)
    ? secretResponse[0]
    : secretResponse;
  const encodedSecret = secretVersion?.payload?.data;
  if (!encodedSecret) {
    throw new WordPressDeploymentError(
      503,
      "Your saved WordPress connection is incomplete. Reconnect the site and retry."
    );
  }

  const secretBuffer = Buffer.isBuffer(encodedSecret)
    ? Buffer.from(encodedSecret)
    : typeof encodedSecret === "string"
      ? Buffer.from(encodedSecret, "base64")
      : Buffer.from(encodedSecret);

  try {
    const stored = JSON.parse(secretBuffer.toString("utf8")) as {
      wordpressUrl?: unknown;
      username?: unknown;
      applicationPassword?: unknown;
    };
    const storedOrigin = normalizeOrigin(stored.wordpressUrl);
    const username = clean(stored.username);
    const applicationPassword = clean(stored.applicationPassword);
    if (
      storedOrigin !== targetWpOrigin ||
      !username ||
      !applicationPassword
    ) {
      throw new WordPressDeploymentError(
        503,
        "Your saved WordPress connection does not match this author workspace. Reconnect the site and retry."
      );
    }

    const authorization = Buffer.from(
      `${username}:${applicationPassword}`,
      "utf8"
    ).toString("base64");
    let response: Response;
    try {
      response = await fetch(
        `${targetWpOrigin}/wp-json/kobai/v1/publish-vault`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${authorization}`,
            "Content-Type": "application/json",
            "User-Agent": "KOBA-I-Dashboard/2.0",
          },
          body: JSON.stringify({
            assetKey: input.assetKey,
            bookTitle: input.title,
            bookSlug: input.assetKey,
            authorSlug: slug(input.authorName),
            authorName: input.authorName,
            synopsis: input.synopsis,
            coverUrl: input.coverUrl,
            bgImageUrl: input.bgImageUrl,
            type: input.mediaType,
            price: input.price,
            status: input.status,
            chapters: input.chapters,
            studioTracks: input.chapters,
            ebookPayload: input.ebookPayload,
          }),
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
        }
      );
    } catch {
      throw new WordPressDeploymentError(
        502,
        "KOBA-I could not reach your WordPress site to create the publication pages."
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          success?: unknown;
          message?: unknown;
          url?: unknown;
          page_id?: unknown;
          publication_id?: unknown;
          bookshelf_page_id?: unknown;
          bookshelf_url?: unknown;
        }
      | null;
    if (!response.ok || payload?.success !== true) {
      throw new WordPressDeploymentError(
        502,
        clean(payload?.message) ||
          `WordPress rejected the publication deployment (HTTP ${response.status}).`
      );
    }

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
        "WordPress responded, but did not confirm every required publication page."
      );
    }

    return {
      targetWpOrigin,
      publicationId,
      pageId,
      bookshelfPageId,
      publicationUrl,
      bookshelfUrl,
    };
  } finally {
    secretBuffer.fill(0);
  }
}

class WordPressDeploymentError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "WordPressDeploymentError";
  }
}

function positiveInteger(value: unknown): number {
  const candidate = Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : 0;
}

function failure(status: number, error: string, code?: string) {
  return NextResponse.json({ success: false, ...(code ? { code } : {}), error }, { status });
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

function normalizeOrigin(value: unknown): string {
  const candidate = clean(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") return "";
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}
