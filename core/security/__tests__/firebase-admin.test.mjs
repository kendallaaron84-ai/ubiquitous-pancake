import assert from "node:assert/strict";
import test from "node:test";

import {
  FirebaseAdminConfigurationError,
  createFirebaseAdminServices,
  loadFirebaseAdminConfiguration,
  resolveFirebaseStorageBucketName,
} from "../../firebase-admin.ts";

function createEnvironment(overrides = {}) {
  return {
    FIREBASE_PROJECT_ID: "production-project",
    FIREBASE_CLIENT_EMAIL: "firebase-admin@example.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY:
      '"-----BEGIN PRIVATE KEY-----\\nprivate-material\\n-----END PRIVATE KEY-----\\n"',
    FIREBASE_STORAGE_BUCKET: "production-project.firebasestorage.app",
    ...overrides,
  };
}

function createDependencies(options = {}) {
  const calls = {
    cert: [],
    initializeApp: 0,
    getAuth: 0,
  };
  const app = { name: "test-admin-app" };
  const auth = Object.prototype.hasOwnProperty.call(options, "auth")
    ? options.auth
    : {
        verifyIdToken: async () => ({ uid: "reader-1" }),
      };
  const dependencies = {
    getApps: () => options.existingApps ?? [],
    cert: (configuration) => {
      calls.cert.push(configuration);
      return { configuration };
    },
    initializeApp: () => {
      calls.initializeApp += 1;
      return app;
    },
    getAuth: () => {
      calls.getAuth += 1;
      return auth;
    },
    getFirestore: () => ({ service: "firestore" }),
    getStorage: () => ({ service: "storage" }),
  };
  return { app, auth, calls, dependencies };
}

test("missing Firebase Admin configuration fails with an actionable error", () => {
  assert.throws(
    () => loadFirebaseAdminConfiguration({}),
    (error) =>
      error instanceof FirebaseAdminConfigurationError &&
      error.code === "FIREBASE_ADMIN_NOT_CONFIGURED" &&
      error.missingVariables.includes("FIREBASE_PROJECT_ID") &&
      error.missingVariables.includes("FIREBASE_CLIENT_EMAIL") &&
      error.missingVariables.includes("FIREBASE_PRIVATE_KEY")
  );
});

test("valid Firebase Admin configuration initializes Auth and restores escaped newlines", () => {
  const { auth, calls, dependencies } = createDependencies();
  const services = createFirebaseAdminServices(
    createEnvironment(),
    dependencies
  );

  assert.equal(services.auth, auth);
  assert.equal(typeof services.auth.verifyIdToken, "function");
  assert.equal(calls.initializeApp, 1);
  assert.equal(calls.getAuth, 1);
  assert.equal(calls.cert.length, 1);
  assert.equal(
    calls.cert[0].privateKey,
    "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----"
  );
});

test("Firebase Storage resolves the server bucket and rejects missing configuration", () => {
  assert.equal(
    resolveFirebaseStorageBucketName(createEnvironment()),
    "production-project.firebasestorage.app"
  );
  assert.throws(
    () => resolveFirebaseStorageBucketName({}),
    (error) =>
      error instanceof FirebaseAdminConfigurationError &&
      error.missingVariables.includes("FIREBASE_STORAGE_BUCKET")
  );
});

test("an existing Admin app is reused through the singleton registry", () => {
  const existingApp = { name: "existing-admin-app" };
  const { calls, dependencies } = createDependencies({
    existingApps: [existingApp],
  });
  const services = createFirebaseAdminServices({}, dependencies);

  assert.equal(services.app, existingApp);
  assert.equal(calls.initializeApp, 0);
  assert.equal(calls.cert.length, 0);
  assert.equal(calls.getAuth, 1);
});

test("a missing Auth service fails closed instead of returning null", () => {
  const { dependencies } = createDependencies({ auth: null });

  assert.throws(
    () => createFirebaseAdminServices(createEnvironment(), dependencies),
    (error) =>
      error instanceof FirebaseAdminConfigurationError &&
      error.code === "FIREBASE_ADMIN_NOT_CONFIGURED"
  );
});
