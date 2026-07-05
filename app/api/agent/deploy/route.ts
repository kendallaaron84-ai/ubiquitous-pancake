// app/api/agent/deploy/route.ts
import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import path from "path";
import fs from "fs";
import { adminStorage } from '@/core/firebase-admin';

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      assetKey: passedAssetKey, 
      bookTitle, 
      fileUrl, 
      coverUrl, 
      bgImageUrl, 
      type, 
      price, 
      studioTracks, 
      ebookPayload 
    } = body;
    
    // 1. Initialize Admin SDK (Production Ready)
    if (getApps().length === 0) {
      if (process.env.FIREBASE_PRIVATE_KEY) {
        // Production: Use secure environment variables
        initializeApp({
          credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // Handle newline characters in the private key string
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
        });
      } else {
        // Local Fallback: Use the file system
        const keyPath = path.resolve(process.cwd(), "secrets/firebase-service-account.json");
        if (fs.existsSync(keyPath)) {
          initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) });
        } else {
           throw new Error("Fatal: Missing Firebase credentials.");
        }
      }
    }

    const adminDb = getFirestore();
    const authorSlug = "kendall"; 
    const cleanBookSlug = bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, '');
    const assetKey = passedAssetKey || `abk_${authorSlug}_${cleanBookSlug}`;

    // 2. Storage Initialization (Locate the audio/media file)
    const storage = getStorage(); 
    const bucket = adminStorage.bucket();
    
    const folderPrefix = `studio/${assetKey}/`;
    const [files] = await bucket.getFiles({ prefix: folderPrefix });

    let discoveredFileUrl = fileUrl || "";
    if (files.length > 0 && !discoveredFileUrl) {
        const file = files.sort((a, b) => b.metadata.updated.localeCompare(a.metadata.updated))[0];
        const [url] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });
        discoveredFileUrl = url;
        console.log("🛠️ Auto-linked media file:", discoveredFileUrl);
    }

    // 3. Construct and Upsert the Firestore Product Schema
    try {
      const productDocRef = adminDb.collection("products").doc(assetKey);
      const existingProductDoc = await productDocRef.get();
      const existingProductData = existingProductDoc.exists ? existingProductDoc.data() : {};

      const dbProductData = {
        assetKey,
        title: bookTitle,
        bookTitle: bookTitle, // keep both for safety
        coverUrl: coverUrl || "",
        coverArtUrl: coverUrl || "",
        bgImageUrl: bgImageUrl || "",
        bgImage: bgImageUrl || "",
        type: type || "Audiobook",
        price: price?.toString() || "0.00",
        // Notice we are defaulting to lowercase "active" to match the Public API's strict check
        visibility: "active", 
        status: "Active", 
        streamUrl: discoveredFileUrl || "",
        studioTracks: studioTracks || existingProductData?.studioTracks || [],
        ebookPayload: ebookPayload || existingProductData?.ebookPayload || null,
        authorSlug: authorSlug,
        authorName: existingProductData?.authorName || "Kendall Aaron",
        stripeConnectId: existingProductData?.stripeConnectId || "acct_1TdEzNAfHyixYIkp",
        synopsis: existingProductData?.synopsis || "Sovereign Publication Asset",
        
        // 🚀 NEW: Ensure the Studio Key is attached so the WordPress Catalog can find it
        studioKey: existingProductData?.studioKey || "JUBI-TEST-1234-5678", 
        updatedAt: new Date().toISOString()
      };

      await productDocRef.set(dbProductData, { merge: true });
      console.log("🔥 Successfully upserted Firestore products document for:", assetKey);
      
    } catch (dbErr: any) {
      console.warn("⚠️ Bypassed Firestore products upsert, continuing sync:", dbErr.message);
      return NextResponse.json({ error: "Failed to write to database", details: dbErr.message }, { status: 500 });
    }

    // 4. Return Success to the Agent (No Ngrok, No WordPress Webhooks)
    // The moment Firestore is updated, the WordPress site will naturally pull the new data
    // the next time a user loads the page via the Public API.
    return NextResponse.json({ 
      success: true, 
      message: "Deployment complete. Asset is now live in the Firestore catalog.",
      assetKey: assetKey
    }, { status: 200 });

  } catch (error: any) {
    console.error("❌ Agent Deploy API Error:", error);
    return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
  }
}