// app/api/auth/sms-verify/route.ts
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
    const { phoneNumber, code } = await request.json();
    
    // Standardize phone format
    let cleanPhone = phoneNumber.trim().replace(/[^0-9]/g, "");
    if (cleanPhone.length === 10) cleanPhone = `+1${cleanPhone}`;
    else cleanPhone = `+${cleanPhone}`;

    // 1. Re-initialize Firebase (Fixes 'getFirestore not defined')
    if (getApps().length === 0) {
        const keyPath = path.resolve(process.cwd(), "secrets/firebase-service-account.json");
        initializeApp({
            credential: cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))),
            projectId: "jubilee-command-center---dev"
        });
    }

    // 2. Verify with Twilio
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
      .verificationChecks.create({ to: cleanPhone, code: code.trim() });

    if (check.status === "approved") {
      const db = getFirestore();
      const entitlements = await db.collection("entitlements")
          .where("userPhone", "==", cleanPhone)
          .where("status", "==", "active")
          .limit(1)
          .get();

      return NextResponse.json({ 
        success: true, 
        userId: entitlements.docs[0]?.id || "unknown" 
      }, { status: 200, headers: corsHeaders });
    }

    return NextResponse.json({ success: false, error: "Invalid PIN." }, { status: 400, headers: corsHeaders });

  } catch (error: any) {
    console.error("❌ SMS Verification Error:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}