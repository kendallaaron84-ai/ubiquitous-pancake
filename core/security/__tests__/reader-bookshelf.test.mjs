import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { establishReaderIdentity } from "../reader-auth.ts";
import { listReaderBookshelf } from "../reader-bookshelf.ts";
import { claimPendingPurchase } from "../services/purchase-claim-service.ts";
import { recordPaidStripePurchase } from "../services/purchase-service.ts";
import { createMemoryDb } from "./reader-platform-test-harness.mjs";

const ROOT = new URL("../../../", import.meta.url);

const activeReader = {
  accountStatus: "active",
  email: "reader@example.com",
  emailNormalized: "reader@example.com",
  emailVerified: true,
};

function publishedProduct(overrides = {}) {
  return {
    title: "A Published Book",
    description: "Safe reader-facing description.",
    authorName: "A. Writer",
    studioKey: "studio_a",
    type: "audiobook",
    status: "published",
    isPublished: true,
    coverUrl: "https://author.example/cover.jpg",
    authorEmail: "private@author.example",
    chapters: [{ audioUrl: "https://private.example/chapter.mp3" }],
    wordpressDeployment: {
      status: "deployed",
      publicationUrl: "https://author.example/book/a-published-book/",
    },
    ...overrides,
  };
}

test("Bookshelf lists multiple published products from only the reader's active entitlements", async () => {
  const db = createMemoryDb({
    "reader_profiles/reader_uid": activeReader,
    "reader_entitlements/one": {
      readerUid: "reader_uid",
      tenantId: "studio_a",
      assetId: "abk_one",
      status: "active",
    },
    "reader_entitlements/two": {
      readerUid: "reader_uid",
      tenantId: "studio_b",
      assetId: "ebk_two",
      status: "active",
    },
    "reader_entitlements/revoked": {
      readerUid: "reader_uid",
      tenantId: "studio_a",
      assetId: "abk_revoked",
      status: "revoked",
    },
    "reader_entitlements/other_reader": {
      readerUid: "another_uid",
      tenantId: "studio_a",
      assetId: "abk_other",
      status: "active",
    },
    "products/abk_one": publishedProduct({ title: "First Book" }),
    "products/ebk_two": publishedProduct({
      title: "Second Book",
      studioKey: "studio_b",
      type: "ebook",
    }),
    "products/abk_revoked": publishedProduct({ title: "Revoked Book" }),
    "products/abk_other": publishedProduct({ title: "Another Reader's Book" }),
  });

  const bookshelf = await listReaderBookshelf(db, "reader_uid");
  assert.deepEqual(
    bookshelf.map((publication) => publication.title),
    ["First Book", "Second Book"]
  );
});

test("Bookshelf excludes unpublished, unconfirmed, missing, and cross-tenant products", async () => {
  const db = createMemoryDb({
    "reader_profiles/reader_uid": activeReader,
    "reader_entitlements/draft": { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_draft", status: "active" },
    "reader_entitlements/deploying": { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_deploying", status: "active" },
    "reader_entitlements/mismatch": { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_mismatch", status: "active" },
    "reader_entitlements/missing": { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_missing", status: "active" },
    "products/abk_draft": publishedProduct({ status: "draft", isPublished: false }),
    "products/abk_deploying": publishedProduct({ wordpressDeployment: { status: "deploying" } }),
    "products/abk_mismatch": publishedProduct({ studioKey: "different_studio" }),
  });

  assert.deepEqual(await listReaderBookshelf(db, "reader_uid"), []);
});

test("Bookshelf deduplicates an asset and exposes only its safe publication projection", async () => {
  const db = createMemoryDb({
    "reader_profiles/reader_uid": activeReader,
    "reader_entitlements/original": { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_one", status: "active" },
    "reader_entitlements/repeat_purchase": { readerUid: "reader_uid", tenantId: "studio_a", assetId: "abk_one", status: "active" },
    "products/abk_one": publishedProduct(),
  });

  const bookshelf = await listReaderBookshelf(db, "reader_uid");
  assert.equal(bookshelf.length, 1);
  assert.deepEqual(Object.keys(bookshelf[0]).sort(), [
    "assetId",
    "authorName",
    "category",
    "coverUrl",
    "description",
    "publicationType",
    "publicationUrl",
    "title",
  ]);
  assert.equal("chapters" in bookshelf[0], false);
  assert.equal("authorEmail" in bookshelf[0], false);
});

test("new verified readers receive an empty Bookshelf and inactive readers fail closed", async () => {
  const emptyDb = createMemoryDb({ "reader_profiles/new_uid": activeReader });
  assert.deepEqual(await listReaderBookshelf(emptyDb, "new_uid"), []);

  const disabledDb = createMemoryDb({
    "reader_profiles/disabled_uid": { ...activeReader, accountStatus: "disabled" },
  });
  await assert.rejects(
    () => listReaderBookshelf(disabledDb, "disabled_uid"),
    /READER_ACCOUNT_NOT_ACTIVE/
  );
});

test("Phase 5A identity through Phase 5B claim appears in the Phase 5C Bookshelf", async () => {
  const db = createMemoryDb({
    "products/abk_integration": publishedProduct({ title: "Integrated Reader Book" }),
  });
  const identity = await establishReaderIdentity(
    db,
    {
      uid: "integrated_uid",
      email: "reader@example.com",
      email_verified: true,
      name: "Integrated Reader",
      firebase: { sign_in_provider: "password" },
    },
    "phase5a-to-5c"
  );
  const purchase = await recordPaidStripePurchase(db, {
    stripeCheckoutSessionId: "cs_integration",
    stripeEventId: "evt_integration",
    stripeEventCreated: 100,
    purchaseEmail: "reader@example.com",
    currency: "usd",
    amountTotalMinor: 999,
    correlationId: "phase5b-to-5c",
    lineItems: [
      {
        stripeLineItemId: "li_integration",
        tenantId: "studio_a",
        assetId: "abk_integration",
        quantity: 1,
        currency: "usd",
        amountTotalMinor: 999,
      },
    ],
  });
  await claimPendingPurchase(db, {
    claimId: purchase.claimId,
    readerUid: identity.readerUid,
    verifiedEmail: identity.email,
    emailVerified: true,
    correlationId: "phase5b-claim-to-5c",
  });

  const bookshelf = await listReaderBookshelf(db, identity.readerUid);
  assert.deepEqual(bookshelf.map((publication) => publication.title), [
    "Integrated Reader Book",
  ]);
});

test("the reader account page owns session resolution and Bookshelf loading on the server", async () => {
  const page = await readFile(new URL("app/reader/account/page.tsx", ROOT), "utf8");
  const component = await readFile(
    new URL("components/reader/ReaderAccount.tsx", ROOT),
    "utf8"
  );

  assert.match(page, /resolveReaderIdentitySession/);
  assert.match(page, /listReaderBookshelf\(services\.db, reader\.readerUid\)/);
  assert.match(page, /redirect\("\/reader\/signin\?next=\/reader\/account"\)/);
  assert.doesNotMatch(component, /collection\(|\/api\/products|\/api\/studio|\/api\/agent/);
});
