import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.FIREBASE_PROJECT_ID || "author-jubilee-command-center";

// 🚀 FIXED: Safely check initialized apps using the modular App Router method
if (getApps().length === 0) {
  try {
    if (process.env.FIREBASE_PRIVATE_KEY) {
      initializeApp({
        credential: cert({
          projectId: projectId,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Safely handles the multi-line private key format from Vercel
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
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
const auth = getAuth();
const storage = getStorage();

// Exporting an 'admin' fallback object just in case any of your legacy files still import it
const admin = {
    auth: () => auth,
    firestore: () => adminDb,
    storage: () => storage
};

export { admin, auth, adminDb, storage };