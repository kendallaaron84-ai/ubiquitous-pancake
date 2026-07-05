import { NextResponse } from 'next/server';
import { adminDb } from '@/core/firebase-admin';

export const dynamic = 'force-dynamic';

// 1. Mandatory CORS Headers for Cross-Origin WordPress Requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // Allows the WP site to connect
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key, Authorization, Origin',
};

// 2. Preflight OPTIONS Handler
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// 3. The Core Verification Gate
export async function POST(request: Request) {
  try {
    // Intercept the Studio Key sent by shortcodes-v2.php
    const studioKey = request.headers.get('x-studio-key');
    const body = await request.json().catch(() => ({}));
    const { assetId, domain } = body; 

    // Safety Gate 1: Check for the key
    if (!studioKey) {
      console.warn('⚠️ Entitlement verification blocked: Missing X-Studio-Key header.');
      return NextResponse.json(
        { error: 'Missing X-Studio-Key header. Unauthorized.' },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    // Safety Gate 2: Check for the assetId
    if (!assetId) {
      return NextResponse.json(
        { error: 'Missing assetId in request payload.' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Parse incoming origin domain
    const referer = request.headers.get('referer');
    const requestOrigin = request.headers.get('origin');
    
    let clientDomain = domain || requestOrigin || referer || '';
    if (clientDomain) {
      try {
        const parsedUrl = new URL(clientDomain);
        clientDomain = parsedUrl.origin; // Normalize to e.g., "https://my-wordpress-site.com"
      } catch (e) {
        clientDomain = clientDomain.replace(/\/$/, '').trim();
      }
    }

    // 4. Query Firestore for the license document
    const licenseRef = adminDb.collection('licenses').doc(studioKey);
    const licenseDoc = await licenseRef.get();

    // Safety Gate 3: Check if key exists
    if (!licenseDoc.exists) {
      return NextResponse.json(
        { error: 'Invalid Studio Key.' },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const licenseData = licenseDoc.data() || {};

    // Safety Gate 4: Check if active
    if (licenseData.status !== 'active') {
      return NextResponse.json(
        { error: 'This license key has been deactivated or suspended.' },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    // Safety Gate 5: Enforce Domain Locking
    const lockedWebsite = licenseData.associatedWebsite;
    if (lockedWebsite && clientDomain && clientDomain !== 'unknown') {
      if (clientDomain !== lockedWebsite) {
        console.warn(`🚨 Security Violation: Key ${studioKey} locked to ${lockedWebsite} attempted loading on ${clientDomain}!`);
        return NextResponse.json(
          { error: 'License violation. This license key is locked to another domain.' },
          { status: 403, headers: CORS_HEADERS }
        );
      }
    }

    // 5. Generate Secure Session Token
    const secureSessionToken = `koba-auth-${Math.random().toString(36).substring(2, 15)}`;

    return NextResponse.json({
      authorized: true,
      assetId: assetId,
      authorId: licenseData.authorId || null,
      sessionToken: secureSessionToken,
      message: "Entitlement verified successfully. Player unlocked."
    }, { 
      status: 200, 
      headers: CORS_HEADERS 
    });

  } catch (error: any) {
    console.error('🔥 Verify Entitlement API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}