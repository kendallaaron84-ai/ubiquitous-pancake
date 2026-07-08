import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  try {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
    let clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
    let projectId = process.env.FIREBASE_PROJECT_ID || '';
    
    // 🛡️ Aggressively clean ALL variables of rogue spaces, quotes, and bad line breaks
    privateKey = privateKey.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();
    clientEmail = clientEmail.replace(/^"|"$/g, '').trim();
    projectId = projectId.replace(/^"|"$/g, '').trim();

    if (privateKey && clientEmail && projectId) {
      initializeApp({
        credential: cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: privateKey,
        }),
      });
      console.log(`🔥 Firebase Admin securely connected to Project: ${projectId}`);
    } else {
      console.warn('⚠️ Firebase environment variables missing. Admin SDK bypassed.');
    }
  } catch (error: any) {
    console.error('🚨 Firebase Admin Initialization Error:', error.message);
  }
}

// Export the modular instances cleanly
export const adminDb = getApps().length ? getFirestore() : null as any;
export const adminAuth = getApps().length ? getAuth() : null as any;