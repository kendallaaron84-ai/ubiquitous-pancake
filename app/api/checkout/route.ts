import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// 🚀 FIXED: Tell Vercel this is a live API, do not prerender it during build
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const studioKey = request.headers.get('x-studio-key'); // The Tenant ID from the WordPress plugin
    const limitParam = searchParams.get('limit') || '10'; // Allow WP to request a certain number of posts
    
    // 1. Initial Validation Gate
    if (!studioKey) {
      return NextResponse.json(
        { error: 'Missing required authorization: X-Studio-Key header' },
        { status: 400, headers: getCorsHeaders() }
      );
    }

    // 2. Fetch the Completed Blog Content from Firestore
    // We target 'content_blueprints' where the Nexus Engine has finished its job
    const contentRef = adminDb.collection('content_blueprints');
    const contentSnap = await contentRef
      .where('executionState', '==', 'completed')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limitParam))
      .get();

    if (contentSnap.empty) {
      return NextResponse.json(
        { success: true, content: [], message: 'No published content found.' }, 
        { status: 200, headers: getCorsHeaders() }
      );
    }

    // 3. Strict Tenant Isolation & Data Masking
    const publicContent: any[] = [];
    
    contentSnap.forEach(doc => {
      const data = doc.data();
      
      // Ensure the content belongs to the requesting author's Studio Key
      if (data.authorEmail === studioKey || data.studioKey === studioKey) {
        // Strip out backend execution metadata, only send what the blog needs
        publicContent.push({
          id: doc.id,
          title: data.topicTitle || data.title || 'Untitled Post',
          body: data.generatedContent || data.body || '', // The actual AI-written HTML/Markdown
          excerpt: data.synopsis || data.description || '',
          category: data.brandAllocation || 'General',
          targetAudience: data.targetAudience || '',
          publishedAt: data.completedAt ? data.completedAt.toDate().toISOString() : new Date().toISOString()
        });
      }
    });

    // 4. Return the clean payload
    return NextResponse.json(
      { success: true, content: publicContent }, 
      { status: 200, headers: getCorsHeaders() }
    );

  } catch (error) {
    console.error('Public Content API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: getCorsHeaders() }
    );
  }
}

// Handle OPTIONS preflight requests for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
}

// Helper function to maintain consistent CORS policy
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // Allows the WordPress site to fetch this
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key',
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' // Edge caching to make WP fast
  };
}