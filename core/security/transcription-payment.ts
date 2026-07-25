import { randomUUID } from "node:crypto";

import {
  FieldValue,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import type Stripe from "stripe";

import { dispatchAudiobookTranscriptionTask } from "@/core/cloud-tasks";
import { adminDb } from "@/core/firebase-admin";

export async function processAuthorTranscriptionPayment(
  event: Stripe.Event,
  session: Stripe.Checkout.Session
): Promise<{ jobId: string; taskName: string }> {
  if (session.status !== "complete" || session.payment_status !== "paid") {
    throw new Error("Transcription access requires a completed, paid Stripe session.");
  }
  const assetId = clean(session.metadata?.assetId);
  const studioKey = clean(session.metadata?.studioKey);
  const orderReference = adminDb.collection("transcription_orders").doc(session.id) as DocumentReference;
  const jobReference = adminDb.collection("transcription_jobs").doc(session.id) as DocumentReference;
  const productReference = adminDb.collection("products").doc(assetId) as DocumentReference;

  const locked = await adminDb.runTransaction(async (transaction: Transaction) => {
    const [orderSnapshot, jobSnapshot, productSnapshot] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(jobReference),
      transaction.get(productReference),
    ]);
    if (!orderSnapshot.exists || !productSnapshot.exists) {
      throw new Error("The transcription order or audiobook no longer exists.");
    }
    const order = orderSnapshot.data() || {};
    const product = productSnapshot.data() || {};
    const productStudioKey = clean(product.studioKey || product.wpStudioKey);
    if (
      order.checkoutType !== "author_transcription" ||
      clean(order.assetId) !== assetId ||
      clean(order.studioKey) !== studioKey ||
      productStudioKey !== studioKey ||
      Number(order.amountCents) !== Number(session.amount_total)
    ) {
      throw new Error("Stripe payment does not match the server transcription order.");
    }

    const existingJob = jobSnapshot.data() || {};
    const attemptId = clean(existingJob.transcriptionAttemptId) || randomUUID();
    transaction.set(jobReference, {
      jobId: session.id,
      jobType: "audiobook_transcription",
      transcriptionAttemptId: attemptId,
      assetId,
      studioKey,
      authorEmail: clean(order.authorEmail).toLowerCase(),
      status: existingJob.status === "completed" ? "completed" : "queued",
      amountCents: Number(order.amountCents),
      totalDurationSeconds: Number(order.totalDurationSeconds),
      stripeSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      stripeEventId: event.id,
      paidAt: existingJob.paidAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(orderReference, {
      status: "paid",
      stripeEventId: event.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      paidAt: order.paidAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(productReference, {
      transcriptionStatus: existingJob.status === "completed" ? "completed" : "queued",
      transcriptionJobId: session.id,
      transcriptionError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { attemptId, completed: existingJob.status === "completed" };
  });

  if (locked.completed) return { jobId: session.id, taskName: "completed" };
  try {
    const dispatched = await dispatchAudiobookTranscriptionTask({
      jobType: "audiobook_transcription",
      jobId: session.id,
      transcriptionAttemptId: locked.attemptId,
      assetId,
      studioKey,
    });
    await jobReference.set({
      cloudTaskName: dispatched.taskName,
      dispatchedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { jobId: session.id, taskName: dispatched.taskName };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription worker dispatch failed.";
    await Promise.all([
      jobReference.set({ status: "dispatch_failed", error: message.slice(0, 500), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      productReference.set({ transcriptionStatus: "worker_offline", transcriptionError: "Payment received, but the transcription worker is offline.", updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    throw error;
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
