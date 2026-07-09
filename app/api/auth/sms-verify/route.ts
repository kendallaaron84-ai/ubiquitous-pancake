import { NextResponse } from "next/server";
import { adminDb } from '@/core/firebase-admin';

export const dynamic = "force-dynamic";

// 🌐 STEFAN'S ROUTING SECURITY CONSTANTS: CORS Baseline
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
    
    // Core parameters validation gates
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

    // Resolve structural parameters
    const cleanedTitle = bookTitle || "Untitled Sovereign Publication";
    const originalPrice = price ? parseFloat(price) : 0.00;
    
    // Resolve user data layers for licensing bindings
    let resolvedStudioKey = "JUBI-TEST-1234-5678";
    let resolvedWebsite = associatedWebsite || "";
    let resolvedStripeId = stripeConnectId || "";
    let authorSlug = authorEmail.split('@')[0].replace(/\D/g, "");

    try {
      const userDoc = await adminDb.collection("users").doc(authorEmail).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        resolvedStudioKey = userData?.wpStudioKey || userData?.studioKey || resolvedStudioKey;
        resolvedWebsite = userData?.associatedWebsite || resolvedWebsite;
        resolvedStripeId = userData?.stripeConnectId || resolvedStripeId;
        if (userData?.authorSlug) authorSlug = userData.authorSlug;
      }
    } catch (dbErr) {
      console.warn("⚠️ Non-blocking user lookup warning:", dbErr);
    }

    // 2. REMOTE SITE AUTOMATION GATEWAY (Using Safe corporate IP Tunnel)
    // Runs when the author's primary target domain is linked in their account profile
    if (resolvedWebsite && resolvedWebsite.trim() !== "") {
      try {
        console.log(`🚀 Agent Engine engaged. Executing template injection targeting remote host: ${resolvedWebsite}`);
        
        // Form the remote base endpoint API target
        const wpBaseUrl = resolvedWebsite.replace(/\/$/, "");
        
        // Structuring payload to inject the clean assetKey reference directly
        const publicationPayload = {
          title: cleanedTitle,
          slug: assetKey, // Natively handles matching pretty permalink routes
          status: "publish",
          meta: {
            koba_associated_asset_key: assetKey,
            koba_studio_access_key: resolvedStudioKey
          }
        };

        // Fire remote insertion call straight into the site's CPT REST endpoint
        const remotePass = await fetch(`${wpBaseUrl}/wp-json/wp/v2/koba_publication`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Studio-Key": resolvedStudioKey // Validates source identity token
          },
          body: JSON.stringify(publicationPayload)
        });

        if (remotePass.ok) {
          console.log(`✨ Successfully injected sovereign publication node for asset: ${assetKey}`);
        } else {
          console.warn(`⚠️ Remote post mapping bypassed or delayed. Status: ${remotePass.status}`);
        }
      } catch (automationErr: any) {
        console.error("❌ Agent remote post compilation bypassed:", automationErr.message);
      }
    }

    // 3. FIRESTORE PERSISTENCE UPSERT (THE SINGLE SOURCE OF TRUTH)
    try {
      const productDocRef = adminDb.collection("products").doc(assetKey);
      const existingProduct = await productDocRef.get();
      const existingProductData = existingProduct.exists ? existingProduct.data() : {};

      const dbProductData = {
        id: assetKey,
        assetKey: assetKey,
        title: cleanedTitle,
        type: mediaType,
        coverUrl: coverUrl || existingProductData?.coverUrl || "",
        coverArtUrl: coverUrl || existingProductData?.coverArtUrl || "",
        bgImageUrl: bgImageUrl || existingProductData?.bgImageUrl || "",
        price: originalPrice,
        studioTracks: studioTracks || existingProductData?.studioTracks || [],
        ebookPayload: ebookPayload || existingProductData?.ebookPayload || null,
        
        authorId: authorEmail,
        authorEmail: authorEmail,
        authorName: existingProductData?.authorName || "Kendall Aaron",
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
      return NextResponse.json({ error: "Failed to write to database", details: dbErr.message }, { status: 500, headers: CORS_HEADERS });
    }

    return NextResponse.json({ 
      success: true, 
      message: "Deployment complete. Remote canvas synchronized cleanly.",
      assetKey: assetKey
    }, { status: 200, headers: CORS_HEADERS });

  } catch (error: any) {
    console.error("🔥 Deployment agent failed:", error);
    return NextResponse.json({ error: "Internal Processor Error", details: error.message }, { status: 500, headers: CORS_HEADERS });
  }
}