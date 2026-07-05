import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

// 🚀 FIXED: Safely check initialized apps using the modular App Router method
if (getApps().length === 0) {
  try {
    if (process.env.FIREBASE_PRIVATE_KEY) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID || "author-jubilee-command-center",
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Safely handles the multi-line private key format from Vercel
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
        // 🚀 CRITICAL: Added the storage bucket from your other file
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      });
      console.log("🚀 Firebase Admin SDK initialized seamlessly.");
    } else {
      console.warn("⚠️ FIREBASE_PRIVATE_KEY is missing. Skipping init during static build.");
    }
  } catch (error) {
    console.error("❌ Firebase Admin SDK critical initialization failure:", error);
  }
}

const adminDb = getFirestore();
const adminAuth = getAuth();
const adminStorage = getStorage();

// Exporting an 'admin' fallback object just in case any of your legacy files still import it
const admin = {
    auth: () => adminAuth,
    firestore: () => adminDb,
    storage: () => adminStorage
};

// We export both names (auth/adminAuth) so we don't break any of your existing imports
export { admin, adminAuth as auth, adminAuth, adminDb, adminStorage as storage, adminStorage };