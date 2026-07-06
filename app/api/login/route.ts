// Filepath: app/api/login/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 1. Bulletproof PEM Private Key Sanitizer
function sanitizePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  let cleaned = key.trim();
  
  // Remove wrapping double or single quotes added by Vercel environment parser
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1);
  }
  
  // Standardize backslash newline escapes to literal linebreaks
  cleaned = cleaned.replace(/\\n/g, '\n');
  
  // Enforce correct cryptographic boundaries
  if (!cleaned.includes("-----BEGIN PRIVATE KEY-----")) {
    cleaned = `-----BEGIN PRIVATE KEY-----\n${cleaned}\n-----END PRIVATE KEY-----`;
  }
  return cleaned;
}

export async function POST(request: Request) {
  try {
    const { idToken } = await request.json();

    if (!idToken) {
      return NextResponse.json({ error: "Missing identity token" }, { status: 400 });
    }

    // 2. DYNAMIC RUNTIME REQUIRE: Protects Next.js compiler from static build crashes
    const admin = require("firebase-admin");
    if (!admin || !admin.apps) {
      throw new Error("Failed to load firebase-admin at runtime.");
    }

    const formattedKey = sanitizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    const apps = admin.apps || [];

    if (apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: formattedKey,
        }),
      });
    }

    const adminAuth = admin.auth();
    const adminDb = admin.firestore();

    // 3. Verify client identity token
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

    // 4. Multi-tenant Authorization Checklist
    let userDoc = await adminDb.collection("users").doc(email).get();
    let userData = userDoc.exists ? userDoc.data() : null;

    // Loose lookup 1: Search by email property if direct doc ID matches miss
    if (!userData) {
      const userQuery = await adminDb.collection("users").where("email", "==", email).get();
      if (!userQuery.empty) {
        userDoc = userQuery.docs[0];
        userData = userDoc.data();
      }
    }

    // Loose lookup 2: Auto-provision profile on-the-fly for social login (Google)
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
          authConfigured: true, // Social auth is configured by default
          lastPurchaseDate: licenseData.createdAt || new Date().toISOString(),
          createdAt: new Date().toISOString()
        };

        // Save record atomically
        await adminDb.collection("users").doc(email).set(userData);
      } else {
        console.warn(`⚠️ Multi-tenant lock: No matching active license found for ${email}. Sign-in blocked.`);
        return NextResponse.json({ error: "Unauthorized profile. Active product license required." }, { status: 403 });
      }
    }

    // Validate license compliance
    if (!userData.hasActiveLicense) {
      console.warn(`⚠️ Multi-tenant lock: Profile ${email} exists but lacks active license flag.`);
      return NextResponse.json({ error: "Active license required to access the dashboard." }, { status: 403 });
    }

    // 5. Generate secure exchange session token
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

    // Deploy cookie payload
    response.cookies.set("session-token", secureToken, {
      path: "/",
      maxAge: 86400, // 24 hours
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production"
    });

    return response;

  } catch (err: any) {
    console.error("🔥 Identity exchange processing failed:", err);
    return NextResponse.json({ 
      error: "Server rejected identity exchange token verification", 
      details: err.message,
      environmentCheck: {
        hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY
      }
    }, { status: 500 });
  }
}