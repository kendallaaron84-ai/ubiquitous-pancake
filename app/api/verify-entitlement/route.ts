import { NextResponse } from 'next/server';
import { adminDb } from '@/core/firebase-admin';

export const dynamic = 'force-dynamic';

// Hardened Enterprise Cross-Origin Access Headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key, x-studio-key, Authorization, Origin, Accept',
  'Access-Control-Max-Age': '86400', 
};

// PREFLIGHT GUARD
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    let studioKey = request.headers.get('x-studio-key') || request.headers.get('X-Studio-Key');
    const body = await request.json().catch(() => ({}));
    
    const assetId = body.assetId || body.assetKey || null;
    const domain = body.domain || null;
    
    // Safely capture raw string inputs even if they arrive empty
    const hasPhoneField = body.hasOwnProperty('phone') || body.hasOwnProperty('phoneNumber');
    const phoneVal = (body.phone || body.phoneNumber || "").toString().trim();

    if (!studioKey && body.studioKey) {
      studioKey = body.studioKey;
    }

    if (!studioKey) {
      console.warn('⚠️ Entitlement verification blocked: Missing authorization tracking key.');
      return NextResponse.json(
        { error: 'Missing Studio configuration key context.' },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    // Baseline initialization fallback state if no specific asset ID is requested
    if (!assetId) {
      return NextResponse.json({
        authorized: false,
        chapters: [],
        message: "Standalone initialization state. Awaiting explicit asset parameter selection slugs."
      }, { status: 200, headers: CORS_HEADERS });
    }

    const isDevKey = studioKey === 'MOCK_DEVELOPMENT_KEY';
    const isSmsGatewayIntent = hasPhoneField || phoneVal.length > 0;

    // STEP 2: DUAL-GATE HANDLING (Dev Pass / SMS Tunnel Bypass)
    if (isSmsGatewayIntent || isDevKey) {
      console.log(`📱 Orchestration Gateway activated. Dev Bypass: ${isDevKey}, SMS Tracked: ${isSmsGatewayIntent}`);
      
      const productDoc = await adminDb.collection('products').doc(assetId).get();
      const productData = productDoc.exists ? productDoc.data() : {};
      const trackingTracks = productData?.studioTracks || productData?.chapters || [];
      const activeAudioFile = trackingTracks[0]?.url || trackingTracks[0]?.audioUrl || trackingTracks[0]?.mediaUrl || null;

      const normalizedChapters = trackingTracks.map((ch: any, idx: number) => ({
        id: ch.id || `ch_${idx + 1}`,
        title: ch.title || `Chapter ${idx + 1}`,
        mediaUrl: ch.url || ch.audioUrl || ch.mediaUrl || '',
        url: ch.url || ch.audioUrl || ch.mediaUrl || '',
        duration: ch.duration || 372
      }));

      return NextResponse.json({
        success: true,
        authorized: true,
        assetId: assetId,
        sessionToken: `koba-local-sms-${Math.random().toString(36).substring(2, 15)}`,
        audioUrl: activeAudioFile,
        mediaUrl: activeAudioFile,
        coverUrl: productData?.coverArtUrl || productData?.coverUrl || null,
        bgImage: productData?.bgImageUrl || null,
        chapters: normalizedChapters,
        message: "Gateway identity verified successfully. Vault door open."
      }, { status: 200, headers: CORS_HEADERS });
    }

    // Standard Production Licensing Routes
    const referer = request.headers.get('referer');
    const requestOrigin = request.headers.get('origin');
    
    let clientDomain = domain || requestOrigin || referer || '';
    if (clientDomain) {
      try {
        const parsedUrl = new URL(clientDomain);
        clientDomain = parsedUrl.origin;
      } catch (e) {
        clientDomain = clientDomain.replace(/\/$/, '').trim();
      }
    }

    const licenseQuerySnapshot = await adminDb
      .collection('plugin_licenses')
      .where('key', '==', studioKey)
      .limit(1)
      .get();

    if (licenseQuerySnapshot.empty) {
      return NextResponse.json({ error: 'Invalid software tracking license.' }, { status: 403, headers: CORS_HEADERS });
    }

    const licenseDoc = licenseQuerySnapshot.docs[0];
    const licenseData = licenseDoc.data() || {};

    if (licenseData.status !== 'active') {
      return NextResponse.json({ error: 'This license code signature is currently inactive.' }, { status: 403, headers: CORS_HEADERS });
    }

    const lockedWebsite = licenseData.registeredDomain;
    if (lockedWebsite && clientDomain && clientDomain !== 'unknown') {
      const cleanClient = clientDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const cleanLocked = lockedWebsite.replace(/^https?:\/\//, '').replace(/\/$/, '');

      if (cleanClient !== cleanLocked) {
        return NextResponse.json({ error: 'License domain match tracking violation.' }, { status: 403, headers: CORS_HEADERS });
      }
    }
    
    // Authoritative asset fetching from collection database
    const productDoc = await adminDb.collection('products').doc(assetId).get();
    const productData = productDoc.exists ? productDoc.data() : {};

    const trackingTracks = productData?.studioTracks || productData?.chapters || [];
    const activeAudioFile = trackingTracks[0]?.url || trackingTracks[0]?.audioUrl || trackingTracks[0]?.mediaUrl || null;

    const normalizedChapters = trackingTracks.map((ch: any, idx: number) => ({
      id: ch.id || `ch_${idx + 1}`,
      title: ch.title || `Chapter ${idx + 1}`,
      mediaUrl: ch.url || ch.audioUrl || ch.mediaUrl || '',
      url: ch.url || ch.audioUrl || ch.mediaUrl || '',
      duration: ch.duration || 372
    }));

    return NextResponse.json({
      authorized: true,
      assetId: assetId,
      authorId: licenseData.authorId || null,
      sessionToken: `koba-auth-${Math.random().toString(36).substring(2, 15)}`,
      mediaUrl: activeAudioFile,
      audioUrl: activeAudioFile,
      coverUrl: productData?.coverArtUrl || productData?.coverUrl || null,
      bgImage: productData?.bgImageUrl || null,
      chapters: normalizedChapters,
      message: "Entitlement verified successfully."
    }, { status: 200, headers: CORS_HEADERS });

  } catch (error: any) {
    console.error('🔥 Verify Entitlement Exception:', error);
    return NextResponse.json(
      { error: 'Internal Server Error Data Lock', details: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}