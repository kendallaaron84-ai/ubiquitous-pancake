import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { hmacHex } from "@/core/security/crypto";

export interface BindReaderEntitlementsInput {
  tenantId: string;
  principalId: string;
  normalizedPhone: string;
}

export function readerAccessKeyId(
  secret: string,
  tenantId: string,
  principalId: string,
  assetKey: string
): string {
  return hmacHex(
    secret,
    `reader-access:v1:${tenantId}:${principalId}:${assetKey}`
  );
}

export async function bindReaderEntitlements(
  db: Firestore,
  input: BindReaderEntitlementsInput,
  secret: string
): Promise<number> {
  const snapshot = await db
    .collection("entitlements")
    .where("phoneNumber", "==", input.normalizedPhone)
    .limit(200)
    .get();
  const phoneHash = hmacHex(
    secret,
    `reader-phone:v1:${input.tenantId}:${input.normalizedPhone}`
  );
  const batch = db.batch();
  let boundCount = 0;

  for (const entitlementDocument of snapshot.docs) {
    const entitlement = entitlementDocument.data() || {};
    const entitlementTenant = String(
      entitlement.tenantKey || entitlement.studioKey || ""
    ).trim();
    const assetKey = String(
      entitlement.assetKey || entitlement.assetId || ""
    ).trim();
    if (
      entitlement.status !== "active" ||
      entitlementTenant !== input.tenantId ||
      !assetKey ||
      !String(entitlement.stripeSessionId || "").trim()
    ) {
      continue;
    }

    const accessKey = readerAccessKeyId(
      secret,
      input.tenantId,
      input.principalId,
      assetKey
    );
    const accessReference = db.collection("reader_access_keys").doc(accessKey);
    batch.set(
      accessReference,
      {
        tenantId: input.tenantId,
        principalId: input.principalId,
        assetKey,
        entitlementId: entitlementDocument.id,
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    batch.update(entitlementDocument.ref, {
      principalId: input.principalId,
      phoneHash,
      updatedAt: FieldValue.serverTimestamp(),
    });
    boundCount += 1;
  }

  if (boundCount > 0) await batch.commit();
  return boundCount;
}
