// app/api/publications/[id]/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 🔥 DYNAMIC RUNTIME IMPORT: Keeps Firebase completely isolated from the build compiler
    const admin = require("firebase-admin");

    if (!admin || !admin.apps || !admin.apps.length) {
      try {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      } catch (e) {
        console.warn("⚠️ Firebase Admin fallback initialization triggered during build pass.");
        return NextResponse.json({ message: "Database offline during build check." }, { status: 500 });
      }
    }

    const db = admin.firestore();

    // Fetch live publication data straight from your Firebase cloud ledger
    const docRef = db.collection("products").doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json({ message: "Publication profile missing." }, { status: 404 });
    }

    const data = docSnap.data();
    const isEbook = data?.type === "E-Book";

    // 🎙️ Map Audiobook Studio Tracks if applicable
    const chaptersPayload = (data?.studioTracks || []).map((track: any) => ({
      id: track.id,
      title: track.title,
      url: track.url || track.securedPlaybackUrl || `https://storage.googleapis.com/koba-ai-processing-vault/audio-sources/${track.fileName}`,
      transcript_file_url: track.transcriptUrl || "" 
    }));

    // 📖 Handle Sovereign E-Book Payload Structure dynamically
    const ebookPayload = data?.ebookPayload || {
      fontPreference: "Atkinson Hyperlegible",
      chapters: [
        {
          id: `${id}_ebk_ch1`,
          title: "Chapter 1: Rain-Slicked Subnets",
          textContent: "The corporate neon reflected heavily in the pooling oil along the lower balcony floors..."
        }
      ]
    };

    // Output formatting cleanly matched to feed bloom-player.js seamlessly
    return NextResponse.json({
      id: docSnap.id,
      title: data?.title || "Sovereign Audio Delivery",
      authorName: data?.authorName || "Unknown Author",
      type: data?.type || "Audiobook", // 'Audiobook' or 'E-Book'
      coverArtUrl: data?.coverArtUrl || data?.image || "",
      bgImageUrl: data?.bgImageUrl || data?.image || "",
      
      // Asset Arrays
      chapters: chaptersPayload,
      ebookPayload: {
        fontPreference: ebookPayload.fontPreference || "Atkinson Hyperlegible",
        chapters: ebookPayload.chapters || []
      }
    });

  } catch (error: any) {
    console.error("❌ Publications Dynamic Route Error:", error);
    return NextResponse.json({ error: "Secure sync tunnel interrupted." }, { status: 500 });
  }
}