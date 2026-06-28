// app/api/webhook/stripe/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { headers } from "next/headers";
import path from "path";
import fs from "fs";
import { crypto } from "crypto"; 

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const payload = await req.text();
  const sig = headers().get("stripe-signature") as string;

  if (!sig) return NextResponse.json({ error: "Missing signature boundary" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error(`❌ Webhook Signature Violation: ${err.message}`);
    return NextResponse.json({ error: "Security validation failed" }, { status: 400 });
  }

  // Handle transaction event automatically
  if (event.type === "checkout.session.completed") {
    try {
      const session = await stripe.checkout.sessions.retrieve(
        (event.data.object as any).id,
        { expand: ["line_items"] }
      );

      // Extract precise product/author indicators from checkout metadata boundaries
      const assetKey     = session.metadata?.assetKey;
      const userEmail    = session.customer_details?.email?.toLowerCase().trim() || session.metadata?.user_email;
      const productType  = session.metadata?.productType || "Audiobook";
      const userPhone    = session.customer_details?.phone || "";

      if (!assetKey || !userEmail) {
        console.error("❌ Webhook aborted: Critical identity metadata metadata context missing.");
        return NextResponse.json({ received: true, error: "Missing identity metadata." });
      }

      // Initialize Firebase Admin cleanly
      const firebaseAdmin = require("firebase-admin");
      const admin = firebaseAdmin.default || firebaseAdmin;

      if (!admin.apps || !admin.apps.length) {
        const keyPath = path.resolve(process.cwd(), "secrets/firebase-service-account.json");
        if (fs.existsSync(keyPath)) {
          const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id,
          });
        } else {
          admin.initializeApp({ projectId: "jubilee-command-center---dev" });
        }
      }

      const db = admin.firestore();

      // 🚀 DATA DISCIPLINE: Generate a fixed-length deterministic hash ID (32 chars) 
      // Prevents key length pollution while remaining 100% idempotent
      const deterministicHash = require("crypto")
        .createHash("md5")
        .update(`${assetKey}_${userEmail}`)
        .digest("hex");
      
      const entitlementId = `ent_${deterministicHash}`;

      // 🔍 Cross-reference product item to pull active license keys (WPStudioKey)
      const productDoc = await db.collection("products").doc(assetKey).get();
      let assignedStudioKey = "";
      
      if (productDoc.exists) {
        assignedStudioKey = productDoc.data()?.WPStudioKey || productDoc.data()?.licenseKey || "";
      }

      // Write explicit, clean record structure without altering product/licenses configurations
      const entitlementPayload = {
        id: entitlementId,
        assetKey: assetKey,
        userEmail: userEmail,
        userPhone: userPhone,
        userId: session.customer?.toString() || "",
        stripeSessionId: session.id,
        stripeConnectId: session.stripe_account || "",
        status: "active",
        type: productType,
        purchasedAt: new Date().toISOString(),
        expiresAt: null,
        WPStudioKey: assignedStudioKey // Links license verification downstream safely
      };

      await db.collection("entitlements").doc(entitlementId).set(entitlementPayload, { merge: true });
      console.log(`🎉 Automated Entitlement Verified & Set: ${entitlementId}`);

    } catch (processError: any) {
      console.error("❌ Critical runtime processing error:", processError.message);
      return NextResponse.json({ error: "Fulfillment processor execution stalled" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}