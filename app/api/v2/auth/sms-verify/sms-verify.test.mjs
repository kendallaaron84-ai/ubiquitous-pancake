import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(
  new URL("../../../../../", import.meta.url)
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }

    if (specifier.startsWith("@/")) {
      return {
        shortCircuit: true,
        url: pathToFileURL(
          path.join(projectRoot, `${specifier.slice(2)}.ts`)
        ).href,
      };
    }

    if (
      specifier.startsWith(".") &&
      !path.extname(specifier) &&
      context.parentURL?.endsWith(".ts")
    ) {
      return {
        shortCircuit: true,
        url: new URL(`${specifier}.ts`, context.parentURL).href,
      };
    }

    return nextResolve(specifier, context);
  },
});

const { createSmsVerifyRouteHandlers } = await import("./handler.ts");
const { verifySmsChallenge } = await import(
  "../../../../../core/security/sms-provider.ts"
);
const { hmacHex } = await import(
  "../../../../../core/security/crypto.ts"
);

const TEST_ORIGIN = "http://koba-dev.local";
const CHECKOUT_ID = `chk_${"a".repeat(32)}`;
const CLIENT_SECRET = "s".repeat(43);
const VERIFICATION_ID = `vfy_${"v".repeat(32)}`;
const CHECK_ATTEMPT_ID = `chkatt_${"c".repeat(32)}`;
const ENTITLEMENT_ID = `ent_${"e".repeat(32)}`;
const NOW = 1_784_347_200_000;
const VALID_CODE = "654321";

class FakeTimestamp {
  constructor(milliseconds) {
    this.milliseconds = milliseconds;
  }

  toMillis() {
    return this.milliseconds;
  }
}

function timestamp(milliseconds) {
  return new FakeTimestamp(milliseconds);
}

function cloneValue(value) {
  if (value instanceof FakeTimestamp) {
    return timestamp(value.toMillis());
  }

  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        cloneValue(entry),
      ])
    );
  }

  return value;
}

function createEnvironment(overrides = {}) {
  return {
    appEnvironment: "test",
    smsProvider: "mock",
    hmacSecret: "checkout-hmac-test-secret",
    identityHashSecret: "identity-hash-test-secret",
    identityHashVersion: 1,
    jwtPrivateSigningKey: "private-key",
    jwtPublicVerifyingKey: "public-key",
    jwtKeyId: "test-key",
    jwtIssuer: "koba-auth",
    jwtAudience: "koba-media",
    allowedOrigins: [TEST_ORIGIN],
    twilioAccountSid: null,
    twilioAuthToken: null,
    twilioVerifyServiceSid: null,
    ...overrides,
  };
}

function createCheckout(overrides = {}) {
  const phoneE164 = "+12106878982";

  return {
    id: CHECKOUT_ID,
    checkoutClientSecretDigest: hmacHex(
      "checkout-hmac-test-secret",
      `checkout-client-secret:v1:${CHECKOUT_ID}:${CLIENT_SECRET}`
    ),
    tenantId: "KOBA-AUDIO-TEST",
    assetKey: "abk_the-case-of-the-missing-carrot",
    principalId: null,
    principalType: null,
    phoneE164,
    phoneHash: hmacHex(
      "identity-hash-test-secret",
      `phone:v1:${phoneE164}`
    ),
    identityHashVersion: 1,
    checkoutStatus: "awaiting_verification",
    paymentStatus: "not_required",
    verificationStatus: "pending",
    paymentProvider: "none",
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    lastStripeEventId: null,
    productPriceId: null,
    productVersion: null,
    unitAmountMinor: 0,
    currency: "usd",
    activeVerificationSessionId: VERIFICATION_ID,
    createdAt: timestamp(NOW),
    updatedAt: timestamp(NOW),
    expiresAt: timestamp(NOW + 15 * 60 * 1000),
    ...overrides,
  };
}

