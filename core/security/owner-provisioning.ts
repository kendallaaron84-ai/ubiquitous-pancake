import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

type OwnerInput = {
  email: string;
  uid: string;
  displayName?: string;
  userData?: Record<string, unknown>;
};

function ownerEmails(): Set<string> {
  return new Set(
    (process.env.KOBA_OWNER_EMAILS || "")
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function ownerStudioKey(email: string): string {
  return `KOBA-OWNER-${createHash("sha256").update(email).digest("hex").slice(0, 16).toUpperCase()}`;
}

async function findLegacyLicense(db: Firestore, email: string) {
  for (const field of ["authorEmail", "authorId", "email"]) {
    try {
      const result = await db.collection("licenses").where(field, "==", email).limit(1).get();
      if (!result.empty) return result.docs[0];
    } catch {
      // A missing index or legacy schema should not prevent owner bootstrap.
    }
  }
  return null;
}

/** Idempotently gives configured platform owners a full workspace license. */
export async function ensureOwnerWorkspace(db: Firestore, input: OwnerInput) {
  const email = input.email.trim().toLowerCase();
  if (!ownerEmails().has(email)) return null;

  const existingUser = input.userData || {};
  const legacy = await findLegacyLicense(db, email);
  const legacyData = legacy?.data() || {};
  const studioKey =
    String(existingUser.studioKey || legacyData.studioKey || legacy?.id || ownerStudioKey(email)).trim();
  const displayName = input.displayName || String(existingUser.displayName || legacyData.authorName || email);
  const licenseRef = db.collection("plugin_licenses").doc(studioKey);
  const current = await licenseRef.get();
  const currentData = current.data() || {};
  const entitlements = Array.from(new Set([
    ...(Array.isArray(currentData.entitlements) ? currentData.entitlements : []),
    "audiobook_plugin", "ereader_plugin", "content_engine", "blog_engine", "transcription",
  ]));
  const features = Array.from(new Set([
    ...(Array.isArray(currentData.features) ? currentData.features : []),
    ...entitlements,
  ]));

  await licenseRef.set({
    ...legacyData,
    studioKey,
    key: studioKey,
    email,
    authorEmail: email,
    authorId: input.uid,
    authorName: displayName,
    status: "active",
    tier: "bundle",
    licenseSource: legacy ? "legacy_owner_migration" : "owner_bootstrap",
    hasContentEngineAccess: true,
    hasBlogEngineAccess: true,
    entitlements,
    features,
    createdAt: currentData.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await licenseRef.collection("author_identities").doc("primary").set({
    displayName,
    normalizedName: normalizeName(displayName),
    type: "primary",
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const userData = {
    ...existingUser,
    email,
    uid: input.uid,
    displayName,
    accessScope: "full",
    studioKey,
    hasActiveLicense: true,
    hasContentEngineAccess: true,
    hasBlogEngineAccess: true,
    pluginEntitlements: entitlements,
    updatedAt: new Date().toISOString(),
  };
  await db.collection("users").doc(email).set(userData, { merge: true });
  console.log(`✅ Owner workspace reconciled: ${studioKey}`);
  return { studioKey, userData };
}
