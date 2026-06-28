// app/api/agent/deploy/route.ts
import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore"; 
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const authorEmail = body.authorEmail || "kendallaaron84@gmail.com";
    const bookTitle = body.bookTitle || body.title || "Untitled Sovereign Publication Asset";
    const statusState = body.status || "Active"; 
    const price = body.price !== undefined && body.price !== null && body.price !== "" ? body.price.toString() : "0.00";
    const type = body.type || "Audiobook";
    const synopsis = body.synopsis || "";
    const sections = body.sections || ["Featured Publications"];
    const coverUrl = body.coverUrl || body.coverArtUrl || "";
    const bgImageUrl = body.bgImageUrl || "";

    if (!authorEmail || !bookTitle) {
      return NextResponse.json({ success: false, error: "Missing core deployment identifiers." }, { status: 400 });
    }

    if (getApps().length === 0) {
      const keyPath = path.resolve(process.cwd(), "secrets/firebase-service-account.json");
      if (fs.existsSync(keyPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
        initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
      } else {
        initializeApp({ projectId: "jubilee-command-center---dev" });
      }
    }

    const adminDb = getFirestore();
    const authorSlug = "kendall"; 
    const cleanBookSlug = bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, '');
    const assetKey = `abk_${authorSlug}_${cleanBookSlug}`;

    // 🚀 CONSOLIDATION ROUTINE: Harvest studio tracks and stripe properties from split documents
    let consolidatedTracks = [];
    let consolidatedStripeId = body.stripeConnectId || "";
    
    const productsRef = adminDb.collection("products");
    const querySnapshot = await productsRef.where("assetKey", "==", assetKey).get();
    
    for (const doc of querySnapshot.docs) {
      if (doc.id !== assetKey) {
        const docData = doc.data();
        if (docData.studioTracks && docData.studioTracks.length > 0) {
          consolidatedTracks = docData.studioTracks;
        }
        if (docData.stripeConnectId) {
          consolidatedStripeId = docData.stripeConnectId;
        }
        // Delete temporary upload duplicate draft to keep data clean
        await productsRef.doc(doc.id).delete();
      }
    }

    const writePayload: any = {
      id: assetKey,
      assetKey: assetKey,
      authorSlug: authorSlug,
      authorEmail: authorEmail,
      title: bookTitle,
      price: price,
      type: type, 
      synopsis: synopsis,
      status: statusState, 
      sections: sections,
      coverArtUrl: coverUrl,
      bgImageUrl: bgImageUrl,
      stripeConnectId: consolidatedStripeId,
      studioTracks: consolidatedTracks, // Safe merge assignment
      createdAt: new Date().toISOString()
    };

    // Commit consolidated master row to Firestore
    await productsRef.doc(assetKey).set(writePayload, { merge: true });

    // Format unified parameters for WordPress handoff
    const syncPayload = {
      authorEmail: "dev-email@wpengine.local",
      author_slug: authorSlug,
      bookTitle: bookTitle,
      title: bookTitle,
      bookSlug: cleanBookSlug.replace(/_/g, '-'),
      slug: cleanBookSlug.replace(/_/g, '-'),
      assetKey: assetKey,
      asset_key: assetKey,
      koba_asset_key: assetKey,
      coverArt: coverUrl,
      cover_url: coverUrl,
      bgImage: bgImageUrl,
      bg_image: bgImageUrl,
      type: type, 
      price: price
    };

    let targetWpDomain = "koba-dev.local"; 
    const wpPublishUrl = `http://${targetWpDomain}/wp-json/kobai/v1/update-chapter-audio`;

    const wpResponse = await fetch(wpPublishUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-KOBA-KEY": "JUBI-TEST-1234-5678" 
      },
      body: JSON.stringify(syncPayload)
    });

    let wpResult = { success: false, message: "No initial bridge tracking captured." };
    const contentType = wpResponse.headers.get("content-type");

    if (wpResponse.ok && contentType && contentType.includes("application/json")) {
      wpResult = await wpResponse.json();
    } else {
      const errorText = await wpResponse.text();
      return NextResponse.json({
        success: false,
        error: "WordPress destination server dropped an invalid format.",
        details: errorText.substring(0, 200)
      }, { status: 502 });
    }

    return NextResponse.json({ success: true, assetKey: assetKey, wpDeployment: wpResult }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}