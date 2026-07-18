import assert from "node:assert/strict";
import test from "node:test";

import {
  createClientSecret,
  createMockOtp,
  createOpaqueId,
  hmacHex,
  normalizePhoneE164,
  safeEqualHex,
} from "../crypto.ts";

test("safeEqualHex accepts identical fixed-width SHA-256 digests", () => {
  const digest = hmacHex("test-secret", "payload");
  assert.equal(digest.length, 64);
  assert.equal(safeEqualHex(digest, digest), true);
});

test("safeEqualHex rejects different valid digests", () => {
  const expected = hmacHex("test-secret", "payload-a");
  const actual = hmacHex("test-secret", "payload-b");
  assert.equal(safeEqualHex(expected, actual), false);
});

test("safeEqualHex remains case-insensitive for valid hex encoding", () => {
  const digest = hmacHex("test-secret", "payload");
  assert.equal(safeEqualHex(digest, digest.toUpperCase()), true);
});

test("safeEqualHex rejects malformed and variable-width values without throwing", () => {
  assert.equal(safeEqualHex("", ""), false);
  assert.equal(safeEqualHex("00", "00"), false);
  assert.equal(safeEqualHex("z".repeat(64), "z".repeat(64)), false);
  assert.equal(
    safeEqualHex("0".repeat(64), "0".repeat(62)),
    false
  );
});

test("opaque IDs and client secrets use high-entropy URL-safe values", () => {
  const firstId = createOpaqueId("chk");
  const secondId = createOpaqueId("chk");
  const clientSecret = createClientSecret();

  assert.match(firstId, /^chk_[A-Za-z0-9_-]{32}$/);
  assert.notEqual(firstId, secondId);
  assert.match(clientSecret, /^[A-Za-z0-9_-]{43}$/);
});

test("mock OTPs are always six-digit values", () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(createMockOtp(), /^\d{6}$/);
  }
});

test("phone normalization requires explicit E.164 context", () => {
  assert.equal(normalizePhoneE164("+1 (210) 687-8982"), "+12106878982");
  assert.equal(normalizePhoneE164("2106878982", "1"), "+12106878982");
  assert.throws(() => normalizePhoneE164("2106878982"), /E\.164/);
});
