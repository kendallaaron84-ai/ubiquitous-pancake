import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('assetId');
    const scope = searchParams.get('scope') || 'tenant';
    const studioKey = request.headers.get('x-studio-key');

    // 1. Core Gate: Every request needs a Studio Key
    if (!studioKey) {
      return NextResponse.json({ error: 'Missing X-Studio-Key header' }, { status: 400 });
    }

    const CORS_HEADERS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key',
    };

    // =======================================================
    // SCENARIO A: SINGLE PRODUCT LOOKUP (For the Media Player)
    // =======================================================
    if (assetId) {
      const productRef = adminDb.collection('products').doc(assetId);
      const productSnap = await productRef.get();

      if (!productSnap.exists) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404, headers: CORS_HEADERS });
      }

      const productData = productSnap.data();

      // Tenant Validation Isolation Check
      if (productData?.authorId !== studioKey && productData?.studioKey !== studioKey) {
        return NextResponse.json({ error: 'Unauthorized tenant access' }, { status: 403, headers: CORS_HEADERS });
      }

      const singlePayload = {
        id: productSnap.id,
        title: productData?.title || 'Untitled',
        authorName: productData?.authorName || 'Unknown Author',
        coverUrl: productData?.coverUrl || productData?.coverArtUrl || '',
        price: typeof productData?.price === 'number' ? productData.price : parseFloat(productData?.price || '0'),
        mediaType: productData?.mediaType || 'audio',
        theme: {
          backgroundColor: productData?.theme?.backgroundColor || '#070a0f',
          backgroundImage: productData?.theme?.backgroundImage || '',
        }
      };

      return NextResponse.json(singlePayload, { status: 200, headers: CORS_HEADERS });
    }

    // =======================================================
    // SCENARIO B: FULL CATALOG LOOKUP (For the Storefront Grid)
    // =======================================================
    let productsQuery = adminDb.collection('products').where('studioKey', '==', studioKey);
    
    // If you use 'authorId' instead of 'studioKey' in your products collection collection, swap it here:
    // let productsQuery = adminDb.collection('products').where('authorId', '==', studioKey);

    const snapshot = await productsQuery.get();
    const catalogPayload = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || 'Untitled Publication',
        authorName: data.authorName || 'Unknown Author',
        coverUrl: data.coverUrl || data.coverArtUrl || '',
        price: typeof data.price === 'number' ? data.price : parseFloat(data.price || '0'),
        category: data.category || 'General',
        theme: {
          backgroundColor: data.theme?.backgroundColor || '#1e293b',
          backgroundImage: data.theme?.backgroundImage || '',
        }
      };
    });

    return NextResponse.json(catalogPayload, { status: 200, headers: CORS_HEADERS });

  } catch (error) {
    console.error('Public Product API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key',
    },
  });
}