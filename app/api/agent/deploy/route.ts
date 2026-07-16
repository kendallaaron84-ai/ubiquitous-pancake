import { NextResponse } from "next/server";
import { adminDb } from '@/core/firebase-admin';

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key, x-studio-key, Authorization, Origin',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      bookTitle, 
      coverUrl, 
      bgImageUrl, 
      type, 
      price, 
      status, 
      studioTracks, 
      ebookPayload,
      authorEmail, 
      stripeConnectId, 
      associatedWebsite 
    } = body;
    
    // Core parameters validation
    if (!bookTitle) {
      return NextResponse.json({ error: "Missing required parameter: bookTitle" }, { status: 400, headers: CORS_HEADERS });
    }
    if (!authorEmail) {
      return NextResponse.json({ error: "Missing required session parameter: authorEmail" }, { status: 400, headers: CORS_HEADERS });
    }

    // 1. KOBA-I SEO SEMANTIC SLUG ENGINE
    const urlSafeTitleSlug = bookTitle
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "") 
      .replace(/\s+/g, "-")         
      .replace(/-+/g, "-");         

    const mediaType = type || "audiobook";
    const expectedPrefix = mediaType === "ebook" ? "ebk_" : "abk_";
    const canonicalSeoKey = `${expectedPrefix}${urlSafeTitleSlug}`;
    
    console.log(`🚀 SEO Engine Synced Canonical Target Key Map: ${canonicalSeoKey}`);

    // 2. FETCH CORE USER RECORD FOR METRIC BINDINGS
    const userDocRef = adminDb.collection("users").doc(authorEmail);
    const userDoc = await userDocRef.get();
    let userData = userDoc.exists ? userDoc.data() : null;

    const resolvedStudioKey = userData?.studioKey || userData?.wpStudioKey || "KOBA-AUDIO-E63DC9CA";
    
    let rawWebsiteInput = associatedWebsite || userData?.associatedWebsite || "";
    let resolvedWebsite = rawWebsiteInput.trim();
    if (resolvedWebsite && !/^https?:\/\//i.test(resolvedWebsite)) {
      resolvedWebsite = `http://${resolvedWebsite}`;
    }

    // 3. ENFORCE STRIPE CONNECT BILLING VERIFICATION
    const finalPrice = price !== undefined ? Number(price) : 0.00;
    const resolvedStripeId = stripeConnectId || userData?.stripeConnectId || userData?.stripeCustomerId || null;

    if (finalPrice >= 0.50 && !resolvedStripeId) {
      return NextResponse.json({ 
        error: "A validated Stripe Connect Account ID is required to publish products priced at $0.50 or above." 
      }, { status: 400, headers: CORS_HEADERS });
    }

    // 4. SYNC TO CENTRAL FIRESTORE CLUSTER (THE SINGLE SOURCE OF TRUTH)
    const productDocRef = adminDb.collection("products").doc(canonicalSeoKey);
    const existingProduct = await productDocRef.get();
    let existingProductData = existingProduct.exists ? existingProduct.data() : null;

    const dbProductData = {
      id: canonicalSeoKey,
      assetKey: canonicalSeoKey,
      title: bookTitle, 
      coverUrl: coverUrl || existingProductData?.coverUrl || "",
      coverArtUrl: coverUrl || existingProductData?.coverArtUrl || "", 
      bgImageUrl: bgImageUrl || existingProductData?.bgImageUrl || "",
      type: mediaType,
      price: finalPrice,
      studioTracks: studioTracks || existingProductData?.studioTracks || [],
      ebookPayload: ebookPayload || existingProductData?.ebookPayload || null,
      
      authorId: authorEmail,
      authorEmail: authorEmail,
      authorName: userData?.name || existingProductData?.authorName || "Kendall Aaron",
      stripeConnectId: resolvedStripeId, 
      synopsis: existingProductData?.synopsis || "Sovereign Publication Content Engine Asset.",
      status: status || existingProductData?.status || "published",
      
      studioKey: resolvedStudioKey, 
      wpStudioKey: resolvedStudioKey, 
      associatedWebsite: resolvedWebsite,
      updatedAt: new Date().toISOString()
    };

    await productDocRef.set(dbProductData, { merge: true });

    if (associatedWebsite && associatedWebsite !== userData?.associatedWebsite) {
      await userDocRef.set({ associatedWebsite: resolvedWebsite }, { merge: true });
    }

    return NextResponse.json({ 
      success: true, 
      message: "Deployment complete. Centralized database synchronized cleanly.",
      assetKey: canonicalSeoKey,
      seoSlug: canonicalSeoKey
    }, { status: 200, headers: CORS_HEADERS });

  } catch (error: any) {
    console.error("🔥 Deployment agent sync failure:", error);
    return NextResponse.json({ error: "Internal server error during deployment synchronization", details: error.message }, { status: 500, headers: CORS_HEADERS });
  }
}