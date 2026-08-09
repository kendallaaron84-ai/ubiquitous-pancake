import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

export const AUTHOR_INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class AuthorInvitationError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 410;
  readonly code: string;

  constructor(
    status: 400 | 403 | 404 | 409 | 410,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthorInvitationError";
    this.status = status;
    this.code = code;
  }
}

export interface AuthorInvitationEnvelope {
  token: string;
  tokenHash: string;
  expiresAt: number;
}

export interface ResolvedAuthorInvitation {
  authorEmail: string;
  authorName: string;
  expiresAt: number;
}

export function createAuthorInvitationEnvelope(
  now = Date.now(),
  token = randomBytes(32).toString("base64url"),
): AuthorInvitationEnvelope {
  return { token, tokenHash: hashAuthorInvitationToken(token), expiresAt: now + AUTHOR_INVITATION_TTL_MS };
}

export function buildAuthorInvitationUrl(token: string, environment: NodeJS.ProcessEnv = process.env): string {
  assertToken(token);
  const base = new URL(environment.KOBA_DASHBOARD_URL?.trim() || "https://dashboard.koba-i.com");
  if (base.protocol !== "https:" && !(environment.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(base.hostname))) {
    throw new Error("KOBA_DASHBOARD_URL must use HTTPS outside local development.");
  }
  const url = new URL("/setup-password", base);
  url.searchParams.set("invite", token);
  return url.toString();
}

export function hashAuthorInvitationToken(token: string): string {
  assertToken(token);
  return createHash("sha256").update(token).digest("hex");
}

export async function resolveAuthorInvitation(
  database: Firestore,
  token: string,
  now = Date.now(),
): Promise<ResolvedAuthorInvitation> {
  const match = await findInvitation(database, token);
  const data = match.data;
  validateInvitation(data, now);
  const license = await database.collection("plugin_licenses").doc(clean(data.studioKey)).get();
  validateOwnership(data, license.exists ? license.data() || {} : null);
  return {
    authorEmail: clean(data.authorEmail).toLowerCase(),
    authorName: clean(data.authorName) || "KOBA-I Author",
    expiresAt: Number(data.welcomeInvitationExpiresAt),
  };
}

