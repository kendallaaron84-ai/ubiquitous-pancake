import { NextResponse } from 'next/server';
import { adminDb } from '@/core/firebase-admin';

// Prevent Next.js from aggressively caching this route so the catalog always updates live
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        
        // The React engine will send EITHER a studioKey (for the catalog) or an assetId (for the player)
        const studioKey = searchParams.get('studioKey') || request.headers.get('X-Studio-Key');
        const assetId = searchParams.get('assetId');

        if (!studioKey && !assetId) {
            return NextResponse.json({ error: "Missing required identification parameters." }, { status: 400 });
        }

        // ============================================================================
        // ROUTE 1: FETCH SINGLE SECURE ASSET (For the Audiobook Player)
        // ============================================================================
        if (assetId) {
            // Check the 'assets' or 'products' collection based on your exact schema
            let docRef = await adminDb.collection('products').doc(assetId).get();
            if (!docRef.exists) {
                // Fallback check in case you used the 'assets' collection instead
                docRef = await adminDb.collection('assets').doc(assetId).get();
            }

            if (!docRef.exists) {
                return NextResponse.json({ error: "Asset not found in database." }, { status: 404 });
            }

            return NextResponse.json({ id: docRef.id, ...docRef.data() }, { status: 200 });
        }

        // ============================================================================
        // ROUTE 2: FETCH FULL CATALOG (For the Storefront)
        // ============================================================================
        if (studioKey) {
            console.log(`[Storefront API] Fetching catalog for Studio Key: ${studioKey}`);

            // Step 1: Validate the Studio Key in your 'licenses' collection to find the Author
            const licenseQuery = await adminDb.collection('licenses')
                .where('key', '==', studioKey)
                .where('status', '==', 'active')
                .limit(1)
                .get();

            let targetUserId = null;

            if (!licenseQuery.empty) {
                // We found the license! Grab the owner's ID
                targetUserId = licenseQuery.docs[0].data().userId;
            } else {
                // Fallback: If your schema saves the studioKey directly on the products, we can skip the license check
                console.log(`[Storefront API] License not found, attempting direct product query fallback...`);
            }

            // Step 2: Query the products
            let productsQuery;
            
            if (targetUserId) {
                // Fetch products belonging to this specific author
                productsQuery = await adminDb.collection('products')
                    .where('userId', '==', targetUserId)
                    // .where('status', '==', 'published') // Uncomment this if you only want "published" assets to show
                    .get();
            } else {
                // Fallback Query: Look for products that directly have the studioKey attached
                productsQuery = await adminDb.collection('products')
                    .where('studioKey', '==', studioKey)
                    .get();
            }

            // Map the Firestore documents into a clean JSON array
            const catalog = productsQuery.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    title: data.title || 'Untitled Book',
                    type: data.type || 'Audiobook',
                    price: data.price || 0,
                    coverArtUrl: data.coverArtUrl || '/placeholder-book.png',
                    // DO NOT send secure audio URLs or raw manuscript text in the catalog payload!
                };
            });

            console.log(`[Storefront API] Successfully found ${catalog.length} products.`);
            
            return NextResponse.json(catalog, {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Key'
                }
            });
        }

    } catch (error: any) {
        console.error('[Storefront API] Critical Error:', error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

// Handle CORS Preflight Requests automatically
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