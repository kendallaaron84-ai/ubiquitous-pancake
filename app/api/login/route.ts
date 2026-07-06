import { NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/core/firebase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // 1. Hardened Request Body Validation Gate
    const text = await request.text();
    if (!text || text.trim() === "") {
      return NextResponse.json(
        { success: false, error: "Empty authorization handshake payload." },
        { status: 400 }
      );
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (parseBodyErr) {
      return NextResponse.json(
        { success: false, error: "Malformed request format. Valid JSON required." },
        { status: 400 }
      );
    }

    const { idToken } = payload;
    if (!idToken) {
      return NextResponse.json(
        { success: false, error: "Identity exchange token is required." },
        { status: 400 }
      );
    }

    // 2. Decode Client-Side Token through Modular Admin Auth Layer
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
    } catch (verifyErr: any) {
      console.error("🚨 ID Token Verification Failed in Admin SDK:", verifyErr.message);
      return NextResponse.json(
        { success: false, error: "Invalid identity token.", details: verifyErr.message },
        { status: 401 }
      );
    }

    const email = decodedToken.email;
    if (!email) {
      return NextResponse.json(
        { success: false, error: "Profile missing valid email claims." },
        { status: 400 }
      );
    }

    // 3. Multi-Tenant Lookup and Auto-Provisioning Logic
    let userDoc = await adminDb.collection("users").doc(email).get();
    let userData = userDoc.exists ? userDoc.data() : null;

    // Search secondary index if direct Document ID misses
    if (!userData) {
      const userQuery = await adminDb.collection("users").where("email", "==", email).get();
      if (!userQuery.empty) {
        userDoc = userQuery.docs[0];
        userData = userDoc.data();
      }
    }

    // 🚀 AGGRESSIVE PROVISIONING: Check license if user doesn't exist OR lacks active flag/keys
    if (!userData || userData.hasActiveLicense !== true || !userData.studioKey) {
      console.log(`🔍 Checking license files for auto-provisioning/upgrading: ${email}`);
      const licenseQuery = await adminDb.collection("licenses")
        .where("authorEmail", "==", email)
        .where("status", "==", "active")
        .get();

      if (!licenseQuery.empty) {
        console.log(`🎯 Auto-Provisioning: Found active asset contract for ${email}. Building profile record...`);
        const licenseDoc = licenseQuery.docs[0];
        const licenseData = licenseDoc.data();
        
        userData = {
          email: email,
          name: userData?.name || licenseData.authorName || "Sovereign Author",
          hasActiveLicense: true,
          authConfigured: true, 
          lastPurchaseDate: licenseData.createdAt || new Date().toISOString(),
          createdAt: userData?.createdAt || new Date().toISOString(),
          // 🚀 THE FIX: Bridge the chasm by mapping the relational keys to the User Profile
          studioKey: licenseData.studiokey || licenseData.studioKey || licenseDoc.id,
          stripeCustomerId: licenseData.stripeCustomerId || licenseData.stripeAccountId || null,
        };

        // Write row atomically to users collection (upsert)
        await adminDb.collection("users").doc(email).set(userData, { merge: true });
      } else {
        console.warn(`⚠️ Multi-tenant lock: Access denied for ${email}. Active product contract required.`);
        return NextResponse.json(
          { success: false, error: "Unauthorized profile workspace. Active product license required." },
          { status: 403 }
        );
      }
    }

    // 4. Issue a Secured Server-Side Custom Token Session
    const secureToken = await adminAuth.createCustomToken(decodedToken.uid);

    const response = NextResponse.json({
      success: true,
      message: "Identity token verification successful.",
      sessionToken: secureToken,
      user: {
        email,
        name: userData.name || "Sovereign Author",
        studioKey: userData.studioKey || null, // Pass to the frontend layout so the Catalog can use it
      }
    }, { status: 200 });

    // Enforce Production HttpOnly Security Policies
    response.cookies.set("session-token", secureToken, {
      path: "/",
      maxAge: 86400, // 24 Hours
      sameSite: "strict",
      secure: true
    });

    return response;

  } catch (err: any) {
    console.error("🔥 Identity exchange processing failed:", err);
    return NextResponse.json(
      { success: false, error: "Server rejected identity exchange token verification.", details: err.message },
      { status: 500 }
    );
  }
}