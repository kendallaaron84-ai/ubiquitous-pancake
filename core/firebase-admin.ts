<<<<<<< HEAD
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.FIREBASE_PROJECT_ID || "author-jubilee-command-center";

if (getApps().length === 0) {
  try {
    if (process.env.FIREBASE_PRIVATE_KEY) {
      initializeApp({
        credential: cert({
          projectId: projectId,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      });
      console.log("🚀 Firebase Admin SDK initialized seamlessly.");
    } else {
      console.warn("⚠️ FIREBASE_PRIVATE_KEY is missing. Skipping init during static build.");
    }
  } catch (error) {
    console.error("❌ Firebase Admin SDK critical initialization failure:", error);
  }
=======
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET // Ensure this is in your Vercel env variables
  });
>>>>>>> 80a22832dd2986b8b39a726d98efff9d6311bc64
}

export const adminDb = getFirestore();
export const adminAuth = getAuth();
<<<<<<< HEAD
export const adminStorage = getStorage();
=======
export const adminStorage = getStorage();
>>>>>>> 80a22832dd2986b8b39a726d98efff9d6311bc64
