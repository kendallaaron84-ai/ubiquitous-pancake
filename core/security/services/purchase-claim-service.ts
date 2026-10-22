import { normalizeReaderEmail, requireNonEmpty, sha256Id } from "../reader-contracts/index.ts";
import { appendReaderAuditEvent } from "./audit-service.ts";
import { createEntitlementInTransaction } from "./entitlement-service.ts";
import { readerPlatformCollections, serverTimestamp, type ReaderPlatformDb } from "./service-support.ts";

interface ClaimPendingPurchaseInput {
  claimId: string;
  readerUid: string;
  verifiedEmail: string;
  emailVerified: boolean;
  accountStatus: string;
  correlationId: string;
}

export async function claimPendingPurchase(
  db: ReaderPlatformDb,
  input: ClaimPendingPurchaseInput
): Promise<{ purchaseId: string; entitlementIds: string[]; replay: boolean }> {
  if (input.accountStatus !== "active") throw new Error("READER_ACCOUNT_NOT_ACTIVE");
  if (!input.emailVerified) throw new Error("READER_EMAIL_NOT_VERIFIED");

  const uid = requireNonEmpty(input.readerUid, "readerUid");
  const claimId = requireNonEmpty(input.claimId, "claimId");
  const claimRef = db.collection(readerPlatformCollections.claims).doc(claimId);
  const suppliedEmailHash = sha256Id(
    "reader-purchase-email",
    normalizeReaderEmail(input.verifiedEmail)
  );
  const result = { purchaseId: "", entitlementIds: [] as string[], replay: false };
  let accountSwitchRequired = false;

  await db.runTransaction(async (transaction) => {
    const claimSnapshot = await transaction.get(claimRef);
    if (!claimSnapshot.exists) throw new Error("PENDING_CLAIM_NOT_FOUND");
    const claim = claimSnapshot.data() || {};
    result.purchaseId = String(claim.purchaseId || "");

    if (claim.status === "claimed") {
      if (claim.claimedUid !== uid) throw new Error("PURCHASE_ALREADY_CLAIMED");
      result.entitlementIds = Array.isArray(claim.entitlementIds)
        ? claim.entitlementIds
        : [];
      result.replay = true;
      return;
    }

    const priorEntitlementIds = Array.isArray(claim.entitlementIds)
      ? claim.entitlementIds.filter(Boolean)
      : [];
    const isBlockedEmailMismatch =
      claim.status === "blocked" &&
      claim.blockedReason === "verified_email_mismatch" &&
      claim.manualReviewRequired === true;
    const isEligibleReconciliation =
      isBlockedEmailMismatch &&
      !String(claim.claimedUid || "").trim() &&
      priorEntitlementIds.length === 0 &&
      claim.purchaseEmailHash === suppliedEmailHash;

    const isUnclaimedBlockedEmailMismatch =
      isBlockedEmailMismatch &&
      !String(claim.claimedUid || "").trim() &&
      priorEntitlementIds.length === 0;

    if (
      isUnclaimedBlockedEmailMismatch &&
      claim.purchaseEmailHash !== suppliedEmailHash
    ) {
      throw new Error("PURCHASE_ACCOUNT_SWITCH_REQUIRED");
    }

    if (claim.status !== "unclaimed" && !isEligibleReconciliation) {
      throw new Error("PURCHASE_CLAIM_BLOCKED");
    }

    if (claim.status === "unclaimed" && claim.purchaseEmailHash !== suppliedEmailHash) {
      accountSwitchRequired = true;
      transaction.update(claimRef, {
        status: "blocked",
        manualReviewRequired: true,
        blockedReason: "verified_email_mismatch",
        updatedAt: serverTimestamp(),
      });
      await appendReaderAuditEvent(
        db,
        {
          eventType: "purchase_claim.blocked",
          actorType: "reader",
          actorId: uid,
          subjectType: "claim",
          subjectId: claimId,
          correlationId: input.correlationId,
          idempotencyKey: `email-mismatch:${uid}`,
          metadata: { reason: "verified_email_mismatch" },
        },
        transaction
      );
      return;
    }

    if (isEligibleReconciliation) {
      const existingEntitlements = await transaction.get(
        db
          .collection(readerPlatformCollections.entitlements)
          .where("purchaseId", "==", result.purchaseId)
      );
      if (!existingEntitlements.empty) throw new Error("PURCHASE_CLAIM_BLOCKED");
    }

    const items = await transaction.get(
      db
        .collection(readerPlatformCollections.purchaseItems)
        .where("purchaseId", "==", result.purchaseId)
        .where("status", "==", "paid")
    );
    if (items.empty) throw new Error("PURCHASE_HAS_NO_CLAIMABLE_ITEMS");

    const entitlementSnapshots = await Promise.all(
      items.docs.map((document) => {
        const item = document.data();
        const id = sha256Id(
          "reader-entitlement",
          uid,
          String(item.tenantId),
          String(item.assetId),
          document.id
        );
        return transaction.get(
          db.collection(readerPlatformCollections.entitlements).doc(id)
        );
      })
    );

    for (const [index, document] of items.docs.entries()) {
      const item = document.data();
      result.entitlementIds.push(
        await createEntitlementInTransaction(
          db,
          transaction,
          {
            readerUid: uid,
            tenantId: String(item.tenantId),
            assetId: String(item.assetId),
            purchaseId: result.purchaseId,
            purchaseLineItemId: document.id,
            source: "purchase",
            correlationId: input.correlationId,
          },
          entitlementSnapshots[index]
        )
      );
    }

    transaction.update(claimRef, {
      status: "claimed",
      claimedUid: uid,
      claimedAt: serverTimestamp(),
      entitlementIds: result.entitlementIds,
      manualReviewRequired: false,
      blockedReason: null,
      updatedAt: serverTimestamp(),
    });

    if (isEligibleReconciliation) {
      await appendReaderAuditEvent(
        db,
        {
          eventType: "purchase_claim.reconciled",
          actorType: "reader",
          actorId: uid,
          subjectType: "claim",
          subjectId: claimId,
          correlationId: `reconcile:${claimId}`,
          idempotencyKey: `verified-email:${uid}`,
          metadata: {
            purchaseId: result.purchaseId,
            reason: "verified_purchase_email",
          },
        },
        transaction
      );
    }

    await appendReaderAuditEvent(
      db,
      {
        eventType: "purchase_claim.claimed",
        actorType: "reader",
        actorId: uid,
        subjectType: "claim",
        subjectId: claimId,
        correlationId: input.correlationId,
        idempotencyKey: `claimed:${uid}`,
        metadata: {
          purchaseId: result.purchaseId,
          entitlementCount: result.entitlementIds.length,
        },
      },
      transaction
    );
  });

  if (accountSwitchRequired) {
    throw new Error("PURCHASE_ACCOUNT_SWITCH_REQUIRED");
  }
  return result;
}
