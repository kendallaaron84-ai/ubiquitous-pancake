import "server-only";

import type { Firestore } from "firebase-admin/firestore";

export type AuthorOnboardingGroup = "needs_setup" | "welcome_deferred" | "welcome_failed" | "welcome_sent_awaiting_account" | "active";

export interface AuthorOnboardingQueueItem {
  provisionId: string;
  authorName: string;
  authorEmail: string;
  maskedStudioKey: string;
  capabilities: { hasAudiobookPlayer: boolean; hasEreader: boolean };
  websiteConnectionStatus: "not_connected" | "connected";
  siteOrigins: string[];
  welcomeEmailStatus: "pending" | "deferred" | "sending" | "sent" | "failed";
  welcomeEmailSentAt: string | null;
  accountEstablished: boolean;
  accountEstablishedAt: string | null;
  group: AuthorOnboardingGroup;
  nextAction: string;
}

export async function listAuthorOnboardingQueue(database: Firestore): Promise<AuthorOnboardingQueueItem[]> {
  const provisions = await database.collection("plugin_license_provisions").get();
  const items = await Promise.all(provisions.docs.map(async (provision) => {
    const data = provision.data() || {};
    const studioKey = clean(data.studioKey);
    const authorEmail = clean(data.authorEmail).toLowerCase();
    if (!studioKey || !authorEmail) return null;
    const licenseRef = database.collection("plugin_licenses").doc(studioKey);
    const connectionRef = database.collection("connections").doc(studioKey);
    const [licenseSnapshot, userSnapshot, connectionSnapshot, websitesSnapshot] = await Promise.all([
      licenseRef.get(),
      database.collection("users").doc(authorEmail).get(),
      connectionRef.get(),
      connectionRef.collection("websites").get(),
    ]);
    if (!licenseSnapshot.exists) return null;
    const license = licenseSnapshot.data() || {};
    const user = userSnapshot.exists ? userSnapshot.data() || {} : {};
    const origins = new Set<string>();
    addVerifiedOrigin(origins, connectionSnapshot.exists ? connectionSnapshot.data() || {} : {});
    for (const website of websitesSnapshot.docs) addVerifiedOrigin(origins, website.data() || {});
    const welcomeEmailStatus = normalizeWelcomeStatus(data.welcomeEmailStatus || license.welcomeEmailStatus);
    const accountEstablished = Boolean(data.accountEstablishedAt || license.accountEstablishedAt || user.accountEstablishedAt || user.authConfigured === true);
    const group = classifyAuthorOnboardingState({ accountEstablished, connected: origins.size > 0, welcomeEmailStatus });
    return {
      provisionId: provision.id,
      authorName: clean(data.authorName || license.authorName || user.name) || "KOBA-I Author",
      authorEmail,
      maskedStudioKey: maskStudioKey(studioKey),
      capabilities: {
        hasAudiobookPlayer: license.hasAudiobookPlayer === true || arrayIncludes(license.pluginEntitlements, "audiobook_plugin"),
        hasEreader: license.hasEreader === true || arrayIncludes(license.pluginEntitlements, "ereader_plugin"),
      },
      websiteConnectionStatus: origins.size > 0 ? "connected" as const : "not_connected" as const,
      siteOrigins: Array.from(origins).sort(),
      welcomeEmailStatus,
      welcomeEmailSentAt: toIso(data.welcomeEmailSentAt || license.welcomeEmailSentAt),
      accountEstablished,
      accountEstablishedAt: toIso(data.accountEstablishedAt || license.accountEstablishedAt || user.accountEstablishedAt),
      group,
      nextAction: nextAction(group),
    };
  }));
  return items.filter((item): item is AuthorOnboardingQueueItem => Boolean(item))
    .sort((left, right) => left.authorName.localeCompare(right.authorName));
}

export function classifyAuthorOnboardingState(input: { accountEstablished: boolean; connected: boolean; welcomeEmailStatus: AuthorOnboardingQueueItem["welcomeEmailStatus"] }): AuthorOnboardingGroup {
  if (input.accountEstablished && input.connected) return "active";
  if (input.accountEstablished) return "needs_setup";
  if (input.welcomeEmailStatus === "deferred") return "welcome_deferred";
  if (input.welcomeEmailStatus === "failed") return "welcome_failed";
  if (input.welcomeEmailStatus === "sent") return "welcome_sent_awaiting_account";
  return "needs_setup";
}

function nextAction(group: AuthorOnboardingGroup): string {
  if (group === "welcome_deferred") return "Send welcome package";
  if (group === "welcome_failed") return "Retry welcome delivery";
  if (group === "welcome_sent_awaiting_account") return "Await account establishment";
  if (group === "active") return "Onboarding complete";
  return "Complete website setup";
}

function addVerifiedOrigin(origins: Set<string>, data: Record<string, any>) {
  if (clean(data.status) !== "active" || clean(data.verificationStatus) !== "verified") return;
  const value = clean(data.wordpressOrigin || data.targetWpOrigin);
  if (!value) return;
  try { origins.add(new URL(value).origin); } catch { /* fail closed */ }
}

function normalizeWelcomeStatus(value: unknown): AuthorOnboardingQueueItem["welcomeEmailStatus"] {
  return value === "deferred" || value === "sending" || value === "sent" || value === "failed" ? value : "pending";
}

function maskStudioKey(value: string): string {
  return value.length <= 8 ? "****" : `${value.slice(0, 11)}****${value.slice(-4)}`;
}

function arrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.some((item) => clean(item) === expected);
}

function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function clean(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
