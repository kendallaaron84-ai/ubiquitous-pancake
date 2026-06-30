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
    const { bookTitle, fileUrl, coverUrl, bgImageUrl, type, price } = body;
    
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
    const assetKey = `abk_${authorSlug}_${cleanBookSlug}`;

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
    const syncPayload = {
      assetKey,
      bookTitle,
      streamUrl: discoveredFileUrl,
      coverArt: coverUrl,
      bgImage: bgImageUrl,
      type: type || "Audiobook",
      price: price?.toString() || "0.00"
    };

    // 4. Send to WordPress
    const wpPublishUrl = `http://koba-dev.local/wp-json/kobai/v1/update-chapter-audio`;
    const wpResponse = await fetch(wpPublishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-KOBA-KEY": "JUBI-TEST-1234-5678" },
      body: JSON.stringify(syncPayload)
    });

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