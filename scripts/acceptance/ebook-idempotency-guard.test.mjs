import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const workflow = fileURLToPath(new URL("./ebook-idempotency-workflow.mjs", import.meta.url));

function run(overrides = {}) {
  return spawnSync(process.execPath, [workflow], {
    encoding: "utf8",
    env: {
      ...process.env,
      KOBA_ACCEPTANCE_VALIDATE_ONLY: "true",
      KOBA_DISPOSABLE_WORDPRESS_ORIGIN: "http://127.0.0.1:9400",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8087",
      ...overrides,
    },
  });
}

test("acceptance harness permits only loopback disposable services", () => {
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  const receipt = JSON.parse(valid.stdout);
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.productionServices, false);
  assert.equal(receipt.draftAndIdentityContractChecked, true);

  const productionWordPress = run({
    KOBA_DISPOSABLE_WORDPRESS_ORIGIN: "https://audio.koba-i.com",
  });
  assert.notEqual(productionWordPress.status, 0);
  assert.match(productionWordPress.stderr, /local HTTP|loopback/);

  const remoteFirestore = run({
    FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443",
  });
  assert.notEqual(remoteFirestore.status, 0);
  assert.match(remoteFirestore.stderr, /loopback/);
});

test("acceptance harness binds current draft and canonical-ID deployment contracts", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).draftAndIdentityContractChecked, true);
});

test("Save & Sync fails closed to draft when client status is absent", async () => {
  const { readFile } = await import("node:fs/promises");
  const productsPage = await readFile(
    new URL("../../app/products/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(productsPage, /status:\s*editingProduct\.status\s*\|\|\s*"draft"/);
  assert.doesNotMatch(productsPage, /status:\s*editingProduct\.status\s*\|\|\s*"published"/);
  assert.match(productsPage, /missing client-side status must never publish a book/);
});
