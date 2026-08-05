import {
  cert,
  getApps,
  initializeApp,
  type App,
  type AppOptions,
  type Credential,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

export const FIREBASE_ADMIN_NOT_CONFIGURED =
  "FIREBASE_ADMIN_NOT_CONFIGURED" as const;

export class FirebaseAdminConfigurationError extends Error {
  readonly code = FIREBASE_ADMIN_NOT_CONFIGURED;
  readonly missingVariables: readonly string[];

  constructor(message: string, missingVariables: readonly string[] = []) {
    super(message);
    this.name = "FirebaseAdminConfigurationError";
    this.missingVariables = missingVariables;
  }
}

export interface FirebaseAdminEnvironment {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
}

export interface FirebaseAdminServices {
  app: App;
  auth: Auth;
  db: Firestore;
  storage: Storage;
}

interface FirebaseAdminDependencies {
  getApps(): App[];
  initializeApp(options: AppOptions): App;
  cert(serviceAccount: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  }): Credential;
  getAuth(app: App): Auth;
  getFirestore(app: App): Firestore;
  getStorage(app: App): Storage;
}

const defaultDependencies: FirebaseAdminDependencies = {
  getApps,
  initializeApp,
  cert,
  getAuth,
  getFirestore,
  getStorage,
};

function normalizeEnvironmentValue(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function loadFirebaseAdminConfiguration(
  environment: FirebaseAdminEnvironment = process.env
) {
  const projectId = normalizeEnvironmentValue(environment.FIREBASE_PROJECT_ID);
  const clientEmail = normalizeEnvironmentValue(
    environment.FIREBASE_CLIENT_EMAIL
  );
  const privateKey = normalizeEnvironmentValue(
    environment.FIREBASE_PRIVATE_KEY
  )
    .replace(/\\n/g, "\n")
    .trim();
  const missingVariables = [
    !projectId && "FIREBASE_PROJECT_ID",
    !clientEmail && "FIREBASE_CLIENT_EMAIL",
    !privateKey && "FIREBASE_PRIVATE_KEY",
  ].filter((value): value is string => Boolean(value));

  if (missingVariables.length > 0) {
    throw new FirebaseAdminConfigurationError(
      `Firebase Admin requires: ${missingVariables.join(", ")}.`,
      missingVariables
    );
  }

  return { projectId, clientEmail, privateKey };
}

export function createFirebaseAdminServices(
  environment: FirebaseAdminEnvironment = process.env,
  dependencies: FirebaseAdminDependencies = defaultDependencies
): FirebaseAdminServices {
  try {
    const existingApp = dependencies.getApps()[0];
    const app =
      existingApp ??
      (() => {
        const configuration = loadFirebaseAdminConfiguration(environment);
        return dependencies.initializeApp({
          credential: dependencies.cert(configuration),
        });
      })();
    const auth = dependencies.getAuth(app);

    if (!auth || typeof auth.verifyIdToken !== "function") {
      throw new FirebaseAdminConfigurationError(
        "Firebase Admin Auth did not initialize correctly."
      );
    }

    return {
      app,
      auth,
      db: dependencies.getFirestore(app),
      storage: dependencies.getStorage(app),
    };
  } catch (error: unknown) {
    if (error instanceof FirebaseAdminConfigurationError) {
      throw error;
    }

    throw new FirebaseAdminConfigurationError(
      "Firebase Admin could not initialize from the configured server credentials."
    );
  }
}

export function getFirebaseAdminServices(): FirebaseAdminServices {
  return createFirebaseAdminServices(process.env, defaultDependencies);
}

export function getFirebaseAdminAuth(): Auth {
  return getFirebaseAdminServices().auth;
}

// Compatibility exports for existing server modules. New request handlers should
// resolve services with getFirebaseAdminServices() so configuration errors can be
// returned deliberately instead of dereferencing a nullable singleton.
let compatibilityServices: FirebaseAdminServices | null = null;
try {
  compatibilityServices = getFirebaseAdminServices();
} catch {
  compatibilityServices = null;
}

export const adminDb = compatibilityServices?.db as Firestore;
export const adminStorage = compatibilityServices?.storage as Storage;
