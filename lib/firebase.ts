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

// The Static Compiler Bypass
let app;
if (getApps().length === 0) {
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    app = initializeApp(firebaseConfig);
  } else {
    console.warn("⚠️ Client API keys missing during static build. Engaging mock initialization.");
    app = initializeApp({
        apiKey: "build-phase-bypass",
        projectId: "author-jubilee-command-center"
    }, "build-bypass");
  }
} else {
  app = getApp();
}

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// 🚀 FIXED: All necessary services are properly exported for your React components
export { app, auth, db, storage };