import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/core/firebase-admin";
import { hmacHex, normalizePhoneE164 } from "@/core/security/crypto";
import { signReaderToken } from "@/core/security/reader-token";
import { bindReaderEntitlements } from "@/core/security/reader-access";
import { FieldValue } from "firebase-admin/firestore";
import { decodeJwt } from "jose";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "http://koba-dev.local",
  "http://jubilee-author-1.local",
  "https://jubilee-author-1.local",
  "https://audio.koba-i.com",
  "https://www.audio.koba-i.com",
]);

function handleCors(
  request: NextRequest,
  responseHeaders: Record<string, string> = {}
): Record<string, string> {
  const origin = request.headers.get("origin") || "";

  if (ALLOWED_ORIGINS.has(origin)) {
    responseHeaders["Access-Control-Allow-Origin"] = origin;
  }

  responseHeaders.Vary = "Origin";
  responseHeaders["Access-Control-Allow-Methods"] =
    "GET, POST, OPTIONS";
  responseHeaders["Access-Control-Allow-Headers"] =
    "Content-Type, Authorization, X-WP-Nonce, X-Studio-Key, X-KOBAI-License-Key";

  return responseHeaders;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: handleCors(request),
  });
}

export async function POST(request: NextRequest) {
  const responseHeaders = handleCors(request, {
    "Content-Type": "application/json",
  });

  try {
    const body = await request.json().catch(() => ({}));

    const assetId = trimString(
      body.assetId || body.assetKey || ""
    );
    const rawPhone = trimString(
      body.phone || body.phoneNumber || ""
    );
    const suppliedOtp = trimString(
      body.code || body.otpCode || ""
    );
    const studioKey = trimString(
      request.headers.get("x-studio-key") ||
        request.headers.get("X-KOBAI-License-Key") ||
        body.studioKey ||
        ""
    );

    if (!assetId || !rawPhone || !suppliedOtp || !studioKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required tracking parameters within payload contract.",
        },
        { status: 400, headers: responseHeaders }
      );
    }

    let phoneE164: string;

    try {
      phoneE164 = normalizePhoneE164(rawPhone);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Enter a complete phone number in E.164 format, for example +12106878982.",
        },
        { status: 400, headers: responseHeaders }
      );
    }

    // Existing entitlement and reader-binding records use the digits-only
    // form. E.164 validation happens first so the country code is guaranteed.
    const normalizedPhone = phoneE164.slice(1);

    const entitlementId =
      `${studioKey}_${assetId}_${normalizedPhone}`;
    const entitlementDoc = await adminDb
      .collection("entitlements")
      .doc(entitlementId)
      .get();

    if (!entitlementDoc.exists) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Entitlement record signature not found inside active session registry.",
        },
        { status: 404, headers: responseHeaders }
      );
    }

    const entitlementData = entitlementDoc.data() || {};

    if (
      entitlementData.status !== "active" ||
      entitlementData.studioKey !== studioKey ||
      entitlementData.assetId !== assetId ||
      entitlementData.phoneNumber !== normalizedPhone
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Access Denied: Associated entitlement block is invalid or context mismatch detected.",
        },
        { status: 403, headers: responseHeaders }
      );
    }

    if (entitlementData.currentOtp !== suppliedOtp) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid Passcode: Supplied sequence does not match the issued token.",
        },
        { status: 401, headers: responseHeaders }
      );
    }

    if (!entitlementData.otpExpiresAt) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Access Refused: Entitlement data contains no valid expiration timestamp.",
        },
        { status: 401, headers: responseHeaders }
      );
    }

    const expirationTime = entitlementData.otpExpiresAt.toDate
      ? entitlementData.otpExpiresAt.toDate()
      : new Date(entitlementData.otpExpiresAt);

    if (
      Number.isNaN(expirationTime.getTime()) ||
      new Date() > expirationTime
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Expired Passcode: Issued challenge session timeline parameters have lapsed.",
        },
        { status: 401, headers: responseHeaders }
      );
    }

    const productDoc = await adminDb
      .collection("products")
      .doc(assetId)
      .get();

    if (!productDoc.exists) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Publication profile record matching this asset key was not found.",
        },
        { status: 404, headers: responseHeaders }
      );
    }

    const productData = productDoc.data() || {};
    const productStatus = normalizeLower(
      productData.status || ""
    );
    const isPublishedFlag = productData.isPublished === true;

    if (
      !isPublishedFlag &&
      !["published", "publish", "active"].includes(
        productStatus
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Access Restricted: The requested publication is not currently available.",
        },
        { status: 403, headers: responseHeaders }
      );
    }

    const rawMediaType = normalizeLower(
      productData.type || productData.mediaType || ""
    );
    const isAudiobookKey =
      assetId.startsWith("abk_") ||
      assetId.startsWith("aud_");

    let mediaType = "";

    if (["audio", "audiobook"].includes(rawMediaType)) {
      mediaType = "audiobook";
    } else if (rawMediaType === "" && isAudiobookKey) {
      mediaType = "audiobook";
    } else {
      return NextResponse.json(
        {
          success: false,
          error:
            "Crossover Fault: Target asset context cannot be safely verified as an audiobook profile stream.",
        },
        { status: 400, headers: responseHeaders }
      );
    }

    const rawTracks =
      Array.isArray(productData.studioTracks) &&
      productData.studioTracks.length > 0
        ? productData.studioTracks
        : Array.isArray(productData.chapters)
          ? productData.chapters
          : [];

    const normalizedChapters = rawTracks
      .map((track: any, index: number) => {
        const trackUrl = trimString(
          track.url ||
            track.audioUrl ||
            track.mediaUrl ||
            track.streamUrl ||
            track.src ||
            ""
        );

        return {
          id: trimString(track.id) || `track_${index + 1}`,
          title:
            trimString(track.title) || `Track ${index + 1}`,
          url: trackUrl,
          src: trackUrl,
          audioUrl: trackUrl,
          mediaUrl: trackUrl,
          textContent:
            track.textContent ||
            track.body ||
            track.content ||
            "",
          type: trimString(track.type) || "audio",
        };
      })
      .filter((track: { url: string }) => track.url !== "");

    if (normalizedChapters.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Manifest Failure: This publication contains no playable audio tracks.",
        },
        { status: 404, headers: responseHeaders }
      );
    }

    const primaryMediaUrl = normalizedChapters[0].url;
    const stripeSessionId = trimString(entitlementData.stripeSessionId);
    let readerToken = "";
    let expiresAt: number | null = null;

    // Only a durable Stripe-backed purchase may receive a persistent reader
    // token. The browser cache never upgrades an entitlement by itself.
    if (stripeSessionId) {
      const identityHashSecret = process.env.KOBA_IDENTITY_HASH_SECRET?.trim();
      if (!identityHashSecret) {
        throw new Error("READER_SECURITY_CONFIGURATION_MISSING");
      }
      const customerEmail = trimString(entitlementData.customerEmail).toLowerCase();
      const principalId = hmacHex(
        identityHashSecret,
        `reader:v1:${studioKey}:${normalizedPhone}:${customerEmail}`
      );
      const boundEntitlementCount = await bindReaderEntitlements(
        adminDb,
        {
          tenantId: studioKey,
          principalId,
          normalizedPhone,
        },
        identityHashSecret
      );
      if (boundEntitlementCount < 1) {
        throw new Error("READER_ENTITLEMENT_BINDING_FAILED");
      }
      readerToken = await signReaderToken({
        principalId,
        tenantId: studioKey,
      });
      const tokenExpiration = decodeJwt(readerToken).exp;
      if (!tokenExpiration) {
        throw new Error("READER_TOKEN_EXPIRATION_MISSING");
      }
      expiresAt = tokenExpiration * 1000;
    }

    await entitlementDoc.ref.update({
      currentOtp: FieldValue.delete(),
      otpExpiresAt: FieldValue.delete(),
      lastVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json(
      {
        success: true,
        authorized: true,
        assetId,
        title:
          productData.title || "Untitled Sovereign Audiobook",
        mediaType,
        coverUrl:
          productData.coverUrl ||
          productData.coverArtUrl ||
          "",
        coverArtUrl:
          productData.coverUrl ||
          productData.coverArtUrl ||
          "",
        bgImage:
          productData.bgImageUrl ||
          productData.bgImage ||
          "",
        chapters: normalizedChapters,
        audioUrl: primaryMediaUrl,
        mediaUrl: primaryMediaUrl,
        readerToken: readerToken || null,
        normalizedPhone,
        tenantId: studioKey,
        expiresAt,
      },
      { status: 200, headers: responseHeaders }
    );
  } catch (error: unknown) {
    console.error(
      "❌ [KOBA INTERNAL VERIFIER SYSTEM FAULT]:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Internal Server Error: Failed to process challenge verification parameters.",
      },
      { status: 500, headers: responseHeaders }
    );
  }
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLower(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}
