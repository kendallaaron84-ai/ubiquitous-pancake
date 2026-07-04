import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin'; // Ensure this points to your Firebase Admin init

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('assetId');
    const studioKey = request.headers.get('x-studio-key'); // The Tenant ID from the React embed

    // 1. Initial Validation Gate
    if (!assetId || !studioKey) {
      return NextResponse.json(
        { error: 'Missing required parameters: assetId or X-Studio-Key' },
        { status: 400 }
      );
    }

    // 2. Fetch the Asset from Firestore
    const productRef = adminDb.collection('products').doc(assetId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      return NextResponse.json({ error: 'Asset not found in catalog' }, { status: 404 });
    }

    const productData = productSnap.data();

    // 3. Strict Tenant Isolation Check
    // Ensures the StudioKey matches the author/owner of the asset. 
    // (Adjust 'authorId' if your DB uses a different field name for the tenant identifier)
    if (productData?.authorId !== studioKey && productData?.studioKey !== studioKey) {
      return NextResponse.json(
        { error: 'Tenant Key Invalid. Asset does not belong to this gateway.' },
        { status: 403 }
      );
    }

    // 4. Data Masking: Construct the Public-Only Payload
    // Notice how we actively strip out anything related to 'chapters', 'urls', or 'content'
    const publicData = {
      id: productSnap.id,
      title: productData?.title || 'Untitled Publication',
      authorName: productData?.authorName || 'Unknown Author',
      coverUrl: productData?.coverUrl || productData?.coverArtUrl || '',
      price: typeof productData?.price === 'number' ? productData.price : parseFloat(productData?.price || '0'),
      mediaType: productData?.mediaType || 'audio',
      theme: {
        backgroundColor: productData?.theme?.backgroundColor || '#070a0f',
        backgroundImage: productData?.theme?.backgroundImage || '',
      }
    };

    // 5. CORS Headers for Agnostic Embedding
    const headers = {
      'Access-Control-Allow-Origin': '*', // Allows Shopify/Wix/WP to fetch this
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key',
    };

    return NextResponse.json(publicData, { status: 200, headers });

  } catch (error) {
    console.error('Public Product API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// Handle OPTIONS preflight requests for CORS
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