// app/api/agent/deploy/route.ts
import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage"; // 🚀 FIXED: Imported from firebase-admin/storage
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { assetKey: passedAssetKey, bookTitle, fileUrl, coverUrl, bgImageUrl, type, price, studioTracks, ebookPayload } = body;
    
    // 1. Initialize Admin SDK
    if (getApps().length === 0) {
      const keyPath = path.resolve(process.cwd(), "secrets/firebase-service-account.json");
      if (fs.existsSync(keyPath)) {
        initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) });
      } else {
        initializeApp({ projectId: "jubilee-command-center---dev" });
      }
    }

    const adminDb = getFirestore();
    const authorSlug = "kendall"; 
    const cleanBookSlug = bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, '');
    const assetKey = passedAssetKey || `abk_${authorSlug}_${cleanBookSlug}`;

    // 2. Storage Initialization (Correct way for Admin SDK)
    const storage = getStorage(); 
    // 🚀 FIXED: Point explicitly to your known bucket name
    const bucket = storage.bucket("jubilee-command-center---dev.firebasestorage.app");
    
    const folderPrefix = `studio/${assetKey}/`;
    const [files] = await bucket.getFiles({ prefix: folderPrefix });

    let discoveredFileUrl = fileUrl || "";
    if (files.length > 0 && !discoveredFileUrl) {
        const file = files.sort((a, b) => b.metadata.updated.localeCompare(a.metadata.updated))[0];
        const [url] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });
        discoveredFileUrl = url;
        console.log("🛠️ Auto-linked media file:", discoveredFileUrl);
    }

    // 3. Construct Payload
    const syncPayload: any = {
      assetKey,
      bookTitle,
      bookSlug: assetKey, // 🚀 NEW: Dynamic slug/routing matching assetKey
      streamUrl: discoveredFileUrl,
      coverArt: coverUrl,
      bgImage: bgImageUrl,
      type: type || "Audiobook",
      price: price?.toString() || "0.00"
    };

    if (studioTracks) {
      syncPayload.studioTracks = studioTracks;
    }
    if (ebookPayload) {
      syncPayload.ebookPayload = ebookPayload;
    }

    // 🚀 NEW: Re-align the Local Database with the Firestore Product Schema
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
        status: "Active", // 🚀 REQUIRED: "Active" with capital "A" matches .where("status", "==", "Active")
        streamUrl: discoveredFileUrl || "",
        studioTracks: studioTracks || existingProductData?.studioTracks || [],
        ebookPayload: ebookPayload || existingProductData?.ebookPayload || null,
        authorSlug: authorSlug,
        authorName: existingProductData?.authorName || "Kendall",
        stripeConnectId: existingProductData?.stripeConnectId || "acct_1TdEzNAfHyixYIkp",
        synopsis: existingProductData?.synopsis || "Sovereign Publication Asset",
        updatedAt: new Date().toISOString()
      };

      await productDocRef.set(dbProductData, { merge: true });
      console.log("🔥 Successfully upserted Firestore products document for:", assetKey);
    } catch (dbErr: any) {
      console.warn("⚠️ Bypassed Firestore products upsert, continuing sync:", dbErr.message);
    }

    // 4. Send to WordPress (supporting both ngrok and local fallback)
    let wpPublishUrl = `https://barbecue-scuff-scale.ngrok-free.dev/wp-json/kobai/v1/update-chapter-audio`;
    let wpResponse;
    try {
      console.log("🚀 Dispatched payload to ngrok:", wpPublishUrl);
      wpResponse = await fetch(wpPublishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-KOBA-KEY": "JUBI-TEST-1234-5678" },
        body: JSON.stringify(syncPayload)
      });
      if (!wpResponse.ok) {
        throw new Error(`WordPress ngrok error status: ${wpResponse.status}`);
      }
    } catch (err: any) {
      console.log(`⚠️ Ngrok error (${err.message}). Falling back to local koba-dev.local...`);
      wpPublishUrl = `http://koba-dev.local/wp-json/kobai/v1/update-chapter-audio`;
      wpResponse = await fetch(wpPublishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-KOBA-KEY": "JUBI-TEST-1234-5678" },
        body: JSON.stringify(syncPayload)
      });
    }

    if (!wpResponse.ok) {
        const text = await wpResponse.text();
        throw new Error(`WordPress error: ${text.substring(0, 100)}`);
    }

    return NextResponse.json({ success: true, streamUrl: discoveredFileUrl });
  } catch (error: any) {
    console.error("❌ Deploy Crash:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}