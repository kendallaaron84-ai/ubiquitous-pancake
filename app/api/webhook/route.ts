// app/api/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const payload = await req.text();
  const sig = req.headers.get("Stripe-Signature"); // Note: Stripe header verification casing fix
  
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook signature verification failed: ${err.message}` }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {});

  // 🔥 DYNAMIC RUNTIME IMPORT: Keeps Firebase isolated from the static build engine
  const admin = require("firebase-admin");

  if (!admin.apps.length) {
    try {
      const keyPath = path.join(process.cwd(), "secrets", "firebase-service-account.json");
      if (fs.existsSync(keyPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log("🚀 Firebase Initialized successfully from local JSON file!");
      } else {
        console.warn("⚠️ Service account file missing during compilation pass.");
        // Optional: fallback to application default if needed during cold passes
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      }
    } catch (err: any) {
      console.error("❌ Firebase Initialization Error:", err.message);
      return NextResponse.json({ error: "Database core initialization failure" }, { status: 500 });
    }
  }

  const db = admin.apps.length ? admin.firestore() : null;

  // 🔑 ADVANCED ENTITLEMENT HANDLING
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    
    // Pull tokens out of the Stripe metadata envelope
    const metadata = session.metadata || {};
    const assetKey = metadata.koba_asset_key;
    const productType = metadata.koba_product_type || "Audiobook";
    const stripeConnectId = metadata.author_stripe_connect_id || "";
    const originDomain = metadata.origin_domain || "koba-dev.local"; // Captured from our new checkout pipeline
    
    // Fallback to Stripe data fields if metadata email wasn't passed directly
    const userEmail = metadata.user_email || session.customer_details?.email || "";

    console.log(`Processing entitlement fulfillment for: ${userEmail} -> Asset: ${assetKey}`);

    if (!assetKey || !userEmail) {
      console.error("❌ Missing vital payload credentials. Aborting DB entry.");
      return NextResponse.json({ error: "Missing asset key or user email in metadata" }, { status: 400 });
    }

    if (!db) {
      console.error("❌ Firestore connection is unavailable. Database write rejected.");
      return NextResponse.json({ error: "Database core unavailable" }, { status: 500 });
    }

    // Dynamic Time-Bound Calculations (expiresAt)
    let expiresAt: Date | null = null;

    if (productType === "Membership" && session.subscription) {
      try {
        // 🎯 Cast the response explicitly to the underlying Stripe.Subscription model
        const subscriptionResponse = await stripe.subscriptions.retrieve(session.subscription as string);
        const subscription = subscriptionResponse as Stripe.Subscription;

        const periodEnd = subscription.items.data.reduce(
          (latest, item) => Math.max(latest, item.current_period_end),
          0
        );
        if (!periodEnd) {
          throw new Error("Stripe subscription did not contain an active billing period.");
        }
        expiresAt = new Date(periodEnd * 1000);
        console.log(`⏱️ Subscription item mapped. Access expires on: ${expiresAt.toISOString()}`);
      } catch (subErr: any) {
        console.error("⚠️ Failed to extract subscription period end date:", subErr.message);
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 31);
      }
    }

    // Write clean, structured deterministic entitlement directly to Firestore
    try {
      // Human-Centric Deterministic ID creation to prevent duplicate event writes
      const entitlementId = `${userEmail.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_")}_${assetKey}`;
      
      await db.collection("entitlements").doc(entitlementId).set({
        id: entitlementId,
        userId: "", // Maps to Auth record when claimed via dashboard
        userEmail: userEmail.toLowerCase(),
        assetKey: assetKey,
        type: productType,
        status: "active",
        purchasedAt: new Date().toISOString(),
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        stripeConnectId: stripeConnectId,
        stripeSessionId: session.id,
        originDomain: originDomain // Saved for platform metrics
      });

      console.log(`🎉 Success! Entitlement reference ${entitlementId} provisioned securely.`);
    } catch (dbErr: any) {
      console.error("❌ Firestore Mutation Refusal:", dbErr.message);
      return NextResponse.json({ error: "Failed to save record to cloud storage" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
