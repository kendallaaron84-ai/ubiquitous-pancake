import { NextResponse } from 'next/server';
import { adminDb } from '@/core/firebase-admin';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders() });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const authorParam = searchParams.get('author')?.trim();
    const assetParam = searchParams.get('asset')?.trim();
    const limitParam = searchParams.get('limit') || '10';
    
    const studioKey = request.headers.get('x-studio-key') || request.headers.get('X-Studio-Key');

    // 🎯 PRIORITY 1: Audiobook Product Catalog Pass (?author= or ?asset= explicitly present)
    if (authorParam || assetParam) {
      console.log(`📚 Audiobook Catalog Engine: Fetching listings for: ${authorParam || assetParam}`);

      const targetAuthor = authorParam || "kendall";
      let queryRef = targetAuthor.includes('@') 
        ? adminDb.collection('products').where('authorEmail', '==', targetAuthor)
        : adminDb.collection('products').where('authorSlug', '==', targetAuthor);

      const productsSnapshot = await queryRef.limit(parseInt(limitParam)).get();
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

      // If specific asset was requested via permalink filter pass, fallback setup
      if (catalogItems.length === 0 && assetParam) {
        catalogItems.push({
          id: assetParam,
          assetKey: assetParam,
          title: "The Case of the Missing Carrot",
          price: 0.00,
          type: "audiobook",
          coverUrl: "",
          synopsis: "Sovereign Content Engine Preview Pass Context.",
          accentColor: "#f97316",
          sections: ['Featured Publications']
        });
      }

      return NextResponse.json({
        success: true,
        authorName: targetAuthor.includes('@') ? targetAuthor.split('@')[0] : targetAuthor,
        products: catalogItems, // Fully populated arrays dissolve infinite spin instantly
        books: catalogItems,
        content: []
      }, {
        status: 200,
        headers: getCorsHeaders()
      });
    }

    // 🎯 PRIORITY 2: Fallback to AI Blogging Engine (If no catalog parameters are specified)
    if (studioKey) {
      console.log(`📰 Blogging Content Engine: Fetching blueprints for key token context: ${studioKey}`);
      
      const contentSnap = await adminDb.collection('content_blueprints')
        .where('executionState', '==', 'completed')
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limitParam))
        .get();

      if (contentSnap.empty) {
        return NextResponse.json(
          { success: true, content: [], products: [], books: [], message: 'No published content found.' }, 
          { status: 200, headers: getCorsHeaders() }
        );
      }

      const publicContent: any[] = [];
      
      contentSnap.forEach((doc: any) => {
        const data = doc.data();
        if (data.authorEmail === studioKey || data.studioKey === studioKey || data.authorSlug === studioKey) {
          publicContent.push({
            id: doc.id,
            title: data.topicTitle || data.title || 'Untitled Post',
            body: data.generatedContent || data.body || '', 
            excerpt: data.synopsis || data.description || '',
            category: data.brandAllocation || 'General',
            targetAudience: data.targetAudience || '',
            publishedAt: data.completedAt ? (typeof data.completedAt.toDate === 'function' ? data.completedAt.toDate().toISOString() : data.completedAt) : new Date().toISOString()
          });
        }
      });

      return NextResponse.json({ success: true, content: publicContent, products: [], books: [] }, { status: 200, headers: getCorsHeaders() });
    }

    return NextResponse.json(
      { error: 'Missing authorized context routing keys.' },
      { status: 400, headers: getCorsHeaders() }
    );

  } catch (error: any) {
    console.error('🔥 Unified Content API Master Hub Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error Data Lock', details: error.message },
      { status: 500, headers: getCorsHeaders() }
    );
  }
}

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key, x-studio-key, Authorization, Origin',
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
  };
}