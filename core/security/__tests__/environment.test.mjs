import assert from "node:assert/strict";
import test from "node:test";

import {
  SecurityEnvironmentError,
  loadSecurityEnvironment,
} from "../environment.ts";

function createValidEnvironment(overrides = {}) {
  return {
    KOBA_APP_ENV: "test",
    KOBA_SMS_PROVIDER: "mock",
    KOBA_HMAC_SECRET: "hmac-secret",
    KOBA_IDENTITY_HASH_SECRET: "identity-secret",
    KOBA_IDENTITY_HASH_VERSION: "1",
    KOBA_JWT_PRIVATE_SIGNING_KEY: "private\\nkey",
    KOBA_JWT_PUBLIC_VERIFYING_KEY: "public\\nkey",
    KOBA_JWT_KEY_ID: "koba-test-key",
    KOBA_JWT_ISSUER: "koba-auth",
    KOBA_JWT_AUDIENCE: "koba-media",
    KOBA_ALLOWED_ORIGINS:
      "http://koba-dev.local,https://audio.koba-i.com",
    ...overrides,
  };
}

test("loads a complete mock-provider test environment", () => {
  const result = loadSecurityEnvironment(createValidEnvironment());

  assert.equal(result.appEnvironment, "test");
  assert.equal(result.smsProvider, "mock");
  assert.equal(result.identityHashVersion, 1);
  assert.deepEqual(result.allowedOrigins, [
    "http://koba-dev.local",
    "https://audio.koba-i.com",
  ]);
  assert.equal(result.jwtPrivateSigningKey, "private\nkey");
});

test("fails closed when a required security variable is absent", () => {
  const source = createValidEnvironment();
  delete source.KOBA_HMAC_SECRET;

  assert.throws(
    () => loadSecurityEnvironment(source),
    (error) =>
      error instanceof SecurityEnvironmentError &&
      error.message.includes("KOBA_HMAC_SECRET")
  );
});

test("forbids the mock provider in production", () => {
  assert.throws(
    () =>
      loadSecurityEnvironment(
        createValidEnvironment({ KOBA_APP_ENV: "production" })
      ),
    /mock SMS provider is forbidden/i
  );
});

test("requires the complete Twilio Verify credential set", () => {
  assert.throws(
    () =>
      loadSecurityEnvironment(
        createValidEnvironment({
          KOBA_SMS_PROVIDER: "twilio_verify",
        })
      ),
    /Twilio Verify requires/
  );

  const result = loadSecurityEnvironment(
    createValidEnvironment({
      KOBA_SMS_PROVIDER: "twilio_verify",
      TWILIO_ACCOUNT_SID: "AC-test",
      TWILIO_AUTH_TOKEN: "auth-test",
      TWILIO_VERIFY_SERVICE_SID: "VA-test",
    })
  );

  assert.equal(result.smsProvider, "twilio_verify");
  assert.equal(result.twilioVerifyServiceSid, "VA-test");
});

test("rejects wildcard and path-bearing CORS origins", () => {
  assert.throws(
    () =>
      loadSecurityEnvironment(
        createValidEnvironment({ KOBA_ALLOWED_ORIGINS: "*" })
      ),
    /cannot contain a wildcard/
  );

  assert.throws(
    () =>
      loadSecurityEnvironment(
        createValidEnvironment({
          KOBA_ALLOWED_ORIGINS: "https://audio.koba-i.com/path",
        })
      ),
    /exact HTTP\(S\) origin/
  );
});

test("rejects invalid providers, environments, and hash versions", () => {
  assert.throws(
    () =>
      loadSecurityEnvironment(
        createValidEnvironment({ KOBA_SMS_PROVIDER: "sms" })
      ),
    /KOBA_SMS_PROVIDER/
  );
  assert.throws(
    () =>
      loadSecurityEnvironment(
        createValidEnvironment({ KOBA_APP_ENV: "preview" })
      ),
    /KOBA_APP_ENV/
  );
  assert.throws(
    () =>
      loadSecurityEnvironment(
        createValidEnvironment({
          KOBA_IDENTITY_HASH_VERSION: "0",
        })
      ),
    /positive integer/
  );
});
