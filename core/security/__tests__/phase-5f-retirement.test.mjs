import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  requireCanonicalReaderMediaPrincipal,
  UnsupportedReaderMediaPrincipalError,
} from "../reader-media-principal.ts";
import { retiredReaderAuthResponse } from "../retired-reader-auth.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("protected manifest accepts only canonical reader principal types", async () => {
  const source = await read("../../../app/api/media/manifest/route.ts");
  assert.match(source, /principalType === "anonymous_free"/);
  assert.match(source, /principalType === "firebase_uid"/);
  assert.match(source, /requireCanonicalReaderMediaPrincipal/);
  assert.doesNotMatch(source, /collection\("reader_access_keys"\)/);
  assert.doesNotMatch(source, /collection\("entitlements"\)/);
});

test("canonical paid and anonymous-free principals pass while legacy fails closed", () => {
  const base = { principalId: "reader", tenantId: "studio", scope: ["media:read"] };
  assert.doesNotThrow(() => requireCanonicalReaderMediaPrincipal({ ...base, principalType: "firebase_uid" }));
  assert.doesNotThrow(() => requireCanonicalReaderMediaPrincipal({ ...base, principalType: "anonymous_free", assetId: "abk_free", origin: "https://author.example" }));
  assert.throws(
    () => requireCanonicalReaderMediaPrincipal({ ...base, principalType: "legacy" }),
    (error) => error instanceof UnsupportedReaderMediaPrincipalError && error.code === "READER_MEDIA_PRINCIPAL_UNSUPPORTED"
  );
});

test("retired reader authorization uses one executable 410 contract", async () => {
  const response = retiredReaderAuthResponse();
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    success: false,
    code: "LEGACY_READER_AUTH_RETIRED",
    error: "This reader authorization method is no longer supported.",
  });
});

test("reader SMS and legacy token endpoints are permanently retired", async () => {
  const paths = [
    "../../../app/api/auth/sms-send/route.ts",
    "../../../app/api/auth/sms-verify/route.ts",
    "../../../app/api/v2/auth/sms-send/route.ts",
    "../../../app/api/v2/auth/sms-verify/route.ts",
    "../../../app/api/v2/media/token/route.ts",
    "../../../app/api/v2/checkout/route.ts",
    "../../../app/api/verify-entitlement/route.ts",
    "../../../app/api/library-manifest/route.ts",
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /retiredReaderAuthResponse/);
    assert.doesNotMatch(source, /reader_access_keys|signReaderToken|TWILIO_|twilio/i);
  }
});

test("checkout compatibility routes preserve canonical commerce without reader-token minting", async () => {
  const checkout = await read("../../../app/api/checkout/route.ts");
  const complete = await read("../../../app/api/checkout/listener-session/complete/route.ts");
  assert.match(checkout, /listener-session\/route/);
  assert.match(complete, /processCanonicalReaderPurchase/);
  assert.match(complete, /READER_PURCHASE_CLAIM_REQUIRED/);
  assert.doesNotMatch(complete, /reader_access_keys|bindReaderEntitlements|signReaderToken|normalizedPhone/);
});

test("Stripe listener webhook records canonical purchases without legacy fulfillment", async () => {
  const source = await read("../../../app/api/webhook/stripe/route.ts");
  assert.match(source, /processCanonicalReaderPurchase/);
  assert.doesNotMatch(source, /processListenerPurchaseEntitlement|fulfillLegacyPurchase|legacyStatus/);
});

test("historical legacy fields remain available as migration evidence", async () => {
  const entitlement = await read("../reader-contracts/entitlement.ts");
  const migration = await read("../reader-contracts/legacy-migration.ts");
  assert.match(entitlement, /legacyEntitlementId/);
  assert.match(entitlement, /legacyReaderAccessKey/);
  assert.match(migration, /readerAccessKey/);
});
