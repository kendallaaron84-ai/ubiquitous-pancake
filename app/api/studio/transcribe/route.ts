import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";

import { adminDb } from "@/core/firebase-admin";
import {
  StudioPublicationAccessError,
  loadOwnedStudioProduct,
} from "@/core/security/studio-publication-access";
import { requireStudioAuthorContext } from "@/core/security/studio-publication-session";
import { createTranscriptionQuote } from "@/core/transcription";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class RouteError extends Error {
  constructor(readonly status: number, readonly publicMessage: string) {
    super(publicMessage);
  }
}

export async function GET(request: Request) {
  try {
    const context = await requireStudioAuthorContext(adminDb);
    const assetId = new URL(request.url).searchParams.get("assetId")?.trim() || "";
    const { product } = await loadOwnedStudioProduct(adminDb, context, assetId);
    const quote = createTranscriptionQuote(product);
    return NextResponse.json({
      success: true,
      quote,
      transcriptionStatus: String(product.transcriptionStatus || "not_started"),
      transcriptionError: String(product.transcriptionError || ""),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireStudioAuthorContext(adminDb);
    const session = context.session;
    const body = (await request.json().catch(() => null)) as { assetId?: unknown } | null;
    const assetId = typeof body?.assetId === "string" ? body.assetId.trim() : "";
    const { product } = await loadOwnedStudioProduct(adminDb, context, assetId);
    const studioKey = context.studioKey;
    const quote = createTranscriptionQuote(product);
    if (quote.pendingTrackCount === 0) {
      throw new RouteError(409, "Every uploaded chapter already has a transcript.");
    }
    if (quote.missingDurationTrackCount > 0 || quote.amountCents < 1) {
      throw new RouteError(
        422,
        "Chapter duration is unavailable. Reattach the affected audio file so the Studio can calculate an accurate transcription price."
      );
    }

    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) throw new RouteError(503, "Transcription checkout is temporarily unavailable.");
    const stripe = new Stripe(secretKey);
    const applicationOrigin = resolveApplicationOrigin(request);
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: session.email,
      client_reference_id: session.uid,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: quote.amountCents,
          product_data: {
            name: `Full Audiobook Transcription — ${String(product.title || assetId)}`,
            description: `${quote.billableHours} billable hour${quote.billableHours === 1 ? "" : "s"} at $1.00/hour`,
          },
        },
      }],
      metadata: {
        checkoutType: "author_transcription",
        assetId,
        studioKey,
        authorEmail: session.email,
        amountCents: String(quote.amountCents),
        totalDurationSeconds: String(quote.totalDurationSeconds),
      },
      success_url: `${applicationOrigin}/studio/${encodeURIComponent(assetId)}?transcription_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${applicationOrigin}/studio/${encodeURIComponent(assetId)}?transcription=cancelled`,
    });
    if (!checkout.url) throw new RouteError(502, "Stripe did not return a checkout address.");

    await adminDb.collection("transcription_orders").doc(checkout.id).set({
      checkoutSessionId: checkout.id,
      checkoutType: "author_transcription",
      assetId,
      studioKey,
      authorEmail: session.email,
      authorUid: session.uid,
      amountCents: quote.amountCents,
      totalDurationSeconds: quote.totalDurationSeconds,
      billableHours: quote.billableHours,
      status: "awaiting_payment",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, checkoutUrl: checkout.url, quote });
  } catch (error) {
    console.error("Transcription checkout failed:", error);
    return routeErrorResponse(error);
  }
}

function resolveApplicationOrigin(request: Request): string {
  const configured = process.env.KOBA_DASHBOARD_URL?.trim();
  const parsed = new URL(configured || new URL(request.url).origin);
  if (!/^https?:$/.test(parsed.protocol)) throw new RouteError(500, "Dashboard URL configuration is invalid.");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new RouteError(500, "Production transcription checkout requires HTTPS.");
  }
  return parsed.origin;
}

function routeErrorResponse(error: unknown) {
  if (error instanceof StudioPublicationAccessError) {
    return NextResponse.json(
      { success: false, code: error.code, error: error.publicMessage },
      { status: error.status }
    );
  }
  if (error instanceof RouteError) {
    return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
  }
  return NextResponse.json({ success: false, error: "Transcription service is unavailable." }, { status: 500 });
}
