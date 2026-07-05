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
  
  // Guardrail: Check if middleware or something else consumed the body stream
  if (!body || body.trim() === '') {
    console.error('🚨 WEBHOOK BODY IS EMPTY. The request body stream may have been consumed by a middleware.');
    return new NextResponse('Webhook Error: Empty request body payload.', { status: 400 });
  }

  // Dual-layer signature extraction for maximum compatibility with serverless headers
  let signature = req.headers.get('stripe-signature');
  if (!signature) {
    try {
      const headersList = headers();
      signature = headersList.get('stripe-signature');
    } catch (hErr) {
      console.warn('⚠️ Could not read global headers helper:', hErr);
    }
  }

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Print non-sensitive debugging information to compare secrets
  if (endpointSecret) {
    const formattedSecret = `${endpointSecret.substring(0, 8)}...${endpointSecret.substring(endpointSecret.length - 4)}`;
    console.log(`🔑 Webhook Secret in Use: ${formattedSecret}`);
  } else {
    console.error('🚨 Missing STRIPE_WEBHOOK_SECRET env variable.');
  }

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
          return NextResponse.json({ provisioned: true, listenerMode: true }, { status: 200 });
        } catch (dbError: any) {
          console.error('🔥 Firestore Write Error:', dbError.message);
          return NextResponse.json({ error: 'Database Write Failed', details: dbError.message }, { status: 500 });
        }
      }
      return NextResponse.json({ error: 'Missing listener metadata' }, { status: 400 });
    }

    // ====================================================================
    // SCENARIO B: AUTHOR BUYING KOBA-I SOFTWARE (Intelligent Routing)
    // ====================================================================
    else {
      try {
        // Reach back into Stripe and fetch the exact items they purchased
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const itemAnalysis: any[] = [];
        let anyMatchSuccess = false;
        
        // Loop through the items to grant the correct licenses
        for (const item of lineItems.data) {
          const productNameRaw = item.description || '';
          const productName = productNameRaw.toLowerCase();
          
          // Get product ID safely
          const productId = typeof item.price?.product === 'string' 
            ? item.price.product 
            : (item.price?.product as any)?.id || '';
          
          // Strict targeted matching
          const isAudioPlugin = productId === 'prod_UpYvZLShITzyej' || 
                                productName.includes('koba-i audio player') ||
                                productName.includes('audio player');
                                
          const isEReader = productName.includes('jubilee works digital e-reader') || 
                            productName.includes('digital e-reader') ||
                            productName.includes('e-reader');

          itemAnalysis.push({
            incomingDescription: productNameRaw,
            incomingProductId: productId,
            evaluatedAsAudioPlugin: isAudioPlugin,
            evaluatedAsEReader: isEReader
          });

          // Only generate a key if they actually bought the software
          if (isAudioPlugin || isEReader) {
            anyMatchSuccess = true;
            const customerEmail = session.customer_details?.email || session.customer_email || `customer-${Date.now()}@koba-i.com`;
            const customerName = session.customer_details?.name || 'Unknown Author';
            const authorId = session.client_reference_id || customerEmail; 

            // Determine the prefix based on what they bought
            const prefix = isEReader && !isAudioPlugin ? 'KOBA-READER' : 'KOBA-AUDIO';
            const licenseType = isEReader && !isAudioPlugin ? 'ereader_plugin' : 'audiobook_plugin';
            
            const newStudioKey = generateSystemId(prefix);

            try {
              if (!adminDb) {
                throw new Error("adminDb is undefined. The Firebase Admin SDK failed to initialize correctly.");
              }

              // Perform writes
              await adminDb.collection('licenses').doc(newStudioKey).set({
                studioKey: newStudioKey,
                authorId: authorId,
                authorEmail: customerEmail,
                authorName: customerName,
                status: 'active',
                type: licenseType,
                stripeSessionId: session.id,
                productId: productId,
                productName: productNameRaw,
                createdAt: new Date().toISOString(),
                associatedWebsite: null
              });

              await adminDb.collection('users').doc(authorId).set({
                email: customerEmail,
                name: customerName,
                hasActiveLicense: true,
                lastPurchaseDate: new Date().toISOString(),
              }, { merge: true });

              console.log(`✅ SUCCESS: License ${newStudioKey} successfully written to Firestore.`);

            } catch (dbError: any) {
              console.error('🚨 FIREBASE WRITE ERROR:', dbError.message);
              return NextResponse.json({ 
                error: 'Firebase Write Error', 
                message: dbError.message,
                credentialsCheck: {
                  projectIdSet: !!process.env.FIREBASE_PROJECT_ID,
                  clientEmailSet: !!process.env.FIREBASE_CLIENT_EMAIL,
                  privateKeySet: !!process.env.FIREBASE_PRIVATE_KEY
                }
              }, { status: 500 });
            }
          }
        }

        // Return a verbose success package directly to Stripe dashboard response tab
        return NextResponse.json({ 
          processed: true, 
          matchedAndMinted: anyMatchSuccess,
          receivedSessionId: session.id,
          analysisLogs: itemAnalysis 
        }, { status: 200 });

      } catch (err: any) {
        console.error('🔥 Server Error processing line items:', err);
        return NextResponse.json({ error: 'Line Items Fetch Error', details: err.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ignoredEvent: event.type }, { status: 200 });
}