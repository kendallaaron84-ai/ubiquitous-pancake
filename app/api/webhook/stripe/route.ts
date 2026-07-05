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
function generateSystemId(prefix = 'KOBA-AUDIO') {
  const secureRandom = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${secureRandom}`;
}

export async function POST(req: Request) {
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

  console.log(`📦 Webhook received event: ${event.type}`);

  // 3. Process the Successful Checkout
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    
    // Check if this is a listener buying an audiobook (Ghost Protocol)
    const isListenerPurchase = session.metadata?.checkoutType === 'listener_purchase';

    // ====================================================================
    // SCENARIO A: LISTENER BUYING AUDIOBOOK (The Ghost Protocol)
    // ====================================================================
    if (isListenerPurchase) {
      const assetId = session.metadata?.assetId;
      const tenantKey = session.metadata?.tenantKey;
      const customerEmail = session.customer_details?.email || session.customer?.toString();
      
      const rawPhone = session.customer_details?.phone || session.metadata?.customerPhone || '';
      const normalizedPhone = rawPhone.replace(/[^\d+]/g, '');

      if (assetId && tenantKey && normalizedPhone) {
        try {
          const entitlementId = `${tenantKey}_${assetId}_${normalizedPhone}`;
          await adminDb.collection('entitlements').doc(entitlementId).set({
            assetId, tenantKey, customerEmail, customerPhone: normalizedPhone,
            stripeSessionId: session.id, stripeCustomerId: session.customer || null,
            status: 'active', amountTotal: session.amount_total, purchasedAt: new Date().toISOString(),
          });
          console.log(`✅ Ghost Protocol Entitlement provisioned for phone: ${normalizedPhone}`);
          return NextResponse.json({ provisioned: true }, { status: 200 });
        } catch (dbError) {
          console.error('🔥 Firestore Write Error:', dbError);
          return new NextResponse('Database Error', { status: 500 });
        }
      }
      return new NextResponse('Missing metadata', { status: 400 });
    }

    // ====================================================================
    // SCENARIO B: AUTHOR BUYING KOBA-I SOFTWARE (Intelligent Routing)
    // ====================================================================
    else {
      // Reach back into Stripe and fetch the exact items they purchased
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      
      // Loop through the items to grant the correct licenses
      for (const item of lineItems.data) {
        const productName = item.description.toLowerCase();
        
        console.log(`🔍 Checking purchased item: "${productName}"`);
        
        // STRICT MATCHING: Checking for the exact product names to prevent false positives
        const isAudioPlugin = productName.includes('koba-i audio player');
        const isEReader = productName.includes('jubilee works digital e-reader');

        // Only generate a key if they actually bought the software
        if (isAudioPlugin || isEReader) {
          const customerEmail = session.customer_details?.email;
          const customerName = session.customer_details?.name || 'Unknown Author';
          const authorId = session.client_reference_id || customerEmail; 
          
          if (!authorId) {
            console.warn(`⚠️ Skipped provisioning for "${productName}" - No customer email or authorId found in checkout session.`);
            continue;
          }

          // Determine the prefix based on what they bought
          const prefix = isEReader && !isAudioPlugin ? 'KOBA-READER' : 'KOBA-AUDIO';
          const licenseType = isEReader && !isAudioPlugin ? 'ereader_plugin' : 'audiobook_plugin';
          
          const newStudioKey = generateSystemId(prefix);
          
          console.log(`✅ Provisioning [${newStudioKey}] (${licenseType}) for: ${customerEmail}`);

          try {
            await adminDb.collection('licenses').doc(newStudioKey).set({
              studioKey: newStudioKey,
              authorId: authorId,
              authorEmail: customerEmail,
              authorName: customerName,
              status: 'active',
              type: licenseType,
              stripeSessionId: session.id,
              productName: item.description,
              createdAt: new Date().toISOString(),
              associatedWebsite: null
            });

            await adminDb.collection('users').doc(authorId).set({
              email: customerEmail,
              name: customerName,
              hasActiveLicense: true,
              lastPurchaseDate: new Date().toISOString(),
            }, { merge: true });

          } catch (dbError) {
            console.error('❌ Failed to provision author license:', dbError);
          }
        } else {
          console.log(`ℹ️ Ignored product purchase: "${item.description}" (Does not match KOBA-I software target keywords)`);
        }
      }

      return NextResponse.json({ processed: true }, { status: 200 });
    }
  }

  // Log unhandled events so you know if Stripe is sending the wrong event type
  console.log(`🤷‍♂️ Ignored unhandled event type: ${event.type}`);
  return new NextResponse('Webhook processed successfully', { status: 200 });
}