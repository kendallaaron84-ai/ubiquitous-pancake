import assert from "node:assert/strict";
import test from "node:test";

import {
  FirebaseAdminConfigurationError,
  createFirebaseAdminServices,
  isLocalAcceptanceEmulatorEnvironment,
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
    initializeOptions: [],
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
    initializeApp: (initializeOptions) => {
      calls.initializeApp += 1;
      calls.initializeOptions.push(initializeOptions);
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

test("local acceptance may initialize only against explicit loopback emulators", () => {
  const environment = {
    NODE_ENV: "development",
    KOBA_LOCAL_ACCEPTANCE: "true",
    FIREBASE_PROJECT_ID: "koba-local-acceptance",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8087",
    FIREBASE_STORAGE_BUCKET: "koba-local-acceptance.appspot.com",
  };
  const { calls, dependencies } = createDependencies();
  const services = createFirebaseAdminServices(environment, dependencies);

  assert.equal(isLocalAcceptanceEmulatorEnvironment(environment), true);
  assert.equal(services.app.name, "test-admin-app");
  assert.equal(calls.cert.length, 0);
  assert.deepEqual(calls.initializeOptions[0], {
    projectId: "koba-local-acceptance",
    storageBucket: "koba-local-acceptance.appspot.com",
  });
});

test("local acceptance cannot bypass credentials in production or for a non-loopback host", () => {
  const { dependencies } = createDependencies();
  for (const environment of [
    {
      NODE_ENV: "production",
      KOBA_LOCAL_ACCEPTANCE: "true",
      FIREBASE_PROJECT_ID: "koba-local-acceptance",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8087",
    },
    {
      NODE_ENV: "development",
      KOBA_LOCAL_ACCEPTANCE: "true",
      FIREBASE_PROJECT_ID: "koba-local-acceptance",
      FIREBASE_AUTH_EMULATOR_HOST: "emulator.example.com:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8087",
    },
  ]) {
    assert.equal(isLocalAcceptanceEmulatorEnvironment(environment), false);
    assert.throws(
      () => createFirebaseAdminServices(environment, dependencies),
      (error) => error instanceof FirebaseAdminConfigurationError
    );
  }
});
