// app/api/library-manifest/route.ts
import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (getApps().length === 0) {
      const keyPath = path.resolve(process.cwd(), "secrets/firebase-service-account.json");
      if (fs.existsSync(keyPath)) {
        initializeApp({
          credential: cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))),
          projectId: "jubilee-command-center---dev"
        });
      }
    }

    const db = getFirestore();
    
    // 1. Fetch live products from your catalog database
    const snapshot = await db.collection("products").get();
    
    // 2. Map through records and structure fields for player canvases
    const manifest = snapshot.docs.map((doc) => {
      const data = doc.data();
      const isEbook = data.type === "E-Book";

      return {
        assetId: data.assetKey || doc.id,
        assetKey: data.assetKey || doc.id, 
        title: data.title || "Untitled",
        author: data.author || "Kendall O'Brian Aaron",
        type: data.type || "Audiobook", 
        price: data.price || "0.00",
        description: data.synopsis || data.description || "",
        pubDate: data.pubDate || "2026",
        coverArt: data.coverArtUrl || data.image || "", 
        bgImage: data.bgImageUrl || data.image || "",
        streamUrl: data.fileUrl || "",

        chaptersCount: isEbook 
          ? (data.ebookPayload?.chapters?.length || 0)
          : (data.studioTracks?.length || 0),
        
        chapters: !isEbook ? (data.studioTracks || []) : [],
        
        ebookPayload: isEbook ? {
          fontPreference: data.ebookPayload?.fontPreference || "Atkinson Hyperlegible",
          chapters: data.ebookPayload?.chapters || []
        } : null
      };
    });

    // 3. Process buyer profile entitlements if logged in via modern device signature
    let ownedAssets: string[] = [];
    if (userId && userId !== "unknown") {
      const entitlementsSnapshot = await db.collection("entitlements")
        .where("userId", "==", userId)
        .where("status", "==", "active")
        .get();
        
      ownedAssets = entitlementsSnapshot.docs.map(doc => doc.data().assetKey);
    }

    return NextResponse.json({ manifest, ownedAssets }, {
      headers: {
        "Access-Control-Allow-Origin": "http://koba-dev.local",
        "Access-Control-Allow-Credentials": "true"
      }
    });

  } catch (error: any) {
    console.error("❌ Library Manifest Engine Error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}