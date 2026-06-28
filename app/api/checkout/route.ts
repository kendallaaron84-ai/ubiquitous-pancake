// app/api/checkout/route.ts
import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16" as any,
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // 🚀 THE PARAMETER HARVESTER: Catches any variation passed from the frontend catalog!
    const assetKey = body.assetKey || body.asset_key || body.id || body.productId || body.product_id || body.assetId || body.asset_id;

    if (!assetKey) {
      return NextResponse.json({ 
        success: false, 
        error: "Missing product asset identifier key. Provide assetKey, asset_key, or id context." 
      }, { status: 400 });
    }

    // Initialize Firebase Admin safely
    if (getApps().length === 0) {
      const keyPath = path.resolve(process.cwd(), "secrets/firebase-service-account.json");
      if (fs.existsSync(keyPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
        initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
      } else {
        initializeApp({ projectId: "jubilee-command-center---dev" });
      }
    }

    const adminDb = getFirestore();
    const productDoc = await adminDb.collection("products").doc(assetKey).get();

    if (!productDoc.exists) {
       return NextResponse.json({ success: false, error: `Product record [${assetKey}] not found in inventory ledger.` }, { status: 404 });
    }

    const productData = productDoc.data() || {};
    
    // Fallback directly to your verified sandbox connect account string
    const stripeConnectId = productData.stripeConnectId || "acct_1TdEzNAfHyixYIkp"; 
    const priceString = productData.price || "5.00";
    const priceInCents = Math.round(parseFloat(priceString) * 100);

    if (priceInCents <= 0) {
      return NextResponse.json({ success: false, error: "Bypass triggered for free context assets." }, { status: 400 });
    }

    const baseDomain = "http://koba-dev.local";
    const cleanSlug = (productData.title || "freedom-fighter").toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // Initialize the checkout sequence directly on behalf of your connected account
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: productData.title || "Sovereign Publication Asset",
              description: productData.synopsis || "",
              images: productData.coverArtUrl ? [productData.coverArtUrl] : [],
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${baseDomain}/koba_publication/${cleanSlug}/?success=true&asset=${assetKey}`,
      cancel_url: `${baseDomain}/koba_publication/${cleanSlug}/?canceled=true`,
      metadata: {
        assetKey: assetKey,
        authorEmail: productData.authorEmail || "kendallaaron84@gmail.com",
      },
    }, {
      stripeAccount: stripeConnectId,
    });

    return NextResponse.json({ success: true, url: session.url }, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });

  } catch (error: any) {
    console.error("❌ Stripe Checkout Sequence Fault:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}