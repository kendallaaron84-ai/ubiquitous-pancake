import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

// Initialize Stripe with the latest Dahlia API architecture
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-06-24.dahlia', 
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('assetId');
    const tenantKey = searchParams.get('tenantKey'); 

    if (!assetId || !tenantKey) {
      return new NextResponse('Missing required parameters', { status: 400 });
    }

    // 1. Fetch the Sovereign Product Data from Firestore
    const productRef = adminDb.collection('products').doc(assetId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      return new NextResponse('Asset not found', { status: 404 });
    }

    const productData = productSnap.data();

    // 2. Validate Tenant Ownership
    if (productData?.authorId !== tenantKey && productData?.studioKey !== tenantKey) {
      return new NextResponse('Tenant Mismatch', { status: 403 });
    }

    // 3. Price formatting (Stripe requires integers in cents)
    const priceInCents = Math.round((parseFloat(productData?.price || '0')) * 100);

    if (priceInCents <= 0) {
      return new NextResponse('Free assets do not require checkout', { status: 400 });
    }

    // 4. Dynamic Platform Revenue Split (Author Autonomy Default: 0%)
    // This value is driven entirely by the UI agreement in Firestore.
    const platformCommissionPercent = parseFloat(productData?.platformCommissionPercent || '0');
    const platformFeeInCents = Math.round(priceInCents * platformCommissionPercent);

    // 5. Build Stripe Checkout Session
    const sessionPayload: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: productData?.title || 'KOBA-I Audiobook',
              images: productData?.coverUrl ? [productData.coverUrl] : [],
              description: `By ${productData?.authorName || 'Author'}`,
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${request.headers.get('referer') || 'https://dashboard.koba-i.com'}?success=true&asset=${assetId}`,
      cancel_url: `${request.headers.get('referer') || 'https://dashboard.koba-i.com'}?canceled=true`,
      metadata: {
        assetId,
        tenantKey,
        type: 'audiobook_purchase'
      },
    };

    // 6. SaaS Stripe Connect Routing
    if (productData?.stripeAccountId) {
      sessionPayload.payment_intent_data = {
        transfer_data: {
          destination: productData.stripeAccountId,
        },
      };

      // ONLY apply the application fee if there is an explicit marketing agreement > 0%
      if (platformFeeInCents > 0) {
        sessionPayload.payment_intent_data.application_fee_amount = platformFeeInCents;
      }
    }

    // 7. Create Session & Redirect
    const session = await stripe.checkout.sessions.create(sessionPayload);
    return NextResponse.redirect(session.url as string, 303);

  } catch (error) {
    console.error('Stripe Checkout Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}