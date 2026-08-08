import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase-admin";
import { sendWelcomePackage } from "@/core/messaging/mailer";

export type AuthorProvisioningSource = "stripe_plugin_purchase" | "manual_owner";
export type WelcomeDeliveryIntent = "send" | "defer";
export type WelcomeEmailStatus = "pending" | "deferred" | "sending" | "sent" | "failed";

export interface AuthorProvisioningInput {
  authorName: string;
  authorEmail: string;
  source: AuthorProvisioningSource;
  idempotencyKey: string;
  hasAudiobookPlayer: boolean;
  hasEreader: boolean;
  stripeSessionId?: string | null;
  stripeEventId?: string | null;
  stripeCustomerId?: string | null;
  productId?: string | null;
  productName?: string | null;
  welcomeDelivery?: WelcomeDeliveryIntent;
}

export interface AuthorProvisioningResult {
  studioKey: string;
  created: boolean;
  welcomeEmailSent: boolean;
  welcomeEmailStatus: WelcomeEmailStatus;
}

interface ProvisioningState {
  studioKey?: unknown;
  welcomeEmailStatus?: unknown;
  welcomeEmailLeaseExpiresAt?: unknown;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDIO_KEY_PATTERN = /^KOBA-AUDIO-[A-F0-9]{16}$/;
const EMAIL_LEASE_MS = 5 * 60 * 1000;

export function resolvePluginDownloadUrl(
  source: NodeJS.ProcessEnv = process.env,
): string {
  const configuredUrl = source.KOBA_PLUGIN_DOWNLOAD_URL?.trim();
  if (!configuredUrl) {
    throw new Error("KOBA_PLUGIN_DOWNLOAD_URL must identify the published plugin ZIP.");
  }

  const parsed = new URL(configuredUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("KOBA_PLUGIN_DOWNLOAD_URL must use HTTPS.");
  }

  return parsed.toString();
}

export async function provisionAuthorPlugin(
  input: AuthorProvisioningInput,
): Promise<AuthorProvisioningResult> {
  if (!adminDb) {
    throw new Error("Firebase Admin SDK is unavailable.");
  }

  const authorName = normalizeName(input.authorName);
  const authorEmail = normalizeEmail(input.authorEmail);
  const idempotencyKey = input.idempotencyKey.trim();
  const welcomeDelivery = input.welcomeDelivery ?? "send";
  if (!authorName) throw new Error("The author name is required.");
  if (!EMAIL_PATTERN.test(authorEmail)) throw new Error("A valid author email is required.");
  if (!idempotencyKey) throw new Error("A provisioning idempotency key is required.");
  if (!input.hasAudiobookPlayer && !input.hasEreader) {
    throw new Error("At least one plugin entitlement is required.");
  }

  const provisionId = createHash("sha256")
    .update(`${input.source}:${idempotencyKey}`)
    .digest("hex");
  const provisionRef = adminDb.collection("plugin_license_provisions").doc(provisionId);
  const candidateStudioKey = generateStudioKey();

  const licenseResult = await adminDb.runTransaction(async (transaction: any) => {
    const provisionSnapshot = await transaction.get(provisionRef);
    const existingProvision = provisionSnapshot.exists
      ? (provisionSnapshot.data() as ProvisioningState)
      : null;
    const existingStudioKey = trimString(existingProvision?.studioKey);

    if (existingStudioKey) {
      if (!STUDIO_KEY_PATTERN.test(existingStudioKey)) {
        throw new Error("The stored StudioKey is malformed.");
      }
      return { studioKey: existingStudioKey, created: false };
    }

    const studioKey = candidateStudioKey;
    const licenseRef = adminDb.collection("plugin_licenses").doc(studioKey);
    const primaryIdentityRef = licenseRef
      .collection("author_identities")
      .doc("primary");
    const userRef = adminDb.collection("users").doc(authorEmail);
    const [licenseSnapshot, userSnapshot] = await Promise.all([
      transaction.get(licenseRef),
      transaction.get(userRef),
    ]);
    if (licenseSnapshot.exists) {
      throw new Error("StudioKey collision detected. Retry provisioning.");
    }

    const existingUser = userSnapshot.exists ? userSnapshot.data() || {} : {};
    const entitlements = [
      ...(input.hasAudiobookPlayer ? ["audiobook_plugin"] : []),
      ...(input.hasEreader ? ["ereader_plugin"] : []),
    ];
    const licenseType = input.hasAudiobookPlayer && input.hasEreader
      ? "koba_i_plugin_suite"
      : input.hasEreader
        ? "ereader_plugin"
        : "audiobook_plugin";
    const timestamp = FieldValue.serverTimestamp();

    const welcomeEmailStatus: WelcomeEmailStatus = welcomeDelivery === "defer"
      ? "deferred"
      : "pending";

    transaction.create(licenseRef, {
      key: studioKey,
      studioKey,
      authorId: authorEmail,
      authorEmail,
      authorName,
      licenseClass: "individual_author",
      maxAuthorIdentities: 2,
      primaryAuthorIdentityId: "primary",
      status: "active",
      type: licenseType,
      licenseType,
      hasAudiobookPlayer: input.hasAudiobookPlayer,
      hasEreader: input.hasEreader,
      entitlements,
      pluginEntitlements: entitlements,
      features: entitlements,
      source: input.source,
      provisioningId: provisionId,
      stripeSessionId: nullableString(input.stripeSessionId),
      stripeEventId: nullableString(input.stripeEventId),
      stripeCustomerId: nullableString(input.stripeCustomerId),
      productId: nullableString(input.productId),
      productName: nullableString(input.productName),
      associatedWebsite: null,
      welcomeEmailStatus,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    transaction.create(primaryIdentityRef, {
      identityId: "primary",
      displayName: authorName,
      normalizedName: authorName.normalize("NFKC").toLocaleLowerCase("en-US"),
      type: "primary",
      status: "active",
      source: "license_provisioning",
      rightsAttestation: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    transaction.set(userRef, {
      email: authorEmail,
      name: trimString(existingUser.name) || authorName,
      studioKey,
      hasActiveLicense: true,
      authConfigured: existingUser.authConfigured === true,
      pluginEntitlements: Array.from(new Set([
        ...(Array.isArray(existingUser.pluginEntitlements)
          ? existingUser.pluginEntitlements.map(trimString).filter(Boolean)
          : []),
        ...entitlements,
      ])),
      createdAt: existingUser.createdAt || timestamp,
      updatedAt: timestamp,
    }, { merge: true });

    transaction.create(provisionRef, {
      provisionId,
      studioKey,
      authorEmail,
      authorName,
      source: input.source,
      idempotencyKeyHash: provisionId,
      welcomeEmailStatus,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return { studioKey, created: true };
  });

  if (welcomeDelivery === "defer") {
    const welcomeEmailStatus = await deferProvisionedAuthorWelcome(
      provisionRef,
      licenseResult.studioKey,
    );
    return {
      ...licenseResult,
      welcomeEmailSent: welcomeEmailStatus === "sent",
      welcomeEmailStatus,
    };
  }

  return deliverProvisionedAuthorWelcome({
    provisionRef,
    authorEmail,
    authorName,
    studioKey: licenseResult.studioKey,
    licenseResult,
  });
}

async function deferProvisionedAuthorWelcome(
  provisionRef: FirebaseFirestore.DocumentReference,
  studioKey: string,
): Promise<WelcomeEmailStatus> {
  let status: WelcomeEmailStatus = "deferred";
  await adminDb.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(provisionRef);
    if (!snapshot.exists) throw new Error("Provisioning state was not created.");
    const data = snapshot.data() as ProvisioningState;
    const currentStatus = normalizeWelcomeEmailStatus(data.welcomeEmailStatus);
    if (currentStatus === "sent") {
      status = "sent";
      return;
    }
    const leaseExpiresAt = Number(data.welcomeEmailLeaseExpiresAt) || 0;
    if (currentStatus === "sending" && leaseExpiresAt > Date.now()) {
      status = "sending";
      return;
    }
    const timestamp = FieldValue.serverTimestamp();
    transaction.update(provisionRef, {
      welcomeEmailStatus: "deferred",
      welcomeEmailLeaseExpiresAt: null,
      updatedAt: timestamp,
    });
    transaction.set(adminDb.collection("plugin_licenses").doc(studioKey), {
      welcomeEmailStatus: "deferred",
      updatedAt: timestamp,
    }, { merge: true });
  });
  return status;
}

async function deliverProvisionedAuthorWelcome(input: {
  provisionRef: FirebaseFirestore.DocumentReference;
  authorEmail: string;
  authorName: string;
  studioKey: string;
  licenseResult: { studioKey: string; created: boolean };
}): Promise<AuthorProvisioningResult> {
  const pluginDownloadUrl = resolvePluginDownloadUrl();
  const { provisionRef, authorEmail, authorName, studioKey, licenseResult } = input;

  const emailClaimId = randomUUID();
  const shouldSendEmail = await adminDb.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(provisionRef);
    if (!snapshot.exists) throw new Error("Provisioning state was not created.");
    const data = snapshot.data() as ProvisioningState;
    if (data.welcomeEmailStatus === "sent") return false;

    const leaseExpiresAt = Number(data.welcomeEmailLeaseExpiresAt) || 0;
    if (data.welcomeEmailStatus === "sending" && leaseExpiresAt > Date.now()) {
      return false;
    }

    transaction.update(provisionRef, {
      welcomeEmailStatus: "sending",
      welcomeEmailClaimId: emailClaimId,
      welcomeEmailLeaseExpiresAt: Date.now() + EMAIL_LEASE_MS,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!shouldSendEmail) {
    const currentState = await provisionRef.get();
    return {
      ...licenseResult,
      welcomeEmailSent: currentState.data()?.welcomeEmailStatus === "sent",
      welcomeEmailStatus: normalizeWelcomeEmailStatus(
        currentState.data()?.welcomeEmailStatus,
      ),
    };
  }

  try {
    const mailResult = await sendWelcomePackage({
      toEmail: authorEmail,
      authorName,
      studioKey,
      pluginDownloadUrl,
    });
    const timestamp = FieldValue.serverTimestamp();
    await Promise.all([
      provisionRef.set({
        welcomeEmailStatus: "sent",
        welcomeEmailMessageId: mailResult.messageId,
        welcomeEmailSentAt: timestamp,
        welcomeEmailLeaseExpiresAt: null,
        updatedAt: timestamp,
      }, { merge: true }),
      adminDb.collection("plugin_licenses").doc(studioKey).set({
        welcomeEmailStatus: "sent",
        welcomeEmailMessageId: mailResult.messageId,
        welcomeEmailSentAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true }),
    ]);
    return { ...licenseResult, welcomeEmailSent: true, welcomeEmailStatus: "sent" };
  } catch (error) {
    const timestamp = FieldValue.serverTimestamp();
    await Promise.all([
      provisionRef.set({
        welcomeEmailStatus: "failed",
        welcomeEmailError: safeError(error),
        welcomeEmailLeaseExpiresAt: null,
        updatedAt: timestamp,
      }, { merge: true }),
      adminDb.collection("plugin_licenses").doc(studioKey).set({
        welcomeEmailStatus: "failed",
        updatedAt: timestamp,
      }, { merge: true }),
    ]);
    throw error;
  }
}

function normalizeWelcomeEmailStatus(value: unknown): WelcomeEmailStatus {
  return value === "deferred" || value === "sending" || value === "sent" || value === "failed"
    ? value
    : "pending";
}

function generateStudioKey(): string {
  return `KOBA-AUDIO-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function nullableString(value: string | null | undefined): string | null {
  const normalized = trimString(value);
  return normalized || null;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown welcome email failure.";
}
