import { NextResponse } from "next/server";
import { adminDb } from '@/core/firebase-admin';

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      assetKey, 
      bookTitle, 
      fileUrl, 
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
    
    // Safety check on incoming payload
    if (!assetKey) {
      return NextResponse.json({ error: "Missing required parameter: assetKey" }, { status: 400 });
    }

    if (!authorEmail) {
      return NextResponse.json({ error: "Missing required session parameters: authorEmail" }, { status: 400 });
    }

    // 1. PREFIX ENFORCEMENT
    const mediaType = type || "audiobook";
    const expectedPrefix = mediaType === "ebook" ? "ebk_" : "abk_";
    
    if (!assetKey.startsWith(expectedPrefix)) {
      const errorMsg = `Prefix enforcement violation: Asset key "${assetKey}" must start with "${expectedPrefix}".`;
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    // 2. FETCH CORE USER RECORD
    const userDocRef = adminDb.collection("users").doc(authorEmail);
    const userDoc = await userDocRef.get();
    let userData = userDoc.exists ? userDoc.data() : null;

    const resolvedStudioKey = userData?.studioKey || "KOBA-AUDIO-E63DC9CA";
    const resolvedWebsite = associatedWebsite || userData?.associatedWebsite || null;

    // 3. ENFORCE STRIPE BILLING
    const finalPrice = price !== undefined ? Number(price) : 0.00;
    const resolvedStripeId = stripeConnectId || userData?.stripeConnectId || userData?.stripeCustomerId || null;

    if (finalPrice >= 0.50) {
      if (!resolvedStripeId) {
        return NextResponse.json({ 
          error: "A validated Stripe Connect Account ID is required to publish products priced at $0.50 or above." 
        }, { status: 400 });
      }

      if (stripeConnectId && stripeConnectId !== userData?.stripeConnectId) {
        await userDocRef.set({ stripeConnectId, stripeCustomerId: stripeConnectId }, { merge: true });
      }
    }

    if (associatedWebsite && associatedWebsite !== userData?.associatedWebsite) {
      await userDocRef.set({ associatedWebsite }, { merge: true });
    }

    // 4. CHECK EXISTING PRODUCT
    const productDocRef = adminDb.collection("products").doc(assetKey);
    const existingProduct = await productDocRef.get();
    let existingProductData = null;
    if (existingProduct.exists) {
      existingProductData = existingProduct.data();
    }

    const cleanedTitle = bookTitle || existingProductData?.title || "Sovereign Work";

    // 5. AGENTIC AUTOMATION: AUTO-CREATE WORDPRESS PUBLICATION PAGE
    // Uses Stefan's corporate IP pass technique to seamlessly update Siteground hosts
    if (resolvedWebsite && resolvedWebsite.trim() !== "") {
      try {
        const wpBaseUrl = resolvedWebsite.replace(/\/$/, "");
        
        const publicationPayload = {
          title: cleanedTitle,
          slug: assetKey, // 🎯 Enforces the precise auto-generated ID (abk_4sklqfl) as the URL path slug!
          status: "publish",
          meta: {
            koba_associated_asset_key: assetKey,
            koba_studio_access_key: resolvedStudioKey
          }
        };

        console.log(`📡 Agentic Engine dispatching layout node straight to: ${wpBaseUrl}/wp-json/wp/v2/koba_publication`);

        await fetch(`${wpBaseUrl}/wp-json/wp/v2/koba_publication`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Studio-Key": resolvedStudioKey
          },
          body: JSON.stringify(publicationPayload)
        });
      } catch (automationErr: any) {
        console.error("⚠️ Non-blocking WordPress agent injection delay:", automationErr.message);
      }
    }

    // 6. FIRESTORE DATABASE INSERTION (Unified Record Matching)
    let dbProductData: any = {};
    try {
      dbProductData = {
        id: assetKey,
        assetKey: assetKey,
        title: cleanedTitle,
        coverUrl: coverUrl || existingProductData?.coverUrl || "",
        coverArtUrl: coverUrl || existingProductData?.coverArtUrl || "", // Maps across layout formats
        bgImageUrl: bgImageUrl || existingProductData?.bgImageUrl || "",
        type: mediaType,
        price: finalPrice,
        studioTracks: studioTracks || existingProductData?.studioTracks || [],
        ebookPayload: ebookPayload || existingProductData?.ebookPayload || null,
        
        authorId: authorEmail,
        authorEmail: authorEmail,
        authorName: userData?.name || existingProductData?.authorName || "Kendall Aaron",
        stripeConnectId: resolvedStripeId, 
        synopsis: existingProductData?.synopsis || "Sovereign Publication Asset",
        status: status || existingProductData?.status || "draft",
        
        studioKey: resolvedStudioKey, 
        wpStudioKey: resolvedStudioKey, 
        associatedWebsite: resolvedWebsite,
        updatedAt: new Date().toISOString()
      };

      await productDocRef.set(dbProductData, { merge: true });
      
    } catch (dbErr: any) {
      console.error("🚨 Firestore products upsert failed:", dbErr.message);
      return NextResponse.json({ error: "Failed to write to database", details: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: "Deployment complete. Remote canvas synchronized cleanly.",
      assetKey: assetKey
    }, { status: 200 });

  } catch (error: any) {
    console.error("🔥 Deployment agent failed:", error);
    return NextResponse.json({ error: "Internal server error during deployment", details: error.message }, { status: 500 });
  }
}