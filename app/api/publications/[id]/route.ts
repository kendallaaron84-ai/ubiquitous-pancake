import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 1. Production CORS Headers for Cross-Origin Player Communication
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // Permits authorized browsers to fetch track details
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key, Authorization, Origin',
};

// 2. Preflight OPTIONS Handler
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 🔥 DYNAMIC RUNTIME IMPORT: Keeps Firebase isolated from the static build engine
    const admin = require("firebase-admin");

    if (!admin || !admin.apps || !admin.apps.length) {
      try {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      } catch (e) {
        console.warn("⚠️ Firebase Admin fallback initialization triggered during build pass.");
        return NextResponse.json({ message: "Database offline during build check." }, { status: 500, headers: CORS_HEADERS });
      }
    }

    const db = admin.firestore();

    // Fetch live validation data straight from your Firebase cloud ledger
    const docRef = db.collection("products").doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      console.warn(`⚠️ Publication lookup failed: Product ${id} not found.`);
      return NextResponse.json({ message: "Publication profile missing." }, { status: 404, headers: CORS_HEADERS });
    }

    const data = docSnap.data();

    // Map the studio schema into a format that bloom-player.js loops through out-of-the-box
    const chaptersPayload = (data?.studioTracks || []).map((track: any) => ({
      id: track.id,
      title: track.title,
      url: track.securedPlaybackUrl || `https://storage.googleapis.com/koba-ai-processing-vault/audio-sources/${track.fileName}`,
      transcript_file_url: track.transcriptUrl || "" // Bound tightly for EAA highlight support
    }));

    console.log(`📡 Serving publication feed for: "${data?.title || 'Sovereign Audio'}"`);

    // Output formatting matching koba-i-audio.php expectations
    return NextResponse.json({
      id: docSnap.id,
      title: data?.title || "Sovereign Audio Delivery",
      authorName: data?.authorName || "Unknown Author",
      coverArtUrl: data?.coverArtUrl || "",
      bgImageUrl: data?.bgImageUrl || "",
      chapters: chaptersPayload
    }, {
      status: 200,
      headers: CORS_HEADERS
    });

  } catch (error: any) {
    console.error("🔥 Publication Fetch Error:", error);
    return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500, headers: CORS_HEADERS });
  }
}