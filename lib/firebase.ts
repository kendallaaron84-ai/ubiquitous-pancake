import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app;

// 🚀 FIXED: Strict Environment Isolation
if (typeof window === "undefined") {
  // WE ARE ON THE VERCEL SERVER (Build Phase or SSR)
  // Safely mock initialization so the compiler doesn't crash
  if (getApps().length === 0) {
    app = initializeApp({
        apiKey: "build-phase-bypass",
        projectId: "author-jubilee-command-center"
    }, "server-bypass");
  } else {
    app = getApp("server-bypass");
  }
} else {
  // WE ARE IN THE LIVE BROWSER
  // Enforce real keys. If this fails, the environment variables were not baked in.
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "build-phase-bypass") {
    console.error("❌ CRITICAL: NEXT_PUBLIC_FIREBASE_API_KEY is completely missing from the browser bundle. Check Vercel Environment Variables.");
  }
  
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }
}

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };