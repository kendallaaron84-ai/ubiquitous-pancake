// Filepath: core/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { validateFirebasePublicConfig } from "@/core/firebase-config";

// 🚀 Safe evaluation of client-side environment keys (NEXT_PUBLIC_ prefixes prevent leaking keys to the client bundle)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
validateFirebasePublicConfig(firebaseConfig);

// Initialize the Firebase Web client safely, reusing any existing app context to prevent double-init memory leaks
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

declare global {
  // HMR may evaluate this module repeatedly. A global marker prevents duplicate
  // emulator connection attempts while keeping production initialization intact.
  var __kobaFirebaseEmulatorsConnected: boolean | undefined;
}

if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
  !globalThis.__kobaFirebaseEmulatorsConnected
) {
  const emulatorHost = window.location.hostname === "localhost" ? "localhost" : "127.0.0.1";
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, emulatorHost, 8087);
  connectStorageEmulator(storage, emulatorHost, 9199);
  globalThis.__kobaFirebaseEmulatorsConnected = true;
}
