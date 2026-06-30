// app/api/auth/sms-send/route.ts
import { NextResponse } from "next/server";
import twilio from "twilio";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://koba-dev.local",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

export async function POST(request: Request) {
  try {
    const { phoneNumber } = await request.json();

    if (!phoneNumber) {
      return NextResponse.json({ success: false, error: "Phone number required." }, { status: 400, headers: corsHeaders });
    }

    // 1. Sanitize Phone
    let cleanPhone = phoneNumber.trim().replace(/[^0-9]/g, "");
    if (cleanPhone.length === 10) cleanPhone = `+1${cleanPhone}`;
    else cleanPhone = `+${cleanPhone}`;

    // 2. Initialize Firebase
    if (getApps().length === 0) {
      const keyPath = path.resolve(process.cwd(), "secrets/firebase-service-account.json");
      if (fs.existsSync(keyPath)) {
        initializeApp({
          credential: cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))),
          projectId: JSON.parse(fs.readFileSync(keyPath, "utf8")).project_id,
        });
      } else {
        initializeApp({ projectId: "jubilee-command-center---dev" });
      }
    }

    const db = getFirestore();
    const entitlementsRef = db.collection("entitlements");

    // 3. Global Authentication (Removed Asset Filtering)
    // Now we check if the user exists ANYWHERE in your ecosystem
    const snapshot = await entitlementsRef
      .where("userPhone", "==", cleanPhone)
      .where("status", "==", "active")
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ success: false, error: "No purchases found." }, { status: 404, headers: corsHeaders });
    }

    // 4. Send Twilio SMS
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const verification = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
      .verifications.create({ to: cleanPhone, channel: "sms" });

    return NextResponse.json({ success: true, status: verification.status }, { status: 200, headers: corsHeaders });

  } catch (error: any) {
    console.error("❌ SMS Dispatch Error:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}