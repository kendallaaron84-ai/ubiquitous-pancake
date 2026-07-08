import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key, Authorization, Origin',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const authorEmailParam = searchParams.get('author')?.trim();
    const studioKey = request.headers.get('x-studio-key');

    const admin = require("firebase-admin");
    const db = admin.firestore();
    
    let catalogItems: any[] = [];
    let authorDisplayName = 'Sovereign Author';

    // 🚀 SCENARIO A: Request originates from your autonomous WordPress shortcode
    if (authorEmailParam) {
      console.log(`🔍 Headless Data Hub: Fetching items for author email: ${authorEmailParam}`);

      const productsSnapshot = await db.collection('products')
        .where('authorEmail', '==', authorEmailParam)
        .get();

      productsSnapshot.forEach((doc: any) => {
        const data = doc.data();
        if (data.status === 'published' || data.isPublished !== false) {
          catalogItems.push({
            id: doc.id,
            assetKey: data.assetKey || doc.id,
            title: data.title || 'Untitled Work',
            price: parseFloat(data.price || 0),
            type: data.type || 'audiobook',
            coverUrl: data.coverUrl || data.coverArtUrl || '',
            synopsis: data.synopsis || data.description || '',
            accentColor: data.accentColor || '#f97316',
            sections: data.sections || ['Featured Publications']
          });
        }
      });
      
      authorDisplayName = authorEmailParam.split('@')[0];
    } 
    // 🔒 SCENARIO B: Dashboard internal workspace request via license keys
    else if (studioKey) {
      console.log(`🔑 License verification path: ${studioKey}`);
      const licenseDoc = await db.collection('licenses').doc(studioKey).get();

      if (!licenseDoc.exists) {
        return NextResponse.json({ error: 'Invalid license key.' }, { status: 403, headers: CORS_HEADERS });
      }

      const licenseData = licenseDoc.data() || {};
      const authorId = licenseData.authorId;

      if (!authorId) {
        return NextResponse.json({ error: 'License profile unlinked.' }, { status: 400, headers: CORS_HEADERS });
      }

      const productsSnapshot = await db.collection('products')
        .where('authorId', '==', authorId)
        .get();

      productsSnapshot.forEach((doc: any) => {
        const data = doc.data();
        if (data.status === 'published' || data.isPublished !== false) {
          catalogItems.push({
            id: doc.id,
            assetKey: data.assetKey || doc.id,
            title: data.title || 'Untitled Work',
            price: parseFloat(data.price || 0),
            type: data.type || 'audiobook',
            coverUrl: data.coverUrl || data.coverArtUrl || '',
            synopsis: data.synopsis || data.description || '',
            accentColor: data.accentColor || '#f97316',
            sections: data.sections || ['Featured Publications']
          });
        }
      });

      authorDisplayName = licenseData.authorName || 'Sovereign Author';
    } else {
      return NextResponse.json({ error: 'Missing identifying context parameters.' }, { status: 400, headers: CORS_HEADERS });
    }

    // Returns structural compatibility payloads for all components
    return NextResponse.json({
      success: true,
      authorName: authorDisplayName,
      products: catalogItems, // Matches what jubilee-core.js tries to loop over
      books: catalogItems,    // Backwards tracking fallback
      entitlements: []
    }, {
      status: 200,
      headers: CORS_HEADERS
    });

  } catch (error: any) {
    console.error('🔥 Library Manifest Route Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}