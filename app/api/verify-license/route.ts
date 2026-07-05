import { NextResponse } from 'next/server';
import { adminDb } from '@/core/firebase-admin';

export const dynamic = 'force-dynamic';

// 1. Mandatory CORS Headers for Cross-Origin WordPress Requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // Allows any client WordPress domain to make the handshake
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key, Authorization, Origin',
};

// 2. Preflight OPTIONS Handler (Crucial for bypassing browser cross-origin blocks)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// 3. The Core Verification & Domain-Locking Gate
export async function POST(request: Request) {
  try {
    // Intercept the Studio Key sent by the WordPress plugin activation settings
    const studioKey = request.headers.get('x-studio-key');
    
    // Parse the payload to find out who is knocking on our door
    const body = await request.json().catch(() => ({}));
    const { domain } = body; // The WP plugin can pass its home URL (e.g., "https://my-wordpress-site.com")

    // Safety Gate 1: Check for the key
    if (!studioKey) {
      console.warn('⚠️ License verification blocked: Missing X-Studio-Key header.');
      return NextResponse.json(
        { error: 'Missing X-Studio-Key header. Unauthorized.' },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    // Determine the origin/domain making the request to lock/verify the license
    const referer = request.headers.get('referer');
    const requestOrigin = request.headers.get('origin');
    
    // Fallback order: Explicitly passed domain in body -> Origin Header -> Referer Header -> "Unknown Site"
    let clientDomain = domain || requestOrigin || referer || '';
    
    // Clean up domain (remove paths, query parameters, trailing slashes, and protocol if necessary)
    if (clientDomain) {
      try {
        const parsedUrl = new URL(clientDomain);
        clientDomain = parsedUrl.origin; // e.g., "https://my-wordpress-site.com"
      } catch (e) {
        // Fallback to raw string cleaning if URL parsing fails
        clientDomain = clientDomain.replace(/\/$/, '').trim();
      }
    }

    console.log(`🔑 Verification request received for Key: ${studioKey} from Site: ${clientDomain}`);

    // 4. Query Firestore for the corresponding license doc
    const licenseRef = adminDb.collection('licenses').doc(studioKey);
    const licenseDoc = await licenseRef.get();

    // Safety Gate 2: Verify the key exists in our database
    if (!licenseDoc.exists) {
      console.warn(`❌ Key ${studioKey} does not exist in our registry.`);
      return NextResponse.json(
        { error: 'Invalid license key. This key does not exist.' },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const licenseData = licenseDoc.data();

    // Safety Gate 3: Check if the license is globally active
    if (!licenseData || licenseData.status !== 'active') {
      console.warn(`⚠️ Key ${studioKey} is registered but has status: ${licenseData?.status || 'unknown'}`);
      return NextResponse.json(
        { error: 'This license key is currently inactive or suspended.' },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    // 5. Intelligent Domain Locking (Multi-Tenant Protection)
    const currentLockedWebsite = licenseData.associatedWebsite;

    if (!currentLockedWebsite) {
      // SCENARIO A: The key is fresh and has never been activated. Lock it to this domain!
      if (clientDomain && clientDomain !== 'unknown') {
        console.log(`🔒 First activation: Locking License [${studioKey}] to Domain: ${clientDomain}`);
        
        await licenseRef.update({
          associatedWebsite: clientDomain,
          activatedAt: new Date().toISOString()
        });
      } else {
        console.warn(`⚠️ Fresh license key activation received with no identifiable domain.`);
      }
    } else {
      // SCENARIO B: The key is already locked to a website. Check if this request is authorized!
      if (clientDomain && clientDomain !== currentLockedWebsite) {
        console.warn(`🚨 Security Violation: Key ${studioKey} is locked to ${currentLockedWebsite}, but request came from ${clientDomain}!`);
        return NextResponse.json(
          { 
            error: 'License violation. This key is already active on another website. Please contact support to release the domain lock.',
            lockedTo: currentLockedWebsite
          },
          { status: 403, headers: CORS_HEADERS }
        );
      }
    }

    // 6. Return Secure Authorization Token
    return NextResponse.json({
      authorized: true,
      licenseType: licenseData.type || 'audiobook_plugin',
      authorId: licenseData.authorId || null,
      authorEmail: licenseData.authorEmail || null,
      associatedWebsite: clientDomain || currentLockedWebsite || null,
      activatedAt: licenseData.activatedAt || new Date().toISOString(),
      message: "License verified successfully. Premium features activated."
    }, { 
      status: 200, 
      headers: CORS_HEADERS 
    });

  } catch (error: any) {
    console.error('🔥 Verify License Handshake Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}