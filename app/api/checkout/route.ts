export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

// Initialize Stripe with the latest Dahlia API architecture
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-06-24.dahlia', 
});

export async function POST(request: Request) {
  try {
    // 1. Parse JSON body instead of URL parameters for the POST request
    const body = await request.json();
    const { assetId, tenantKey } = body;

    if (!assetId || !tenantKey) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 2. Fetch the Sovereign Product Data from Firestore
    const productRef = adminDb.collection('products').doc(assetId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const productData = productSnap.data();

    // 3. Validate Tenant Ownership
    if (productData?.authorId !== tenantKey && productData?.studioKey !== tenantKey) {
      return NextResponse.json({ error: 'Tenant Mismatch' }, { status: 403 });
    }

    // 4. Price formatting (Stripe requires integers in cents)
    const priceInCents = Math.round((parseFloat(productData?.price || '0')) * 100);

    if (priceInCents <= 0) {
      return NextResponse.json({ error: 'Free assets do not require checkout' }, { status: 400 });
    }

    // 5. Dynamic Platform Revenue Split
    const platformCommissionPercent = parseFloat(productData?.platformCommissionPercent || '0');
    const platformFeeInCents = Math.round(priceInCents * platformCommissionPercent);

    // 6. Build Stripe Checkout Session
    const sessionPayload: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      // CRITICAL: Force Stripe to collect the phone number for the OTP Ghost Protocol
      phone_number_collection: {
        enabled: true,
      },
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
      // Allow React frontend to define the return URLs dynamically via headers, or default to the Command Center
      success_url: `${request.headers.get('origin') || 'https://dashboard.koba-i.com'}?success=true&asset=${assetId}`,
      cancel_url: `${request.headers.get('origin') || 'https://dashboard.koba-i.com'}?canceled=true`,
      metadata: {
        assetId,
        tenantKey,
        type: 'audiobook_purchase'
      },
    };

    // 7. SaaS Stripe Connect Routing
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

    // 8. Create Session & Return JSON URL for client-side redirect
    const session = await stripe.checkout.sessions.create(sessionPayload);
    
    return NextResponse.json({ url: session.url }, { status: 200 });

  } catch (error) {
    console.error('Stripe Checkout Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}