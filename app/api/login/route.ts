// Filepath: app/api/login/route.ts
import { NextResponse } from "next/server";
import { adminDb, adminAuth } from '@/core/firebase-admin'; // 🚀 Direct, modular imports!

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // Safely check if the body has content to prevent parsing crashes
    const text = await request.text();
    if (!text) {
      return NextResponse.json({ error: "Empty request payload sent to handshake" }, { status: 400 });
    }

    const { idToken } = JSON.parse(text);

    if (!idToken) {
      return NextResponse.json({ error: "Missing identity token" }, { status: 400 });
    }

    // 1. Verify the client-side ID Token using the centralized modular Auth engine
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
    } catch (verifyErr: any) {
      console.error("🚨 ID Token Verification Failed in Admin SDK:", verifyErr.message);
      return NextResponse.json({ 
        success: false,
        error: "Invalid client identity token", 
        details: verifyErr.message 
      }, { status: 401 });
    }

    const email = decodedToken.email;
    if (!email) {
      return NextResponse.json({ error: "Email missing from token properties" }, { status: 400 });
    }

    // 2. Confirm user exists in Firestore
    let userDoc = await adminDb.collection("users").doc(email).get();
    let userData = userDoc.exists ? userDoc.data() : null;

    // Loose lookup 1: Search by the email property if direct document ID fetch misses
    if (!userData) {
      const userQuery = await adminDb.collection("users").where("email", "==", email).get();
      if (!userQuery.empty) {
        userDoc = userQuery.docs[0];
        userData = userDoc.data();
      }
    }

    // Loose lookup 2: Auto-Provisioning if active product license exists
    if (!userData) {
      console.log(`🔍 Checking licenses for Google Sign-In verification of email: ${email}`);
      const licenseQuery = await adminDb.collection("licenses")
        .where("authorEmail", "==", email)
        .where("status", "==", "active")
        .get();

      if (!licenseQuery.empty) {
        console.log(`🎯 Auto-Provisioning: Active license found for ${email}. Constructing Firestore profile...`);
        const licenseData = licenseQuery.docs[0].data();
        
        userData = {
          email: email,
          name: licenseData.authorName || "Sovereign Author",
          hasActiveLicense: true,
          authConfigured: true, 
          lastPurchaseDate: licenseData.createdAt || new Date().toISOString(),
          createdAt: new Date().toISOString()
        };

        // Write row atomically
        await adminDb.collection("users").doc(email).set(userData);
      } else {
        console.warn(`⚠️ Multi-tenant lock: No matching active license found for ${email}. Sign-in blocked.`);
        return NextResponse.json({ 
          success: false,
          error: "Unauthorized profile. Active product license required." 
        }, { status: 403 });
      }
    }

    // Double check active license state
    if (!userData.hasActiveLicense) {
      console.warn(`⚠️ Multi-tenant lock: Profile ${email} exists but lacks active license flag.`);
      return NextResponse.json({ 
        success: false,
        error: "Active license required to access the dashboard." 
      }, { status: 403 });
    }

    // 3. Generate a secure server-side session token
    const secureToken = await adminAuth.createCustomToken(decodedToken.uid);

    const response = NextResponse.json({
      success: true,
      message: "Identity token verification successful.",
      sessionToken: secureToken,
      user: {
        email,
        name: userData.name || "Sovereign Author"
      }
    }, { status: 200 });

    // Set server-side session-token cookie
    response.cookies.set("session-token", secureToken, {
      path: "/",
      maxAge: 86400, // 24 hours
      sameSite: "strict",
      secure: true // Enforced secure for production environments
    });

    return response;

  } catch (err: any) {
    console.error("🔥 Identity exchange processing failed:", err);
    return NextResponse.json({ 
      success: false,
      error: "Server rejected identity exchange token verification", 
      details: err.message 
    }, { status: 500 });
  }
}