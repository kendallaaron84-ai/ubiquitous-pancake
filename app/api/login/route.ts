// Filepath: app/api/login/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { idToken } = await request.json();

    if (!idToken) {
      return NextResponse.json({ error: "Missing identity token" }, { status: 400 });
    }

    // 1. DYNAMIC RUNTIME IMPORT: Keeps Firebase Admin isolated from static compilation errors
    const admin = require("firebase-admin");
    if (!admin || !admin.apps) {
      throw new Error("Failed to load firebase-admin at runtime.");
    }

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }

    const adminAuth = admin.auth();
    const adminDb = admin.firestore();

    // 2. Verify the client-side ID Token
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
    } catch (verifyErr: any) {
      console.error("🚨 ID Token Verification Failed in Admin SDK:", verifyErr.message);
      return NextResponse.json({ error: "Invalid client identity token", details: verifyErr.message }, { status: 401 });
    }

    const email = decodedToken.email;
    if (!email) {
      return NextResponse.json({ error: "Email missing from token properties" }, { status: 400 });
    }

    // 3. Multi-tenant Check: Confirm user exists and has active licenses
    const userDoc = await adminDb.collection("users").doc(email).get();

    if (!userDoc.exists) {
      console.warn(`⚠️ Multi-tenant lock: Profile not found for ${email}. Sign-in blocked.`);
      return NextResponse.json({ error: "Unauthorized access profile. Check your license." }, { status: 403 });
    }

    const userData = userDoc.data();
    if (!userData || !userData.hasActiveLicense) {
      console.warn(`⚠️ Multi-tenant lock: Profile ${email} exists but lacks an active license flag.`);
      return NextResponse.json({ error: "Active license required to access the dashboard." }, { status: 403 });
    }

    // 4. Generate a secure server-side session token
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
      secure: process.env.NODE_ENV === "production"
    });

    return response;

  } catch (err: any) {
    console.error("🔥 Identity exchange processing failed:", err);
    return NextResponse.json({ error: "Server rejected identity exchange token verification", details: err.message }, { status: 500 });
  }
}