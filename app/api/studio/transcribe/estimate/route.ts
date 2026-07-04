import { NextResponse } from "next/server";
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Business Rule: $1.00 per hour of audio
const PRICE_PER_HOUR = 1.00;

export async function POST(request: Request) {
  try {
    const { assetId, tenantKey } = await request.json();

    if (!assetId || !tenantKey) {
      return NextResponse.json({ success: false, message: "Missing asset identifier." }, { status: 400 });
    }

    const productRef = adminDb.collection("products").doc(assetId);
    const productDoc = await productRef.get();

    if (!productDoc.exists) {
      return NextResponse.json({ success: false, message: "Asset workspace not found." }, { status: 404 });
    }

    const productData = productDoc.data();
    const tracks = productData?.studioTracks || [];
    
    let totalSeconds = 0;
    let validTracksCount = 0;

    // Loop through tracks to sum duration (assuming duration is saved in metadata during upload)
    tracks.forEach((track: any) => {
      if (track.duration) {
        totalSeconds += parseFloat(track.duration);
        validTracksCount++;
      }
    });

    if (totalSeconds === 0) {
      return NextResponse.json({ 
        success: false, 
        message: "Could not calculate duration. Ensure audio files are fully uploaded to the Voice Vault." 
      }, { status: 400 });
    }

    // --- THE MATH ---
    const totalHours = totalSeconds / 3600;
    let estimatedCost = totalHours * PRICE_PER_HOUR;
    
    // Minimum charge to cover baseline API overhead
    if (estimatedCost < 1.00) estimatedCost = 1.00;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds / 60) % 60);
    const timeString = `${hours}h ${minutes.toString().padStart(2, '0')}m`;

    return NextResponse.json({
      success: true,
      trackCount: validTracksCount,
      durationFormatted: timeString,
      totalSeconds,
      estimatedCost: estimatedCost.toFixed(2),
      currencySymbol: '$'
    });

  } catch (error: any) {
    console.error("❌ Estimation Engine Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}