export async function establishAuthorInvitation(
  database: Firestore,
  adminAuth: Auth,
  input: { token: string; password: string; now?: number },
): Promise<{ customToken: string; email: string }> {
  const now = input.now ?? Date.now();
  validatePassword(input.password);
  const match = await findInvitation(database, input.token);
  const claimId = randomUUID();
  let email = "";
  let authorName = "";
  let studioKey = "";

  await database.runTransaction(async (transaction) => {
    const current = await transaction.get(match.ref);
    if (!current.exists) throw notFound();
    const data = current.data() || {};
    validateInvitation(data, now);
    const activeClaimUntil = Number(data.welcomeInvitationClaimExpiresAt) || 0;
    if (data.welcomeInvitationStatus === "claiming" && activeClaimUntil > now) {
      throw new AuthorInvitationError(409, "AUTHOR_INVITATION_IN_PROGRESS", "This invitation is already being established.");
    }
    studioKey = clean(data.studioKey);
    const licenseRef = database.collection("plugin_licenses").doc(studioKey);
    const license = await transaction.get(licenseRef);
    validateOwnership(data, license.exists ? license.data() || {} : null);
    email = clean(data.authorEmail).toLowerCase();
    authorName = clean(data.authorName) || "KOBA-I Author";
    transaction.update(match.ref, {
      welcomeInvitationStatus: "claiming",
      welcomeInvitationClaimId: claimId,
      welcomeInvitationClaimExpiresAt: now + CLAIM_LEASE_MS,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  let firebaseUser: UserRecord;
  try {
    try {
      firebaseUser = await adminAuth.getUserByEmail(email);
      await adminAuth.updateUser(firebaseUser.uid, { password: input.password, displayName: authorName, emailVerified: true });
    } catch (error: any) {
      if (error?.code !== "auth/user-not-found") throw error;
      firebaseUser = await adminAuth.createUser({ email, password: input.password, displayName: authorName, emailVerified: true });
    }

    const customToken = await adminAuth.createCustomToken(firebaseUser.uid);
    await database.runTransaction(async (transaction) => {
      const current = await transaction.get(match.ref);
      const data = current.data() || {};
      if (!current.exists || data.welcomeInvitationClaimId !== claimId || data.welcomeInvitationStatus !== "claiming") {
        throw new AuthorInvitationError(409, "AUTHOR_INVITATION_CLAIM_LOST", "The invitation claim could not be finalized.");
      }
      const timestamp = FieldValue.serverTimestamp();
      transaction.update(match.ref, {
        welcomeInvitationStatus: "consumed",
        welcomeInvitationConsumedAt: timestamp,
        welcomeInvitationClaimExpiresAt: null,
        accountEstablishedAt: timestamp,
        accountEstablishedUid: firebaseUser.uid,
        updatedAt: timestamp,
      });
      transaction.set(database.collection("plugin_licenses").doc(studioKey), {
        authConfigured: true,
        accountEstablishedAt: timestamp,
        accountEstablishedUid: firebaseUser.uid,
        updatedAt: timestamp,
      }, { merge: true });
      transaction.set(database.collection("users").doc(email), {
        email,
        name: authorName,
        studioKey,
        hasActiveLicense: true,
        authConfigured: true,
        accountEstablishedAt: timestamp,
        firebaseUid: firebaseUser.uid,
        updatedAt: timestamp,
      }, { merge: true });
    });
    return { customToken, email };
  } catch (error) {
    await match.ref.set({
      welcomeInvitationStatus: "active",
      welcomeInvitationClaimId: null,
      welcomeInvitationClaimExpiresAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => undefined);
    throw error;
  }
}

async function findInvitation(database: Firestore, token: string) {
  const tokenHash = hashAuthorInvitationToken(token);
  const query = await database.collection("plugin_license_provisions")
    .where("welcomeInvitationTokenHash", "==", tokenHash).limit(2).get();
  if (query.empty || query.docs.length !== 1) throw notFound();
  return { ref: query.docs[0].ref, data: query.docs[0].data() || {} };
}

function validateInvitation(data: Record<string, any>, now: number): void {
  if (data.welcomeInvitationStatus === "consumed" || data.accountEstablishedAt) {
    throw new AuthorInvitationError(410, "AUTHOR_INVITATION_USED", "This account-establishment invitation has already been used.");
  }
  if (data.welcomeInvitationStatus !== "active" && data.welcomeInvitationStatus !== "claiming") throw notFound();
  if (!Number.isFinite(Number(data.welcomeInvitationExpiresAt)) || Number(data.welcomeInvitationExpiresAt) <= now) {
    throw new AuthorInvitationError(410, "AUTHOR_INVITATION_EXPIRED", "This account-establishment invitation has expired.");
  }
}

function validateOwnership(provision: Record<string, any>, license: Record<string, any> | null): void {
  if (!license || clean(license.status) !== "active") {
    throw new AuthorInvitationError(403, "AUTHOR_LICENSE_INACTIVE", "The author workspace is not active.");
  }
  const studioKey = clean(provision.studioKey);
  const email = clean(provision.authorEmail).toLowerCase();
  const storedKey = clean(license.studioKey || license.key);
  const storedEmail = clean(license.authorEmail || license.email).toLowerCase();
  if (!studioKey || storedKey !== studioKey || !email || storedEmail !== email) {
    throw new AuthorInvitationError(403, "AUTHOR_INVITATION_OWNERSHIP_MISMATCH", "The invitation does not match the author workspace.");
  }
}

function validatePassword(password: string): void {
  if (password.length < 8 || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new AuthorInvitationError(400, "AUTHOR_PASSWORD_INVALID", "Use at least 8 characters including a number and special symbol.");
  }
}

function assertToken(token: string): void {
  if (!TOKEN_PATTERN.test(token.trim())) throw new AuthorInvitationError(400, "AUTHOR_INVITATION_INVALID", "The account-establishment invitation is invalid.");
}

function notFound() {
  return new AuthorInvitationError(404, "AUTHOR_INVITATION_NOT_FOUND", "The account-establishment invitation was not found.");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
