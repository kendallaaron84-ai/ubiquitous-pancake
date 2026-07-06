import { NextResponse } from "next/server";
import { adminDb } from "@/core/firebase-admin";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // 🚀 Added Origin and Referer to allowed headers for domain locking
  "Access-Control-Allow-Headers": "Content-Type, X-Studio-Key, Origin, Referer",
};

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phoneNumber, assetId } = body;
    const studioKey = request.headers.get("X-Studio-Key");
    const origin = request.headers.get("Origin") || "";
    const referer = request.headers.get("Referer") || "";

    if (!phoneNumber || !assetId || !studioKey) {
      return NextResponse.json(
        { success: false, error: "Missing required authentication parameters (Phone, Asset ID, or Studio Key)." },
        { status: 400, headers: corsHeaders }
      );
    }

    // 🚀 GAP 2 MITIGATED: DOMAIN-LOCK SAFEGUARDS (Anti-Hijacking)
    // Verify the request originates from the Author's registered WordPress/Shopify site
    const usersQuery = await adminDb.collection("users").where("studioKey", "==", studioKey).get();
    if (usersQuery.empty) {
      return NextResponse.json(
        { success: false, error: "Invalid Studio Key." }, 
        { status: 403, headers: corsHeaders }
      );
    }
    
    const userData = usersQuery.docs[0].data();
    const registeredDomain = userData.associatedWebsite;

    if (registeredDomain) {
      // Normalize URLs to base domains for secure matching
      const originClean = origin.replace(/^https?:\/\//, '').split('/')[0];
      const refererClean = referer.replace(/^https?:\/\//, '').split('/')[0];
      const registeredClean = registeredDomain.replace(/^https?:\/\//, '').split('/')[0];
      const isLocal = originClean.includes("localhost") || refererClean.includes("localhost");

      if (originClean !== registeredClean && refererClean !== registeredClean && !isLocal) {
         console.warn(`🚨 Anti-Hijack Triggered: SMS requested from unauthorized domain (${originClean || refererClean}). Expected ${registeredClean}.`);
         return NextResponse.json(
           { success: false, error: "Unauthorized host domain. Player hijacking detected." }, 
           { status: 403, headers: corsHeaders }
         );
      }
    }

    const normalizedPhone = phoneNumber.replace(/\D/g, ""); // Sanitize to digits only
    
    // 🚀 GAP 4 MITIGATED: THE E2E AUTOMATION GUARDRAIL
    // Detects Twilio's official sandbox test number for Selenium automation
    const isTestRunner = normalizedPhone === "15005550006";

    // 🚀 GAP 1 MITIGATED: COMPOSITE ID TENANT SCOPING (Avoids B2B/B2C Collision & Complex Queries)
    // Directly targets the document using the exact Webhook composite ID structure
    const compositeId = `${studioKey}_${assetId}_${normalizedPhone}`;
    const entitlementRef = adminDb.collection("entitlements").doc(compositeId);
    const entitlementDoc = await entitlementRef.get();

    if (!entitlementDoc.exists) {
      console.warn(`⚠️ SMS Blocked: No active entitlement found for composite ID ${compositeId}`);
      return NextResponse.json(
        { success: false, error: "Access Denied. No active purchase found for this phone number." },
        { status: 403, headers: corsHeaders }
      );
    }

    // 🚀 DYNAMIC OTP GENERATION: Uses 123456 strictly for the test runner, random otherwise
    const otpCode = isTestRunner ? "123456" : Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); 

    await entitlementRef.update({
      currentOtp: otpCode,
      otpExpiresAt: expiresAt.toISOString(),
    });

    // 🚀 NETWORK BYPASS: If it's a test runner, skip Twilio completely
    if (isTestRunner) {
      console.log("🧪 E2E Test Intercept: Bypassing Twilio dispatch for magic number. Returning static OTP success.");
      return NextResponse.json({ 
        success: true, 
        message: "Test OTP successfully staged." 
      }, { status: 200, headers: corsHeaders });
    }

    // 6. STANDARD TWILIO DISPATCH (For real human users)
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!twilioSid || !twilioAuth || !twilioNumber) {
        throw new Error("Twilio environment variables are not configured on Vercel.");
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const twilioParams = new URLSearchParams({
        To: `+${normalizedPhone}`,
        From: twilioNumber,
        Body: `Your KOBA-I Audio verification code is: ${otpCode}. It expires in 10 minutes.`
    });

    const twilioResponse = await fetch(twilioUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " + Buffer.from(`${twilioSid}:${twilioAuth}`).toString("base64")
        },
        body: twilioParams.toString()
    });

    if (!twilioResponse.ok) {
        const errorData = await twilioResponse.text();
        console.error("🚨 Twilio Dispatch Failed:", errorData);
        throw new Error("Failed to dispatch SMS via Twilio network.");
    }

    return NextResponse.json({ 
        success: true, 
        message: "OTP successfully dispatched." 
    }, { status: 200, headers: corsHeaders });

  } catch (error: any) {
    console.error("🔥 SMS Gateway Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error during SMS dispatch.", details: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}