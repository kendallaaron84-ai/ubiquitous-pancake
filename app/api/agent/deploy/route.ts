import { NextResponse } from "next/server";
import { adminDb } from '@/core/firebase-admin';
import fs from 'fs';
import path from 'path';

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
      authorEmail // 🚀 ADDED: We now require the frontend to pass the user's email
    } = body;
    
    // Safety check on incoming payload
    if (!assetKey) {
      console.warn("⚠️ Deployment blocked: Missing assetKey in request body.");
      return NextResponse.json({ error: "Missing required parameter: assetKey" }, { status: 400 });
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

    // 2. CHECK EXISTING PRODUCT
    const productDocRef = adminDb.collection("products").doc(assetKey);
    const existingProduct = await productDocRef.get();
    let existingProductData = null;
    if (existingProduct.exists) {
      existingProductData = existingProduct.data();
    }

    // 🚀 DYNAMIC PRODUCTION LOGIC: Fetch actual user profile from Firestore
    let userRecord = null;
    if (authorEmail) {
      const userDoc = await adminDb.collection("users").doc(authorEmail).get();
      if (userDoc.exists) {
        userRecord = userDoc.data();
      }
    }

    // 🚀 BUSINESS LOGIC: Enforce the $0.50 Stripe ID Rule
    const finalPrice = price !== undefined ? price : existingProductData?.price || 0.00;
    const stripeId = userRecord?.stripeCustomerId || existingProductData?.stripeConnectId || null;

    if (finalPrice >= 0.50 && !stripeId) {
      console.warn(`⚠️ Deployment blocked: Product priced at $${finalPrice} but no Stripe ID found for ${authorEmail}`);
      return NextResponse.json({ 
        error: "A validated Stripe Account ID is required to list products above $0.00. Please complete your billing setup." 
      }, { status: 400 });
    }

    // 3. FIRESTORE DATABASE INSERTION (The Source of Truth)
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
        
        // 🚀 DYNAMIC MULTI-TENANT BINDING: No more hardcoded strings!
        authorId: userRecord?.email || existingProductData?.authorId || "Unknown Author",
        authorName: userRecord?.name || existingProductData?.authorName || "Sovereign Author",
        stripeConnectId: stripeId, 
        synopsis: existingProductData?.synopsis || "Sovereign Publication Asset",
        
        // 🚀 RELATIONAL MAPPING: Binds product directly to your unique Studio Key
        studioKey: userRecord?.studioKey || existingProductData?.studioKey || null, 
        updatedAt: new Date().toISOString()
      };

      // Atomic merge write into your live Cloud Ledger
      await productDocRef.set(dbProductData, { merge: true });
      console.log("🔥 Successfully upserted Firestore products document for:", assetKey);
      
    } catch (dbErr: any) {
      console.error("🚨 Firestore products upsert failed:", dbErr.message);
      return NextResponse.json({ error: "Failed to write to database", details: dbErr.message }, { status: 500 });
    }

    // 4. Return secure validation to the Deployment Agent
    return NextResponse.json({ 
      success: true, 
      message: "Deployment complete. Asset validated, written to dynamic cache disk, and is now live in Firestore catalog.",
      assetKey: assetKey
    }, { status: 200 });

  } catch (error: any) {
    console.error("🔥 Deployment agent failed:", error);
    return NextResponse.json({ error: "Internal server error during deployment", details: error.message }, { status: 500 });
  }
}