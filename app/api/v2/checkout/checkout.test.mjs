import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(
  new URL("../../../../", import.meta.url)
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }

    if (specifier.startsWith("@/")) {
      const absolutePath = path.join(
        projectRoot,
        `${specifier.slice(2)}.ts`
      );

      return {
        shortCircuit: true,
        url: pathToFileURL(absolutePath).href,
      };
    }

    return nextResolve(specifier, context);
  },
});

const { createCheckoutRouteHandlers } = await import("./handler.ts");

const TEST_ORIGIN = "http://koba-dev.local";
const FIXED_NOW = 1_784_347_200_000;

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

function createFakeDatabase(product) {
  const reads = [];
  const writes = [];

  return {
    reads,
    writes,
    collection(collectionName) {
      return {
        doc(documentId) {
          return {
            async get() {
              reads.push({ collectionName, documentId });

              if (collectionName !== "products" || !product) {
                return {
                  exists: false,
                  id: documentId,
                  data: () => undefined,
                };
              }

              return {
                exists: true,
                id: documentId,
                data: () => ({ ...product }),
              };
            },
            async create(value) {
              writes.push({
                collectionName,
                documentId,
                value,
              });
            },
          };
        },
      };
    },
  };
}

function createProduct(overrides = {}) {
  return {
    assetKey: "abk_the-case-of-the-missing-carrot",
    studioKey: "KOBA-AUDIO-TEST",
    type: "audiobook",
    status: "published",
    price: 0,
    currency: "usd",
    ...overrides,
  };
}

function createHandlers(product, options = {}) {
  const db = createFakeDatabase(product);
  const handlers = createCheckoutRouteHandlers({
    db,
    loadEnvironment: () =>
      createEnvironment(options.environment),
    createCheckoutId: () => "chk_test_session",
    createCheckoutClientSecret: () =>
      "test_checkout_client_secret",
    nowMillis: () => FIXED_NOW,
    timestampFromMillis: (value) => ({
      __testTimestampMillis: value,
    }),
  });

  return { db, handlers };
}

function createPostRequest(body, origin = TEST_ORIGIN) {
  return new Request("http://localhost:3000/api/v2/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

test("creates a non-permissive free checkout session from the products collection", async () => {
  const { db, handlers } = createHandlers(createProduct());
  const response = await handlers.POST(
    createPostRequest({
      assetKey: "abk_the-case-of-the-missing-carrot",
      phoneNumber: "(210) 687-8982",
    })
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.status, "created");
  assert.equal(body.requiresPayment, false);
  assert.equal(body.maskedPhone, "***-***-8982");
  assert.equal(body.checkoutClientSecret, "test_checkout_client_secret");
  assert.deepEqual(db.reads, [
    {
      collectionName: "products",
      documentId: "abk_the-case-of-the-missing-carrot",
    },
  ]);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].collectionName, "checkout_sessions");
  assert.equal(db.writes[0].value.checkoutStatus, "created");
  assert.equal(db.writes[0].value.paymentStatus, "not_required");
  assert.equal(db.writes[0].value.verificationStatus, "pending");
  assert.equal(db.writes[0].value.phoneE164, "+12106878982");
  assert.equal(db.writes[0].value.tenantId, "KOBA-AUDIO-TEST");
  assert.match(
    db.writes[0].value.checkoutClientSecretDigest,
    /^[a-f0-9]{64}$/
  );
  assert.notEqual(
    db.writes[0].value.checkoutClientSecretDigest,
    body.checkoutClientSecret
  );
  assert.equal(
    Object.values(db.writes[0].value).includes(
      body.checkoutClientSecret
    ),
    false
  );
});

test("preserves an international E.164 phone number", async () => {
  const { db, handlers } = createHandlers(createProduct());
  const response = await handlers.POST(
    createPostRequest({
      assetKey: "abk_the-case-of-the-missing-carrot",
      phoneNumber: "+44 20 7946 0958",
    })
  );

  assert.equal(response.status, 201);
  assert.equal(db.writes[0].value.phoneE164, "+442079460958");
});

test("derives paid policy and tenant only from server product data", async () => {
  const { db, handlers } = createHandlers(
    createProduct({
      tenantId: "tenant_server_owned",
      studioKey: "legacy-studio-key",
      price: "5.00",
    })
  );
  const response = await handlers.POST(
    createPostRequest({
      assetKey: "abk_the-case-of-the-missing-carrot",
      phoneNumber: "2106878982",
      tenantId: "browser_tenant",
      price: 0,
    })
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.requiresPayment, true);
  assert.deepEqual(body.payment, {
    unitAmountMinor: 500,
    currency: "usd",
  });
  assert.equal(db.writes[0].value.tenantId, "tenant_server_owned");
  assert.equal(db.writes[0].value.unitAmountMinor, 500);
  assert.equal(db.writes[0].value.paymentStatus, "pending");
  assert.equal(db.writes[0].value.paymentProvider, "stripe");
});

test("fails before Firestore access when phone input is invalid", async () => {
  const { db, handlers } = createHandlers(createProduct());
  const response = await handlers.POST(
    createPostRequest({
      assetKey: "abk_the-case-of-the-missing-carrot",
      phoneNumber: "123",
    })
  );

  assert.equal(response.status, 400);
  assert.equal(db.reads.length, 0);
  assert.equal(db.writes.length, 0);
});

test("does not create a session for an unknown product", async () => {
  const { db, handlers } = createHandlers(null);
  const response = await handlers.POST(
    createPostRequest({
      assetKey: "abk_unknown-publication",
      phoneNumber: "2106878982",
    })
  );

  assert.equal(response.status, 404);
  assert.equal(db.writes.length, 0);
});

test("fails closed for unpublished or tenantless products", async () => {
  for (const product of [
    createProduct({ status: "draft" }),
    createProduct({
      studioKey: "",
      wpStudioKey: "",
      tenantId: "",
    }),
  ]) {
    const { db, handlers } = createHandlers(product);
    const response = await handlers.POST(
      createPostRequest({
        assetKey: "abk_the-case-of-the-missing-carrot",
        phoneNumber: "2106878982",
      })
    );

    assert.equal(response.status, 403);
    assert.equal(db.writes.length, 0);
  }
});

test("rejects disallowed browser origins without database access", async () => {
  const { db, handlers } = createHandlers(createProduct());
  const response = await handlers.POST(
    createPostRequest(
      {
        assetKey: "abk_the-case-of-the-missing-carrot",
        phoneNumber: "2106878982",
      },
      "https://malicious.example"
    )
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(db.reads.length, 0);
  assert.equal(db.writes.length, 0);
});

test("answers approved preflight requests without touching Firestore", async () => {
  const { db, handlers } = createHandlers(createProduct());
  const request = new Request(
    "http://localhost:3000/api/v2/checkout",
    {
      method: "OPTIONS",
      headers: { Origin: TEST_ORIGIN },
    }
  );
  const response = await handlers.OPTIONS(request);

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    TEST_ORIGIN
  );
  assert.equal(db.reads.length, 0);
  assert.equal(db.writes.length, 0);
});