function createVerification(checkout, overrides = {}) {
  return {
    id: VERIFICATION_ID,
    checkoutSessionId: CHECKOUT_ID,
    tenantId: checkout.tenantId,
    assetKey: checkout.assetKey,
    phoneHash: checkout.phoneHash,
    provider: "mock",
    providerVerificationSid: null,
    mockOtpDigest: hmacHex(
      "checkout-hmac-test-secret",
      `mock-otp:v1:${VERIFICATION_ID}:${VALID_CODE}`
    ),
    dispatchAttemptId: `dsp_${"d".repeat(32)}`,
    status: "pending",
    attemptCount: 0,
    maxAttempts: 5,
    activeCheckAttemptId: null,
    checkStartedAt: null,
    createdAt: timestamp(NOW),
    sentAt: timestamp(NOW),
    expiresAt: timestamp(NOW + 5 * 60 * 1000),
    verifiedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function createFakeDatabase(initialDocuments = {}) {
  const collections = new Map();
  let transactionCount = 0;

  for (const [collectionName, documents] of Object.entries(
    initialDocuments
  )) {
    collections.set(collectionName, new Map(Object.entries(documents)));
  }

  function getCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }

    return collections.get(name);
  }

  function createRef(collectionName, documentId) {
    return {
      collectionName,
      id: documentId,
      path: `${collectionName}/${documentId}`,
    };
  }

  function snapshot(ref) {
    const value = getCollection(ref.collectionName).get(ref.id);

    return {
      exists: value !== undefined,
      id: ref.id,
      ref,
      data: () => value,
    };
  }

  const db = {
    collections,
    get transactionCount() {
      return transactionCount;
    },
    collection(collectionName) {
      return {
        doc(documentId) {
          return createRef(collectionName, documentId);
        },
      };
    },
    async runTransaction(callback) {
      transactionCount += 1;
      const transaction = {
        async get(ref) {
          return snapshot(ref);
        },
        create(ref, value) {
          const collection = getCollection(ref.collectionName);

          if (collection.has(ref.id)) {
            throw new Error("Document already exists.");
          }

          collection.set(ref.id, cloneValue(value));
        },
        update(ref, patch) {
          const collection = getCollection(ref.collectionName);
          const current = collection.get(ref.id);

          if (!current) {
            throw new Error("Cannot update a missing document.");
          }

          collection.set(ref.id, {
            ...current,
            ...cloneValue(patch),
          });
        },
      };

      return callback(transaction);
    },
  };

  return db;
}

function getDocument(db, collectionName, documentId) {
  return db.collections.get(collectionName)?.get(documentId);
}

function createHarness(options = {}) {
  const environment = createEnvironment(options.environment);
  const checkout = createCheckout(options.checkout);
  const verification = createVerification(
    checkout,
    options.verification
  );
  const db = createFakeDatabase({
    checkout_sessions: { [CHECKOUT_ID]: checkout },
    verification_sessions: { [VERIFICATION_ID]: verification },
    ...options.initialDocuments,
  });
  const verificationCalls = [];
  let currentTime = options.nowMillis || NOW;
  const verifyChallenge =
    options.verifyChallenge ||
    ((input) =>
      verifySmsChallenge(input, {
        createOtp: () => {
          throw new Error("OTP creation must not run during verification.");
        },
        createTwilioClient: () => {
          throw new Error("Twilio must not run in mock mode.");
        },
      }));
  const handlers = createSmsVerifyRouteHandlers({
    db,
    loadEnvironment: () => environment,
    verifyChallenge: async (input) => {
      verificationCalls.push(input);
      return verifyChallenge(input);
    },
    createCheckAttemptId: () => CHECK_ATTEMPT_ID,
    createEntitlementId: () => ENTITLEMENT_ID,
    nowMillis: () => currentTime,
    timestampFromMillis: timestamp,
  });

  return {
    db,
    environment,
    handlers,
    verificationCalls,
    setCurrentTime(value) {
      currentTime = value;
    },
  };
}

