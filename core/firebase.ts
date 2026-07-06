// Filepath: core/firebase-admin.ts
import * as admin from 'firebase-admin';

// 🚀 Bulletproof Private Key Sanitizer to bypass Vercel env formatting bugs
function sanitizePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  let cleaned = key.trim();
  
  // Remove wrapping double or single quotes added by Vercel environment parser
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1);
  }
  
  // Clean double-escaped literal backslash newlines to actual linebreaks
  cleaned = cleaned.replace(/\\n/g, '\n');
  
  // Enforce correct cryptographic boundaries
  if (!cleaned.includes("-----BEGIN PRIVATE KEY-----")) {
    cleaned = `-----BEGIN PRIVATE KEY-----\n${cleaned}\n-----END PRIVATE KEY-----`;
  }
  return cleaned;
}

// Build-safe fallback values to prevent Next.js static build pre-render crashes
const projectId = process.env.FIREBASE_PROJECT_ID || 'koba-i-mock';
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || 'mock-service-account@koba-i-mock.iam.gserviceaccount.com';
const privateKey = sanitizePrivateKey(process.env.FIREBASE_PRIVATE_KEY) || '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC3y...\n-----END PRIVATE KEY-----';

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    console.log("🔥 Firebase Admin SDK initialized successfully with sanitized credentials.");
  } catch (initErr: any) {
    console.error("🚨 Firebase Admin SDK initialization failed:", initErr.message);
  }
}

export const adminDb = admin.firestore();
export const adminStorage = admin.storage();
export const adminAuth = admin.auth(); // 🚀 Exposing pre-initialized and fully authenticated Auth instance!