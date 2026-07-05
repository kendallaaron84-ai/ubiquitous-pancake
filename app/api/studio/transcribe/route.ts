// app/api/studio/transcribe/route.ts
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
// 🚀 FIXED: Imported the secure adminDb and adminStorage instances
import { adminDb, adminStorage } from '@/core/firebase-admin';

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // 1. We only need the assetId now to process the entire book
    const { assetId } = await request.json();

    if (!assetId) {
      return NextResponse.json({ success: false, message: "Missing asset identifier." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY; 
    if (!apiKey) {
      return NextResponse.json({ 
        success: false, 
        message: "Gemini API key missing. Please insert GEMINI_API_KEY into your .env.local file." 
      }, { status: 500 });
    }

    // ❌ DELETED: The entire dynamic require("firebase-admin") block.

    // 🚀 FIXED: Use the centralized instances directly
    const db = adminDb;
    const bucket = adminStorage.bucket();

    // 3. Retrieve the master asset and its tracks
    const productRef = db.collection("products").doc(assetId);
    const productDoc = await productRef.get();

    if (!productDoc.exists) {
      return NextResponse.json({ success: false, message: "Asset workspace not found." }, { status: 404 });
    }

    const productData = productDoc.data();
    const tracks = productData?.studioTracks || [];

    // Quick check to see if there is actually work to do
    const pendingTracks = tracks.filter((t: any) => !t.isTranscribed && (t.url || t.securedPlaybackUrl));
    
    if (pendingTracks.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: "All tracks are already transcribed or lack audio files.",
        processedCount: 0 
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    let processedCount = 0;
    let failedCount = 0;

    console.log(`⚡ Commencing batch transcription for ${pendingTracks.length} tracks on asset: ${assetId}`);

    // 4. Process each track sequentially to respect rate limits and memory
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const activeAudioUrl = track.url || track.securedPlaybackUrl;

      // Skip tracks that are already done or missing audio
      if (track.isTranscribed || !activeAudioUrl) continue;

      console.log(`📡 Ingesting audio buffer for Chapter ${track.chapterNumber}: ${track.title}`);

      try {
        const fileResponse = await fetch(activeAudioUrl);
        if (!fileResponse.ok) throw new Error("Failed to stream target track file from cloud cores.");
        const audioBuffer = await fileResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString("base64");

        const aiResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: { mimeType: "audio/mp3", data: base64Audio }
                },
                {
                  text: `Analyze this audio file and return a strict JSON object formatting transcription alignments. 
                  The response MUST be raw JSON matching this TypeScript schema definition exactly without Markdown wrappers:
                  
                  {
                    "success": true,
                    "transcriptText": "Full text string of audio",
                    "wordTimeline": [
                      { "word": "string", "start": 0.0, "end": 0.5 }
                    ]
                  }
                  
                  Calculate 'start' and 'end' parameters as floating-point timestamps in seconds relative to the audio track timeline.`
                }
              ]
            }
          ],
          config: { responseMimeType: "application/json" }
        });

        const rawJsonText = aiResponse.text;
        if (!rawJsonText) throw new Error("Gemini returned an empty transcription frame.");

        const parsedTranscriptionData = JSON.parse(rawJsonText.trim());

        // Write the specific JSON to the storage bucket
        const transcriptFileName = `transcripts/${assetId}_${track.id}.json`;
        const transcriptFile = bucket.file(transcriptFileName);

        await transcriptFile.save(JSON.stringify(parsedTranscriptionData), {
          contentType: "application/json",
          metadata: { cacheControl: "public, max-age=31536000" }
        });

        await transcriptFile.makePublic();
        const secureTranscriptUrl = `https://storage.googleapis.com/${bucket.name}/${transcriptFileName}`;

        // 5. Update the track object in memory with the new status and URL
        tracks[i].isTranscribed = true;
        tracks[i].transcriptUrl = secureTranscriptUrl;
        
        processedCount++;
        console.log(`✅ Successfully transcribed Chapter ${track.chapterNumber}`);

      } catch (err: any) {
        console.error(`❌ Failed to transcribe Chapter ${track.chapterNumber}:`, err.message);
        failedCount++;
        // The loop continues even if one chapter fails, protecting the rest of the batch
      }
    }

    // 6. Write the updated master track array back to Firestore
    if (processedCount > 0) {
      await productRef.update({
        studioTracks: tracks,
        updatedAt: new Date().toISOString()
      });
    }

    return NextResponse.json({
      success: true,
      message: `Batch processing complete. Successfully transcribed ${processedCount} tracks. Failed: ${failedCount}.`,
      processedCount,
      failedCount
    });

  } catch (error: any) {
    console.error("❌ Batch Transcription Pipeline Collapsed:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}