import * as admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID || "author-jubilee-command-center";

if (!admin.apps.length) {
  try {
    // Vercel relies entirely on these environment variables in production
    if (process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Safely handles the multi-line private key format from Vercel
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
      console.log("🚀 Firebase Admin SDK initialized seamlessly via Vercel Environment Variables.");
    } else {
      console.warn("⚠️ FIREBASE_PRIVATE_KEY is missing. Skipping init (Normal during Vercel static build phase).");
    }
  } catch (error) {
    console.error("❌ Firebase Admin SDK critical initialization failure:", error);
  }
}

const auth = admin.auth();
const adminDb = admin.firestore(); // 🚀 FIXED: Renamed to adminDb to match your API routes
const storage = admin.storage();

export { admin, auth, adminDb, storage };