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
      studioTracks, 
      ebookPayload,
      authorEmail, // 🚀 Required: Dynamic session email passed from frontend
      stripeConnectId, // 🚀 Passed dynamically from user billing input/profile
      associatedWebsite // 🚀 Domain of the WordPress activation site
    } = body;
    
    // Safety check on incoming payload
    if (!assetKey) {
      console.warn("⚠️ Deployment blocked: Missing assetKey in request body.");
      return NextResponse.json({ error: "Missing required parameter: assetKey" }, { status: 400 });
    }

    if (!authorEmail) {
      console.warn("⚠️ Deployment blocked: Missing authorEmail in request body.");
      return NextResponse.json({ error: "Missing required session parameters: authorEmail" }, { status: 400 });
    }

    // 1. PREFIX ENFORCEMENT (Resolving Technical Debt & Layout Collisions)
    const mediaType = type || "audiobook";
    const expectedPrefix = mediaType === "ebook" ? "ebk_" : "abk_";
    
    if (!assetKey.startsWith(expectedPrefix)) {
      const errorMsg = `Prefix enforcement violation: Asset key "${assetKey}" must start with "${expectedPrefix}" for media type "${mediaType}".`;
      console.warn(`⚠️ Validation Failed: ${errorMsg}`);
      return NextResponse.json({ 
        error: errorMsg,
        requirements: {
          audiobook: "Must begin with 'abk_'",
          ebook: "Must begin with 'ebk_'"
        }
      }, { status: 400 });
    }

    // 2. FETCH CORE USER RECORD FOR DYNAMIC TENANT MAPPING
    const userDocRef = adminDb.collection("users").doc(authorEmail);
    const userDoc = await userDocRef.get();
    let userData = userDoc.exists ? userDoc.data() : null;

    // Resolve structural Keys
    const resolvedStudioKey = userData?.studioKey || "KOBA-AUDIO-E63DC9CA";
    const resolvedWebsite = associatedWebsite || userData?.associatedWebsite || null;

    // 3. ENFORCE STRIPE BILLING & $0.50 PRICING RULE
    const finalPrice = price !== undefined ? Number(price) : 0.00;
    
    // Resolve Stripe Connect ID (Payload -> User Profile -> Existing Product Metadata)
    const resolvedStripeId = stripeConnectId || userData?.stripeConnectId || userData?.stripeCustomerId || null;

    if (finalPrice >= 0.50) {
      if (!resolvedStripeId) {
        console.warn(`⚠️ Deployment blocked: Product priced at $${finalPrice} but no Stripe Account ID is associated with ${authorEmail}`);
        return NextResponse.json({ 
          error: "A validated Stripe Connect Account ID is required to publish products priced at $0.50 or above. Please configure your billing setup." 
        }, { status: 400 });
      }

      // 🚀 SAVE ONCE ON FIRST CREATION: Write newly provided Stripe IDs back to user document permanently
      if (stripeConnectId && stripeConnectId !== userData?.stripeConnectId) {
        console.log(`💾 Persisting Stripe Connect Account ID (${stripeConnectId}) to profile: ${authorEmail}`);
        await userDocRef.set({ 
          stripeConnectId: stripeConnectId,
          stripeCustomerId: stripeConnectId // Align all developer alias fields
        }, { merge: true });
      }
    }

    // Persist associated website domain if provided in the deploy call
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

    // 5. FIRESTORE DATABASE INSERTION (The Source of Truth)
    let dbProductData: any = {};
    try {
      dbProductData = {
        id: assetKey,
        title: bookTitle || existingProductData?.title || "Sovereign Work",
        coverArtUrl: coverUrl || existingProductData?.coverArtUrl || "",
        bgImageUrl: bgImageUrl || existingProductData?.bgImageUrl || "",
        type: mediaType,
        price: finalPrice,
        studioTracks: studioTracks || existingProductData?.studioTracks || [],
        ebookPayload: ebookPayload || existingProductData?.ebookPayload || null,
        
        // 🚀 DYNAMIC MULTI-TENANT BINDINGS
        authorId: authorEmail,
        authorEmail: authorEmail, // 🚀 FIRES BOTH KEYWORDS TO PREVENT FRONTEND SNAPSHOT DROPS
        authorName: userData?.name || existingProductData?.authorName || "Kendall Aaron",
        stripeConnectId: resolvedStripeId, 
        synopsis: existingProductData?.synopsis || "Sovereign Publication Asset",
        status: existingProductData?.status || "draft",
        
        // 🚀 RELATIONAL MAPPING
        studioKey: resolvedStudioKey, 
        wpStudioKey: resolvedStudioKey, // Ensure WordPress shortcode queries match perfectly
        associatedWebsite: resolvedWebsite,
        updatedAt: new Date().toISOString()
      };

      // Atomic merge write into your live Cloud Ledger
      await productDocRef.set(dbProductData, { merge: true });
      console.log(`🔥 Successfully deployed dynamic product metadata for ${assetKey} scoped to StudioKey: ${resolvedStudioKey}`);
      
    } catch (dbErr: any) {
      console.error("🚨 Firestore products upsert failed:", dbErr.message);
      return NextResponse.json({ error: "Failed to write to database", details: dbErr.message }, { status: 500 });
    }

    // 6. Return secure validation to the Deployment Agent
    return NextResponse.json({ 
      success: true, 
      message: "Deployment complete. Dynamic product asset catalog record has been established successfully.",
      assetKey: assetKey,
      studioKey: resolvedStudioKey,
      stripeConnectId: resolvedStripeId,
      associatedWebsite: resolvedWebsite
    }, { status: 200 });

  } catch (error: any) {
    console.error("🔥 Deployment agent failed:", error);
    return NextResponse.json({ error: "Internal server error during deployment", details: error.message }, { status: 500 });
  }
}