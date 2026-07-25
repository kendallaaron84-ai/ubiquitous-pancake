import { FieldValue } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { adminDb } from "@/core/firebase-admin";
import {
  AuthorIdentityError,
  PRIMARY_AUTHOR_IDENTITY_ID,
  requireAuthorizedAuthorIdentity,
} from "@/core/security/author-identity";
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ASSET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;
const MAX_SYNOPSIS_LENGTH = 12_000;

interface ProductPatchBody {
  synopsis?: unknown;
  description?: unknown;
  authorIdentityId?: unknown;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const sessionToken = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    if (!sessionToken) {
      return NextResponse.json({ success: false, error: "Authentication is required." }, { status: 401 });
    }
    const session = await verifyDashboardSession(
      sessionToken,
      resolveDashboardSessionSecret()
    ).catch(() => null);
    if (!session) {
      return NextResponse.json({ success: false, error: "Your dashboard session is invalid or expired." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!ASSET_KEY_PATTERN.test(id)) {
      return NextResponse.json({ success: false, error: "A valid product ID is required." }, { status: 400 });
    }
    const body = (await request.json().catch(() => null)) as ProductPatchBody | null;
    const source = typeof body?.synopsis === "string"
      ? body.synopsis
      : typeof body?.description === "string"
        ? body.description
        : null;
    const synopsis = source === null
      ? null
      : source.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
    if (synopsis !== null && synopsis.length > MAX_SYNOPSIS_LENGTH) {
      return NextResponse.json({ success: false, error: "The synopsis is too long." }, { status: 400 });
    }

    const reference = adminDb.collection("products").doc(id);
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
    }
    const product = snapshot.data() || {};
    const productStudioKey = String(product.studioKey || product.wpStudioKey || "").trim();
    const productAuthor = String(product.authorEmail || product.authorId || "").trim().toLowerCase();
    if (
      (!session.studioKey || productStudioKey !== session.studioKey) &&
      productAuthor !== session.email.trim().toLowerCase()
    ) {
      return NextResponse.json({ success: false, error: "This product belongs to another author workspace." }, { status: 403 });
    }

    if (!productStudioKey || productStudioKey !== session.studioKey) {
      return NextResponse.json({ success: false, error: "This product is not bound to your active StudioKey." }, { status: 403 });
    }

    const requestedIdentityId = typeof body?.authorIdentityId === "string"
      ? body.authorIdentityId.trim()
      : typeof product.authorIdentityId === "string" && product.authorIdentityId.trim()
        ? product.authorIdentityId.trim()
        : PRIMARY_AUTHOR_IDENTITY_ID;
    const identity = await requireAuthorizedAuthorIdentity(
      adminDb,
      productStudioKey,
      session.email,
      requestedIdentityId
    );

    await reference.update({
      ...(synopsis === null ? {} : { synopsis, description: synopsis }),
      authorIdentityId: identity.id,
      authorName: identity.displayName,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const updated = await reference.get();
    return NextResponse.json({
      success: true,
      product: { id: updated.id, ...(updated.data() || {}) },
    });
  } catch (error) {
    if (error instanceof AuthorIdentityError) {
      return NextResponse.json(
        { success: false, code: error.code, error: error.publicMessage },
        { status: error.status }
      );
    }
    console.error("Product synopsis update failed:", error);
    return NextResponse.json({ success: false, error: "The synopsis could not be saved." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const sessionToken = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    if (!sessionToken) {
      return NextResponse.json({ success: false, error: "Authentication is required." }, { status: 401 });
    }
    const session = await verifyDashboardSession(
      sessionToken,
      resolveDashboardSessionSecret()
    ).catch(() => null);
    if (!session?.studioKey) {
      return NextResponse.json({ success: false, error: "Your dashboard session is invalid or expired." }, { status: 401 });
    }
    const { id } = await context.params;
    if (!ASSET_KEY_PATTERN.test(id)) {
      return NextResponse.json({ success: false, error: "A valid product ID is required." }, { status: 400 });
    }
    const reference = adminDb.collection("products").doc(id);
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
    }
    const product = snapshot.data() || {};
    const productStudioKey = String(product.studioKey || product.wpStudioKey || "").trim();
    const productAuthor = String(product.authorEmail || product.authorId || "").trim().toLowerCase();
    if (
      productStudioKey !== session.studioKey ||
      productAuthor !== session.email.trim().toLowerCase()
    ) {
      return NextResponse.json({ success: false, error: "This product belongs to another author workspace." }, { status: 403 });
    }
    await reference.delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Product deletion failed:", error);
    return NextResponse.json({ success: false, error: "The product could not be deleted." }, { status: 500 });
  }
}
