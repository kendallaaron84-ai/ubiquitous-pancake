import { NextResponse } from 'next/server';
import { adminDb } from '@/core/firebase-admin';
import admin from 'firebase-admin';

export const dynamic = 'force-dynamic';

// Initialize Firebase Admin safely inside serverless contexts to prevent double-initialization crashes
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

export async function POST(request: Request) {
  try {
    const { email, license, password } = await request.json();

    // 1. Validation Checks
    if (!email || !license || !password) {
      return NextResponse.json({ error: 'Missing email, license key, or password.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long.' }, { status: 400 });
    }

    // 2. Validate Key existence in the central registry
    const licenseDoc = await adminDb.collection('licenses').doc(license).get();
    if (!licenseDoc.exists) {
      return NextResponse.json({ error: 'The provided license key was not found.' }, { status: 403 });
    }

    const licenseData = licenseDoc.data();
    if (!licenseData || licenseData.status !== 'active') {
      return NextResponse.json({ error: 'This license key is currently inactive.' }, { status: 403 });
    }

    // Secure owner mapping verification
    if (licenseData.authorEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: 'License key ownership verification failed.' }, { status: 403 });
    }

    // 3. Verify user profile state
    const userDocRef = adminDb.collection('users').doc(email);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User profile not found. Check purchase webhook.' }, { status: 404 });
    }

    const userData = userDoc.data() || {};
    
    // Safety check: Prevent re-running password setups on active accounts
    if (userData.authConfigured === true) {
      return NextResponse.json({ error: 'This profile is already activated. Please log in directly.' }, { status: 409 });
    }

    // 4. Atomic Auth User Provisioning
    let firebaseUser: admin.auth.UserRecord;
    
    try {
      firebaseUser = await adminAuth.getUserByEmail(email);
      console.log(`ℹ️ Auth record exists for ${email}. Programmatically updating credentials...`);
      await adminAuth.updateUser(firebaseUser.uid, { password });
    } catch (authError: any) {
      if (authError.code === 'auth/user-not-found') {
        console.log(`🚀 Creating fresh credentials in Auth directory for ${email}...`);
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

    // 5. Update initialization state flags
    await userDocRef.set({
      authConfigured: true,
      lastLoginDate: new Date().toISOString()
    }, { merge: true });

    // 6. Generate secure claims token for instant login on submit
    const customToken = await adminAuth.createCustomToken(firebaseUser.uid);
    console.log(`✅ Secure credentials claimed. Initiating direct login sequence for: ${email}`);

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