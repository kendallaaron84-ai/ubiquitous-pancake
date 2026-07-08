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
    const authorParam = searchParams.get('author')?.trim();

    if (!authorParam) {
      return NextResponse.json({ error: 'Missing author context attribute identifier' }, { status: 400, headers: CORS_HEADERS });
    }

    // 🚀 THE EXACT MATCH IMPORT MATCH: Use your project's native instance initialization
    const admin = require("firebase-admin");
    
    // Safety check to ensure Firebase Admin isn't calling double-init during compile dev reload cycles
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
    
    const db = admin.firestore();

    console.log(`🔍 Headless Proxy: Scanning catalog collection for identifier: ${authorParam}`);

    let queryRef;
    
    // Auto-detect if parameter context is a slug or an email string format
    if (authorParam.includes('@')) {
      queryRef = db.collection('products').where('authorEmail', '==', authorParam);
    } else {
      queryRef = db.collection('products').where('authorSlug', '==', authorParam);
    }

    const productsSnapshot = await queryRef.get();
    const catalogItems: any[] = [];

    productsSnapshot.forEach((doc: any) => {
      const data = doc.data();
      if (data.status === 'published' || data.isPublished !== false) {
        catalogItems.push({
          id: doc.id,
          assetKey: data.assetKey || doc.id,
          title: data.title || data.bookTitle || 'Untitled Publication',
          price: parseFloat(data.price || 0),
          type: data.type || 'audiobook',
          coverUrl: data.coverUrl || data.coverArtUrl || '',
          synopsis: data.synopsis || data.description || 'Sovereign Content Engine Vol.',
          accentColor: data.accentColor || '#f97316',
          sections: data.sections || ['Featured Publications']
        });
      }
    });

    console.log(`📚 Handshake Successful: Found ${catalogItems.length} publications. Syncing back to plugin wrapper.`);

    return NextResponse.json({
      success: true,
      authorName: authorParam.includes('@') ? authorParam.split('@')[0] : authorParam,
      products: catalogItems,
      books: catalogItems,
      entitlements: []
    }, {
      status: 200,
      headers: CORS_HEADERS
    });

  } catch (error: any) {
    console.error('🔥 Public Catalog Endpoint Pipeline Collapse:', error);
    return NextResponse.json(
      { error: 'Internal Server Error Data Lock', details: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}