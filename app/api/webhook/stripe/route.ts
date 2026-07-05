import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/core/firebase-admin';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

// Initialize Stripe (Ensure STRIPE_SECRET_KEY is in your Vercel env variables)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-06-24.dahlia', // Adjust to match your Stripe dashboard API version
});

// 1. Cryptographically Secure License Generator
// Generates an unguessable system ID (e.g., KOBA-AUDIO-8F3A2B9C)
function generateSystemId(prefix = 'KOBA-AUDIO') {
  const secureRandom = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${secureRandom}`;
}

export async function POST(req: Request) {
  // Next.js App Router requires consuming the raw body as text for Stripe signature verification
  const body = await req.text();
  const headersList = headers();
  const signature = headersList.get('stripe-signature');
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    if (!signature || !endpointSecret) {
      throw new Error('Missing Stripe signature or Webhook Secret environment variable.');
    }
    // 2. Cryptographic Signature Verification
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (err: any) {
    console.error(`⚠️ Webhook Signature Verification Failed: ${err.message}`);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // 3. Process the Successful Checkout
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    
    // 🚦 ROUTING LOGIC: Determine if this is an Author buying KOBA-I, or a Listener buying an Audiobook
    // Ensure you pass `checkoutType: 'author_license'` or `'listener_purchase'` in your Stripe checkout session metadata
    const checkoutType = session.metadata?.checkoutType || 'author_license';

    // ====================================================================
    // SCENARIO A: AUTHOR BUYING KOBA-I INFRASTRUCTURE (License Generation)
    // ====================================================================
    if (checkoutType === 'author_license') {
      const customerEmail = session.customer_details?.email;
      const customerName = session.customer_details?.name || 'Unknown Author';
      const authorId = session.client_reference_id || customerEmail; 
      const assetId = session.metadata?.assetId || 'global_access'; 

      if (!authorId) {
        console.error('⚠️ Cannot provision license: Missing author identifier.');
        return new NextResponse('Missing author identifier', { status: 400 });
      }

      try {
        // Auto-Generate the Unique System ID
        const newStudioKey = generateSystemId();
        console.log(`✅ Provisioning new license [${newStudioKey}] for Author: ${customerEmail}`);

        // Write the Dual-Layer License to Firestore
        await adminDb.collection('licenses').doc(newStudioKey).set({
          studioKey: newStudioKey,
          authorId: authorId,
          authorEmail: customerEmail,
          authorName: customerName,
          assetId: assetId,
          status: 'active',
          type: 'audiobook_plugin',
          stripeSessionId: session.id,
          createdAt: new Date().toISOString(),
          associatedWebsite: null // To be populated when activated on WP
        });

        // Update the Author Profile in your 'users' collection
        await adminDb.collection('users').doc(authorId).set({
          email: customerEmail,
          name: customerName,
          hasActiveLicense: true,
          lastPurchaseDate: new Date().toISOString(),
        }, { merge: true });

        return NextResponse.json({ provisioned: true, generatedKey: newStudioKey }, { status: 200 });

      } catch (dbError) {
        console.error('❌ Failed to provision author license:', dbError);
        return new NextResponse('Database Error', { status: 500 });
      }
    }

    // ====================================================================
    // SCENARIO B: LISTENER BUYING AUDIOBOOK (The Ghost Protocol)
    // ====================================================================
    else if (checkoutType === 'listener_purchase') {
      const assetId = session.metadata?.assetId;
      const tenantKey = session.metadata?.tenantKey;
      const customerEmail = session.customer_details?.email || session.customer?.toString();
      
      const rawPhone = session.customer_details?.phone || session.metadata?.customerPhone || '';
      const normalizedPhone = rawPhone.replace(/[^\d+]/g, '');

      if (assetId && tenantKey && normalizedPhone) {
        try {
          // Provision the Vault Entitlement in Firestore using composite ID
          const entitlementId = `${tenantKey}_${assetId}_${normalizedPhone}`;
          
          await adminDb.collection('entitlements').doc(entitlementId).set({
            assetId,
            tenantKey,
            customerEmail,
            customerPhone: normalizedPhone,
            stripeSessionId: session.id,
            stripeCustomerId: session.customer || null,
            status: 'active',
            amountTotal: session.amount_total,
            purchasedAt: new Date().toISOString(),
          });

          console.log(`✅ Ghost Protocol Entitlement provisioned for phone: ${normalizedPhone} on asset: ${assetId}`);
          return new NextResponse('Listener Entitlement Provisioned', { status: 200 });

        } catch (dbError) {
          console.error('🔥 Firestore Write Error during Webhook:', dbError);
          return new NextResponse('Database Error', { status: 500 });
        }
      } else {
        console.warn('⚠️ Webhook missing metadata or customer phone. Cannot provision Ghost Protocol entitlement.');
        return new NextResponse('Missing metadata for listener purchase', { status: 400 });
      }
    }
  }

  // Acknowledge other event types quietly so Stripe doesn't retry
  return new NextResponse('Webhook processed successfully', { status: 200 });
}