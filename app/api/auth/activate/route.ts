// Filepath: app/api/auth/activate/route.ts
import { NextResponse } from 'next/server';
import { adminDb } from '@/core/firebase-admin'; // 🚀 Guarantees Firebase Admin is initialized centrally!

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { email, license, password } = await request.json();

    // 1. Validation checkpoint
    if (!email || !license || !password) {
      return NextResponse.json({ error: 'Missing email, license key, or password.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long.' }, { status: 400 });
    }

    // 2. Validate the License Key in Firestore
    const licenseDoc = await adminDb.collection('licenses').doc(license).get();
    if (!licenseDoc.exists) {
      return NextResponse.json({ error: 'The provided license key was not found.' }, { status: 403 });
    }

    const licenseData = licenseDoc.data() || {};
    if (licenseData.status !== 'active') {
      return NextResponse.json({ error: 'This license key is currently inactive.' }, { status: 403 });
    }

    // Secure owner mapping verification (checks field case-insensitively)
    const authorEmail = licenseData.authorEmail || '';
    if (authorEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: 'The license key ownership mismatch.' }, { status: 403 });
    }

    // 3. Verify user profile exist - Self-Healing Implementation
    const userDocRef = adminDb.collection('users').doc(email);
    const userDoc = await userDocRef.get();

    let userData = userDoc.exists ? userDoc.data() : null;

    // 🚀 SELF-HEALING BLOCK: If the user record does not exist or lacks fields, reconstruct it safely!
    if (!userData) {
      console.log(`🎯 Self-Healing: Active license found for ${email} but user row is missing. Auto-provisioning...`);
      userData = {
        email: email,
        name: licenseData.authorName || 'Sovereign Author',
        hasActiveLicense: true,
        authConfigured: false,
        createdAt: new Date().toISOString()
      };
      await userDocRef.set(userData);
    }
    
    // Safety lock: prevent re-claiming or rewriting password via this endpoint after activation
    if (userData.authConfigured === true) {
      return NextResponse.json({ error: 'This profile is already activated. Please log in directly.' }, { status: 409 });
    }

    // 4. DYNAMIC RUNTIME IMPORT: Inherits initialized state from @/core/firebase-admin safely
    const admin = require('firebase-admin');
    const adminAuth = admin.auth();

    // 5. ATOMIC USER PROVISIONING: Setup Credentials in Firebase Auth
    let firebaseUser;
    
    try {
      // Check if auth record already exists
      firebaseUser = await adminAuth.getUserByEmail(email);
      console.log(`ℹ️ Auth record exists for ${email}. Programmatically updating password...`);
      await adminAuth.updateUser(firebaseUser.uid, { password });
    } catch (authError: any) {
      if (authError.code === 'auth/user-not-found') {
        // Create brand new user
        console.log(`🚀 Creating brand new user auth credentials for ${email}...`);
        firebaseUser = await adminAuth.createUser({
          email,
          password,
          displayName: userData.name || licenseData.authorName || 'Sovereign Author',
          emailVerified: true,
        });
      } else {
        throw authError;
      }
    }

    // 6. Update the Database configuration state to finalize claims setup
    await userDocRef.set({
      authConfigured: true,
      lastLoginDate: new Date().toISOString()
    }, { merge: true });

    // 7. 🔑 CUSTOM TOKEN HANDSHAKE: Instant hydration of client session
    const customToken = await adminAuth.createCustomToken(firebaseUser.uid);
    console.log(`✅ Secure claims claimed: Auth constructed for ${email}. Instantly logging user into KOBA-I Audio.`);

    return NextResponse.json({
      success: true,
      message: 'Onboarding complete. Authenticated session constructed.',
      customToken,
      email: firebaseUser.email,
      name: firebaseUser.displayName
    }, { status: 200 });

  } catch (error: any) {
    console.error('🔥 Activate Auth Handshake Exception:', error);
    return NextResponse.json({ error: 'Verification or auth initialization crashed.', details: error.message }, { status: 500 });
  }
}