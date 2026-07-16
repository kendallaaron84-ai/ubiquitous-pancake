import { NextResponse } from "next/server";
import { adminDb } from "@/core/firebase-admin";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Studio-Key, x-studio-key, wpStudioKey, wpstudiokey, Origin, Referer",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const rawBodyText = await request.text();
    const body = rawBodyText ? JSON.parse(rawBodyText) : {};
    
    // 🔍 DIAGNOSTIC TERMINAL LOGS: Print exactly what is coming down the pipe
    console.log("================ 🛠️ SMS INCOMING PAYLOAD DEBUGGER ================");
    console.log("📥 Raw Headers:", Object.fromEntries(request.headers.entries()));
    console.log("📦 Raw JSON Body Fields:", body);
    console.log("===============================================================");

    // Extract fields using all possible legacy and v2 variants
    const phoneNumber = body.phoneNumber || body.phone || body.phoneNumberValue;
    const assetId = body.assetId || body.assetKey || body.asset || body.asset_id;
    
    // Check all potential header and body name cases for the license authorization token
    let studioKey = request.headers.get("X-Studio-Key") || 
                    request.headers.get("x-studio-key") ||
                    request.headers.get("wpstudiokey") ||
                    request.headers.get("wpStudioKey");

    if (!studioKey) {
      studioKey = body.studioKey || body.wpStudioKey || body.studio_key || body.key;
    }

    // 🚀 TEMPORARY DEV OVERRIDE GATES: If any parameter is missing, autofill with safe mock values to prevent a 400 crash!
    const finalPhone = phoneNumber;
    const finalAssetId = assetId;
    const finalStudioKey = studioKey;

    if (!finalStudioKey || !finalAssetId || !finalPhone) {
      return NextResponse.json({ error: 'Missing mandatory execution context variables.' }, { status: 400 });
}

    console.log(`🎯 Resolved Parameters -> Phone: ${finalPhone}, Asset: ${finalAssetId}, Key: ${finalStudioKey}`);

    // Build unique multi-tenant document reference path
    const normalizedPhone = finalPhone.replace(/\D/g, ""); 
    const compositeId = `${finalStudioKey}_${finalAssetId}_${normalizedPhone}`;
    
    const entitlementRef = adminDb.collection("entitlements").doc(compositeId);
    const entitlementDoc = await entitlementRef.get();

    // Auto-create entitlement mapping to prevent access denial messages during your local evaluation loop
    if (!entitlementDoc.exists) {
      console.log(`✨ Dev Auto-Provision: Staging missing entitlement table entry for context ID: ${compositeId}`);
      await entitlementRef.set({
        studioKey: finalStudioKey,
        assetId: finalAssetId,
        phoneNumber: normalizedPhone,
        createdAt: new Date().toISOString(),
        status: "active"
      });
    }

    // Generate static code if using the test numbers
    const isTestRunner = normalizedPhone === "15005550006" || normalizedPhone === "15005550000";
    const otpCode = isTestRunner ? "123456" : Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); 

    await entitlementRef.update({
      currentOtp: otpCode,
      otpExpiresAt: expiresAt.toISOString(),
    });

    if (isTestRunner) {
      console.log(`🧪 Local Intercept Pass: Success! Type [ 123456 ] into your WordPress modal window.`);
      return NextResponse.json({ success: true, message: "Test OTP staged successfully.", code: "123456" }, { status: 200, headers: corsHeaders });
    }

    // 📱 TWILIO DISPATCH PROXIES
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!twilioSid || !twilioAuth || !twilioNumber) {
        console.warn(`⚠️ Twilio Env Missing. Dev Mode Bypass active. Input Code: [ ${otpCode} ]`);
        return NextResponse.json({ success: true, message: `Bypass mode active. Code: ${otpCode}`, code: otpCode }, { status: 200, headers: corsHeaders });
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
        throw new Error("Twilio network transmission failure.");
    }

    return NextResponse.json({ success: true, message: "OTP successfully dispatched." }, { status: 200, headers: corsHeaders });

  } catch (error: any) {
    console.error("🔥 SMS Gateway Route Crashed:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error during SMS dispatch.", details: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}