function createRequest(
  body = { checkoutSessionId: CHECKOUT_ID, code: VALID_CODE },
  options = {}
) {
  return new Request("http://localhost:3000/api/v2/auth/sms-verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: options.origin || TEST_ORIGIN,
      Authorization: `Bearer ${options.secret || CLIENT_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

test("consumes a valid challenge and atomically binds an entitlement", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(createRequest());
  const body = await response.json();
  const checkout = getDocument(
    harness.db,
    "checkout_sessions",
    CHECKOUT_ID
  );
  const verification = getDocument(
    harness.db,
    "verification_sessions",
    VERIFICATION_ID
  );
  const entitlement = getDocument(
    harness.db,
    "entitlements",
    ENTITLEMENT_ID
  );
  const entitlementKeys = harness.db.collections.get("entitlement_keys");

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, status: "verified" });
  assert.equal(harness.verificationCalls.length, 1);
  assert.equal(checkout.checkoutStatus, "ready");
  assert.equal(checkout.verificationStatus, "verified");
  assert.match(checkout.principalId, /^phn_v1_[a-f0-9]{64}$/);
  assert.equal(verification.status, "consumed");
  assert.equal(verification.activeCheckAttemptId, null);
  assert.equal(verification.attemptCount, 0);
  assert.equal(entitlement.status, "active");
  assert.equal(entitlement.principalId, checkout.principalId);
  assert.equal(entitlement.source, "grant");
  assert.equal(entitlementKeys.size, 1);
  assert.equal(JSON.stringify(entitlement).includes("+1210"), false);
});

test("rejects browser-supplied identity and publication fields", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(
    createRequest({
      checkoutSessionId: CHECKOUT_ID,
      code: VALID_CODE,
      phoneNumber: "+19999999999",
      assetKey: "abk_attacker-selected",
    })
  );

  assert.equal(response.status, 400);
  assert.equal(harness.db.transactionCount, 0);
  assert.equal(harness.verificationCalls.length, 0);
});

test("rejects an invalid checkout client secret before provider execution", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(
    createRequest(undefined, { secret: "x".repeat(43) })
  );

  assert.equal(response.status, 401);
  assert.equal(harness.verificationCalls.length, 0);
});

test("increments a rejected attempt without granting access", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(
    createRequest({ checkoutSessionId: CHECKOUT_ID, code: "111111" })
  );
  const verification = getDocument(
    harness.db,
    "verification_sessions",
    VERIFICATION_ID
  );
  const checkout = getDocument(
    harness.db,
    "checkout_sessions",
    CHECKOUT_ID
  );

  assert.equal(response.status, 401);
  assert.equal(verification.attemptCount, 1);
  assert.equal(verification.status, "pending");
  assert.equal(verification.activeCheckAttemptId, null);
  assert.equal(checkout.checkoutStatus, "awaiting_verification");
  assert.equal(harness.db.collections.get("entitlements"), undefined);
});

test("locks the challenge and checkout on the final failed attempt", async () => {
  const harness = createHarness({
    verification: { attemptCount: 4 },
  });
  const response = await harness.handlers.POST(
    createRequest({ checkoutSessionId: CHECKOUT_ID, code: "111111" })
  );
  const verification = getDocument(
    harness.db,
    "verification_sessions",
    VERIFICATION_ID
  );
  const checkout = getDocument(
    harness.db,
    "checkout_sessions",
    CHECKOUT_ID
  );

  assert.equal(response.status, 423);
  assert.equal(verification.attemptCount, 5);
  assert.equal(verification.status, "locked");
  assert.equal(checkout.verificationStatus, "locked");
});

test("does not duplicate provider checks while a fresh reservation is active", async () => {
  const harness = createHarness({
    verification: {
      status: "checking",
      activeCheckAttemptId: `chkatt_${"z".repeat(32)}`,
      checkStartedAt: timestamp(NOW - 5 * 1000),
    },
  });
  const response = await harness.handlers.POST(createRequest());
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.deepEqual(body, { success: true, status: "checking" });
  assert.equal(harness.verificationCalls.length, 0);
});

test("releases a checking reservation when the provider is unavailable", async () => {
  const harness = createHarness({
    verifyChallenge: async () => {
      throw new Error("provider unavailable");
    },
  });
  const response = await harness.handlers.POST(createRequest());
  const verification = getDocument(
    harness.db,
    "verification_sessions",
    VERIFICATION_ID
  );

  assert.equal(response.status, 502);
  assert.equal(verification.status, "pending");
  assert.equal(verification.activeCheckAttemptId, null);
  assert.equal(verification.attemptCount, 0);
});

test("blocks verification until server-confirmed payment exists", async () => {
  const harness = createHarness({
    checkout: {
      paymentStatus: "pending",
      paymentProvider: "stripe",
      unitAmountMinor: 500,
    },
  });
  const response = await harness.handlers.POST(createRequest());

  assert.equal(response.status, 402);
  assert.equal(harness.verificationCalls.length, 0);
});

test("expires stale verification sessions without provider execution", async () => {
  const harness = createHarness({
    verification: { expiresAt: timestamp(NOW - 1) },
  });
  const response = await harness.handlers.POST(createRequest());
  const verification = getDocument(
    harness.db,
    "verification_sessions",
    VERIFICATION_ID
  );

  assert.equal(response.status, 410);
  assert.equal(verification.status, "expired");
  assert.equal(harness.verificationCalls.length, 0);
});

test("reuses an existing active entitlement idempotently", async () => {
  const environment = createEnvironment();
  const checkout = createCheckout();
  const principalId = `phn_v1_${hmacHex(
    environment.identityHashSecret,
    `principal:v1:${checkout.phoneHash}`
  )}`;
  const keyId = hmacHex(
    environment.hmacSecret,
    `entitlement-key:v1:${checkout.tenantId}:${principalId}:${checkout.assetKey}`
  );
  const existingEntitlementId = `ent_${"q".repeat(32)}`;
  const harness = createHarness({
    initialDocuments: {
      entitlement_keys: {
        [keyId]: {
          id: keyId,
          tenantId: checkout.tenantId,
          principalId,
          assetKey: checkout.assetKey,
          currentEntitlementId: existingEntitlementId,
          version: 1,
          createdAt: timestamp(NOW - 1000),
          updatedAt: timestamp(NOW - 1000),
        },
      },
      entitlements: {
        [existingEntitlementId]: {
          id: existingEntitlementId,
          tenantId: checkout.tenantId,
          assetKey: checkout.assetKey,
          principalId,
          principalType: "verified_phone",
          phoneHash: checkout.phoneHash,
          userEmailHash: null,
          identityHashVersion: 1,
          status: "active",
          source: "grant",
          checkoutSessionId: CHECKOUT_ID,
          stripePaymentIntentId: null,
          createdAt: timestamp(NOW - 1000),
          updatedAt: timestamp(NOW - 1000),
        },
      },
    },
  });
  const response = await harness.handlers.POST(createRequest());

  assert.equal(response.status, 200);
  assert.equal(harness.db.collections.get("entitlements").size, 1);
  assert.equal(
    getDocument(
      harness.db,
      "checkout_sessions",
      CHECKOUT_ID
    ).principalId,
    principalId
  );
});

test("Twilio verification is bound to the stored verification SID", async () => {
  const calls = [];
  const environment = createEnvironment({
    smsProvider: "twilio_verify",
    twilioAccountSid: "AC-test",
    twilioAuthToken: "auth-test",
    twilioVerifyServiceSid: "VA-test",
  });
  const result = await verifySmsChallenge(
    {
      environment,
      verificationSessionId: VERIFICATION_ID,
      providerVerificationSid: "VE-test",
      mockOtpDigest: null,
      submittedCode: VALID_CODE,
    },
    {
      createOtp: () => {
        throw new Error("OTP creation must not run.");
      },
      createTwilioClient: (accountSid, authToken) => ({
        verify: {
          v2: {
            services: (serviceSid) => ({
              verificationChecks: {
                create: async (payload) => {
                  calls.push({ accountSid, authToken, serviceSid, payload });
                  return { status: "approved", valid: true };
                },
              },
            }),
          },
        },
      }),
    }
  );

  assert.deepEqual(result, {
    approved: true,
    terminal: false,
    providerStatus: "approved",
  });
  assert.deepEqual(calls, [
    {
      accountSid: "AC-test",
      authToken: "auth-test",
      serviceSid: "VA-test",
      payload: { verificationSid: "VE-test", code: VALID_CODE },
    },
  ]);
});
