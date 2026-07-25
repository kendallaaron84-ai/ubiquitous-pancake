// app/api/webhook/stripe/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
});

export async function POST(request: Request) {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  let event: Stripe.Event;

  try {
    if (!sig) throw new Error("Missing stripe-signature header");
    
    // Verify that the event genuinely came from your Stripe account
    event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(`❌ Webhook Signature Verification Failed: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // Handle the successful transaction event
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    
    // Pull the structural parameters you passed inside your metadata wrapper
    const userEmail = session.metadata?.user_email;
    const assetKey = session.metadata?.koba_asset_key;
    const productType = session.metadata?.koba_product_type || "Audiobook";
    const originDomain = session.metadata?.origin_domain || "koba-dev.local";

    console.log(`🔔 STRIPE WEBHOOK RECEIVED: Successful transaction for ${userEmail}`);

    // 🔥 DYNAMIC RUNTIME IMPORT: Prevents build-time 'length' of undefined crashes
    const admin = require("firebase-admin");

    if (!admin || !admin.apps || !admin.apps.length) {
      try {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      } catch (e) {
        console.warn("⚠️ Firebase Admin initialization bypassed during build pass.");
        return NextResponse.json({ error: "Database core unavailable during build check" }, { status: 500 });
      }
    }

    const db = admin.firestore();

    if (userEmail && assetKey && db) {
      try {
        // Construct a clean, deterministic unique document ID for this purchase
        const entitlementId = `${userEmail.replace(/[^a-zA-Z0-9]/g, "_")}_${assetKey}`;
        
        // Write the permanent digital entitlement key to the database
        await db.collection("entitlements").doc(entitlementId).set({
          userEmail: userEmail,
          assetKey: assetKey,
          productType: productType,
          stripeSessionId: session.id,
          stripeCustomerId: session.customer as string,
          grantedAt: admin.firestore.FieldValue.serverTimestamp(),
          originDomain: originDomain,
          status: "active"
        });

        console.log(`✅ Entitlement link locked in Firestore: ${entitlementId}`);
      } catch (dbErr: any) {
        console.error(`❌ Firestore Entitlement Write Failure: ${dbErr.message}`);
        return NextResponse.json({ error: "Database registration failure" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}