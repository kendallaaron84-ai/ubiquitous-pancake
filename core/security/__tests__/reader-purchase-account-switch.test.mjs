import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  READER_ACCOUNT_SWITCH_ERROR,
  switchReaderAccountForContinuation,
  switchReaderPurchaseAccount,
} from "../reader-purchase-account-switch.ts";

test("account switch clears canonical and Firebase sessions before preserving claim continuation", async () => {
  const calls = [];
  let destination = null;
  await switchReaderPurchaseAccount({
    claimPath: "/reader/claim?session_id=cs_live_1234567890abcdef",
    logoutReaderSession: async () => {
      calls.push("canonical_logout");
      return { ok: true };
    },
    logoutFirebaseIdentity: async () => {
      calls.push("firebase_logout");
    },
    navigate: (path) => {
      calls.push("navigate");
      destination = path;
    },
  });

  assert.deepEqual(calls, [
    "canonical_logout",
    "firebase_logout",
    "navigate",
  ]);
  const signIn = new URL(destination, "https://dashboard.koba-i.com");
  assert.equal(signIn.pathname, "/reader/signin");
  assert.equal(
    signIn.searchParams.get("next"),
    "/reader/claim?session_id=cs_live_1234567890abcdef"
  );
});

test("failed canonical logout does not clear Firebase identity or navigate", async () => {
  let firebaseCalls = 0;
  let navigations = 0;
  await assert.rejects(
    () =>
      switchReaderPurchaseAccount({
        claimPath: "/reader/claim?session_id=cs_live_1234567890abcdef",
        logoutReaderSession: async () => ({ ok: false }),
        logoutFirebaseIdentity: async () => {
          firebaseCalls += 1;
        },
        navigate: () => {
          navigations += 1;
        },
      }),
    new RegExp(READER_ACCOUNT_SWITCH_ERROR)
  );
  assert.equal(firebaseCalls, 0);
  assert.equal(navigations, 0);
});

test("account switch preserves a strict purchase-recovery continuation", async () => {
  let destination = null;
  await switchReaderAccountForContinuation({
    continuationPath:
      "/reader/purchases/recover?assetId=ebk_the-healing-journey",
    logoutReaderSession: async () => ({ ok: true }),
    logoutFirebaseIdentity: async () => {},
    navigate: (path) => {
      destination = path;
    },
  });
  const signIn = new URL(destination, "https://dashboard.koba-i.com");
  assert.equal(
    signIn.searchParams.get("next"),
    "/reader/purchases/recover?assetId=ebk_the-healing-journey"
  );
});

test("account switch rejects an untrusted or altered continuation", async () => {
  for (const claimPath of [
    "/reader/open?assetId=abk_book",
    "/reader/claim?session_id=cs_live_1234567890&expected_email=x@example.com",
    "https://attacker.example/reader/claim?session_id=cs_live_1234567890",
  ]) {
    await assert.rejects(
      () =>
        switchReaderPurchaseAccount({
          claimPath,
          logoutReaderSession: async () => ({ ok: true }),
          logoutFirebaseIdentity: async () => {},
          navigate: () => {},
        }),
      new RegExp(READER_ACCOUNT_SWITCH_ERROR)
    );
  }
});

test("claim UI uses customer language and returns every successful checkout to the Bookshelf", async () => {
  const source = await readFile(
    new URL("../../../components/reader/ReaderPurchaseClaim.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /This purchase was made with a different email address\./);
  assert.match(source, /Switch account/);
  assert.match(source, /router\.replace\("\/reader\/account"\)/);
  assert.doesNotMatch(source, /requires support review/i);
  assert.doesNotMatch(source, /expected[_A-Za-z]*email/i);
});
