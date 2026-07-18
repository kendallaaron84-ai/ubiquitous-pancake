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

const { createSmsSendRouteHandlers } = await import("./route.ts");
const { dispatchSmsChallenge } = await import(
  "../../../../../core/security/sms-provider.ts"
);
const { hmacHex } = await import(
  "../../../../../core/security/crypto.ts"
);

const TEST_ORIGIN = "http://koba-dev.local";
const CHECKOUT_ID = `chk_${"a".repeat(32)}`;
const CLIENT_SECRET = "s".repeat(43);
const VERIFICATION_ID = `vfy_${"v".repeat(32)}`;
const DISPATCH_ID = `dsp_${"d".repeat(32)}`;
const NOW = 1_784_347_200_000;

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
    checkoutStatus: "created",
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
    activeVerificationSessionId: null,
    createdAt: timestamp(NOW),
    updatedAt: timestamp(NOW),
    expiresAt: timestamp(NOW + 15 * 60 * 1000),
    ...overrides,
  };
}

function createFakeDatabase(initialDocuments = {}) {
  const collections = new Map();
  let transactionCount = 0;

  for (const [collectionName, documents] of Object.entries(
    initialDocuments
  )) {
    collections.set(
      collectionName,
      new Map(Object.entries(documents))
    );
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
        set(ref, value) {
          getCollection(ref.collectionName).set(
            ref.id,
            cloneValue(value)
          );
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
  const initialDocuments = {
    checkout_sessions: { [CHECKOUT_ID]: checkout },
    ...options.initialDocuments,
  };
  const db = createFakeDatabase(initialDocuments);
  const dispatchCalls = [];
  const dispatchChallenge =
    options.dispatchChallenge ||
    (async (input) => {
      dispatchCalls.push(input);
      return dispatchSmsChallenge(input, {
        createOtp: () => "654321",
        createTwilioClient: () => {
          throw new Error("Twilio must not run in mock mode.");
        },
      });
    });
  let currentTime = options.nowMillis || NOW;
  const handlers = createSmsSendRouteHandlers({
    db,
    loadEnvironment: () => environment,
    dispatchChallenge: async (input) => {
      if (options.dispatchChallenge) {
        dispatchCalls.push(input);
      }

      return dispatchChallenge(input);
    },
    createVerificationId: () => VERIFICATION_ID,
    createDispatchAttemptId: () => DISPATCH_ID,
    nowMillis: () => currentTime,
    timestampFromMillis: timestamp,
  });

  return {
    db,
    dispatchCalls,
    environment,
    handlers,
    setCurrentTime(value) {
      currentTime = value;
    },
  };
}

function createRequest(body = { checkoutSessionId: CHECKOUT_ID }, options = {}) {
  return new Request("http://localhost:3000/api/v2/auth/sms-send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: options.origin || TEST_ORIGIN,
      Authorization: `Bearer ${options.secret || CLIENT_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

test("dispatches mock SMS using only checkout-owned identity", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(createRequest());
  const body = await response.json();
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

  assert.equal(response.status, 202);
  assert.deepEqual(body, {
    success: true,
    status: "pending",
    expiresIn: 300,
  });
  assert.equal(harness.dispatchCalls.length, 1);
  assert.equal(
    harness.dispatchCalls[0].phoneE164,
    "+12106878982"
  );
  assert.equal(verification.status, "pending");
  assert.equal(verification.provider, "mock");
  assert.equal(verification.providerVerificationSid, null);
  assert.match(verification.mockOtpDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(verification).includes("654321"), false);
  assert.equal(JSON.stringify(body).includes("654321"), false);
  assert.equal(Object.hasOwn(verification, "phoneE164"), false);
  assert.equal(checkout.checkoutStatus, "awaiting_verification");
  assert.equal(
    checkout.activeVerificationSessionId,
    VERIFICATION_ID
  );
});

test("rejects browser-supplied identity and product fields", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(
    createRequest({
      checkoutSessionId: CHECKOUT_ID,
      phoneNumber: "+19999999999",
      assetKey: "abk_attacker-selected",
    })
  );

  assert.equal(response.status, 400);
  assert.equal(harness.db.transactionCount, 0);
  assert.equal(harness.dispatchCalls.length, 0);
});

test("rejects an invalid checkout client secret", async () => {
  const harness = createHarness();
  const response = await harness.handlers.POST(
    createRequest(undefined, { secret: "x".repeat(43) })
  );

  assert.equal(response.status, 401);
  assert.equal(harness.dispatchCalls.length, 0);
  assert.equal(
    harness.db.collections.get("verification_sessions"),
    undefined
  );
});

test("blocks SMS until paid checkout confirmation exists", async () => {
  const harness = createHarness({
    checkout: {
      paymentStatus: "pending",
      paymentProvider: "stripe",
      unitAmountMinor: 500,
    },
  });
  const response = await harness.handlers.POST(createRequest());

  assert.equal(response.status, 402);
  assert.equal(harness.dispatchCalls.length, 0);
});

test("rejects expired checkout sessions", async () => {
  const harness = createHarness({
    checkout: { expiresAt: timestamp(NOW - 1) },
  });
  const response = await harness.handlers.POST(createRequest());

  assert.equal(response.status, 410);
  assert.equal(harness.dispatchCalls.length, 0);
});

test("Twilio Verify receives the server-owned E.164 number and stores its SID", async () => {
  const twilioCalls = [];
  const environment = {
    smsProvider: "twilio_verify",
    twilioAccountSid: "AC-test",
    twilioAuthToken: "auth-test",
    twilioVerifyServiceSid: "VA-test",
  };
  const harness = createHarness({
    environment,
    dispatchChallenge: (input) =>
      dispatchSmsChallenge(input, {
        createOtp: () => {
          throw new Error("Mock OTP must not run.");
        },
        createTwilioClient: (accountSid, authToken) => ({
          verify: {
            v2: {
              services: (serviceSid) => ({
                verifications: {
                  create: async (payload) => {
                    twilioCalls.push({
                      accountSid,
                      authToken,
                      serviceSid,
                      payload,
                    });
                    return { sid: "VE-test", status: "pending" };
                  },
                },
              }),
            },
          },
        }),
      }),
  });
  const response = await harness.handlers.POST(createRequest());
  const verification = getDocument(
    harness.db,
    "verification_sessions",
    VERIFICATION_ID
  );

  assert.equal(response.status, 202);
  assert.deepEqual(twilioCalls, [
    {
      accountSid: "AC-test",
      authToken: "auth-test",
      serviceSid: "VA-test",
      payload: {
        to: "+12106878982",
        channel: "sms",
        riskCheck: "enable",
      },
    },
  ]);
  assert.equal(verification.providerVerificationSid, "VE-test");
  assert.equal(verification.mockOtpDigest, null);
});

test("a duplicate pending request does not dispatch another SMS", async () => {
  const harness = createHarness();
  const firstResponse = await harness.handlers.POST(createRequest());
  const secondResponse = await harness.handlers.POST(createRequest());
  const secondBody = await secondResponse.json();

  assert.equal(firstResponse.status, 202);
  assert.equal(secondResponse.status, 200);
  assert.equal(secondBody.status, "pending");
  assert.equal(harness.dispatchCalls.length, 1);
});

test("enforces the phone-hash resend interval across checkout sessions", async () => {
  const checkout = createCheckout();
  const limit = {
    id: checkout.phoneHash,
    phoneHash: checkout.phoneHash,
    dispatchCount: 1,
    windowStartedAt: timestamp(NOW - 5 * 60 * 1000),
    lastDispatchedAt: timestamp(NOW - 30 * 1000),
    blockedUntil: null,
    expiresAt: timestamp(NOW + 25 * 60 * 1000),
    updatedAt: timestamp(NOW - 30 * 1000),
  };
  const harness = createHarness({
    checkout,
    initialDocuments: {
      verification_dispatch_limits: {
        [checkout.phoneHash]: limit,
      },
    },
  });
  const response = await harness.handlers.POST(createRequest());
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.retryAfter, 30);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(harness.dispatchCalls.length, 0);
});

test("an active blockedUntil window survives the 60-second resend threshold", async () => {
  const checkout = createCheckout();
  const limit = {
    id: checkout.phoneHash,
    phoneHash: checkout.phoneHash,
    dispatchCount: 5,
    windowStartedAt: timestamp(NOW - 5 * 60 * 1000),
    lastDispatchedAt: timestamp(NOW - 61 * 1000),
    blockedUntil: timestamp(NOW + 10 * 60 * 1000),
    expiresAt: timestamp(NOW + 25 * 60 * 1000),
    updatedAt: timestamp(NOW - 61 * 1000),
  };
  const harness = createHarness({
    checkout,
    initialDocuments: {
      verification_dispatch_limits: {
        [checkout.phoneHash]: limit,
      },
    },
  });
  const response = await harness.handlers.POST(createRequest());
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.retryAfter, 600);
  assert.equal(response.headers.get("retry-after"), "600");
  assert.equal(harness.dispatchCalls.length, 0);
  assert.equal(
    harness.db.collections.get("verification_sessions"),
    undefined
  );
});

test("marks failed provider dispatches and releases the checkout reservation", async () => {
  const harness = createHarness({
    dispatchChallenge: async () => {
      throw new Error("provider unavailable");
    },
  });
  const response = await harness.handlers.POST(createRequest());
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

  assert.equal(response.status, 502);
  assert.equal(verification.status, "delivery_failed");
  assert.equal(checkout.checkoutStatus, "created");
  assert.equal(checkout.activeVerificationSessionId, null);
});
