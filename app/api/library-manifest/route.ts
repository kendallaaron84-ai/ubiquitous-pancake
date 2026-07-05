import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 1. Mandatory CORS Headers for WordPress Library Feeds
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
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

// 3. The Multi-Tenant Library Index Builder
export async function GET(request: Request) {
  try {
    // Intercept the Studio Key passed by the client WordPress Library layout
    const studioKey = request.headers.get('x-studio-key');

    if (!studioKey) {
      console.warn('⚠️ Library request blocked: Missing X-Studio-Key header.');
      return NextResponse.json(
        { error: 'Missing X-Studio-Key header. Unauthorized.' },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    // 🔥 DYNAMIC RUNTIME IMPORT: For Next.js static build isolation
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

    // 4. Resolve the Owner (Author) of this License
    const licenseDoc = await db.collection('licenses').doc(studioKey).get();

    if (!licenseDoc.exists) {
      console.warn(`❌ Invalid license key accessed library catalog: ${studioKey}`);
      return NextResponse.json(
        { error: 'Invalid license key.' },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const licenseData = licenseDoc.data() || {};

    if (licenseData.status !== 'active') {
      return NextResponse.json(
        { error: 'This license is inactive.' },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const authorId = licenseData.authorId;

    if (!authorId) {
      return NextResponse.json(
        { error: 'License key is not bound to a valid author profile.' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // 5. Query Products Collection scoped strictly to this Author
    // Multi-tenant isolation: ensures Sharon never sees Mary's books!
    const productsSnapshot = await db.collection('products')
      .where('authorId', '==', authorId)
      .get();

    const libraryItems: any[] = [];

    productsSnapshot.forEach((doc: any) => {
      const data = doc.data();
      // Only include items that are marked as ready/published
      if (data.status === 'published' || data.isPublished !== false) {
        libraryItems.push({
          id: doc.id,
          title: data.title || 'Untitled Work',
          authorName: data.authorName || licenseData.authorName || 'Sovereign Author',
          coverArtUrl: data.coverArtUrl || '',
          description: data.description || '',
          type: data.type || 'audiobook', // audiobook or ebook
          duration: data.duration || null,
          chapterCount: (data.studioTracks || []).length
        });
      }
    });

    console.log(`📚 Served ${libraryItems.length} books for Author: ${licenseData.authorEmail}`);

    return NextResponse.json({
      success: true,
      authorName: licenseData.authorName || 'Sovereign Author',
      books: libraryItems
    }, {
      status: 200,
      headers: CORS_HEADERS
    });

  } catch (error: any) {
    console.error('🔥 Library Manifest API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}