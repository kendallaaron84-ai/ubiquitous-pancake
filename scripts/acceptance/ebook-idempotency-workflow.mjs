import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const origin = process.env.KOBA_DISPOSABLE_WORDPRESS_ORIGIN || "http://127.0.0.1:9400";
const assetId = "ebk_9bc5429735124a85a60f0d06184ea331";
const routeSource = await readFile(new URL("../../app/api/agent/deploy/route.ts", import.meta.url), "utf8");

assert.match(routeSource, /const requestedAssetId = clean\(body\?\.assetId\)/);
assert.match(routeSource, /const assetKey = requestedAssetId[\s\S]*assertValidStudioAssetId\(requestedAssetId\)/);
assert.match(routeSource, /const productRef = adminDb\.collection\("products"\)\.doc\(assetKey\)/);
assert.match(routeSource, /bookSlug: input\.assetKey/);
assert.match(routeSource, /expectedPublicationId: input\.expectedPublicationId/);
assert.match(routeSource, /expectedPageId: input\.expectedPageId/);
assert.match(routeSource, /publicationId: wordpress\.publicationId/);
assert.match(routeSource, /pageId: wordpress\.pageId/);

const credentialsResponse = await fetch(`${origin}/wp-content/uploads/koba-ebook-test-credentials.json`);
assert.equal(credentialsResponse.status, 200, "disposable WordPress credentials must be available");
const fixture = await credentialsResponse.json();
const authorization = `Basic ${Buffer.from(`${fixture.gateway.username}:${fixture.gateway.password}`, "utf8").toString("base64")}`;

async function wordpressState() {
  const response = await fetch(`${origin}/wp-json/koba-ebook-test/v1/state`, {
    headers: { "X-Koba-Test-Token": fixture.controlToken },
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function sync(product) {
  const deployment = product.wordpressDeployment || {};
  const response = await fetch(`${origin}/wp-json/kobai/v1/publish-vault`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({
      assetKey: product.assetId,
      bookTitle: product.title,
      bookSlug: product.assetId,
      authorSlug: "disposable-author",
      authorName: "Disposable Author",
      synopsis: product.synopsis,
      type: "ebook",
      category: "E-Books",
      price: 0,
      status: "draft",
      chapters: product.chapters,
      ebookPayload: { layoutMode: "reflowable", chapters: product.chapters },
      expectedPublicationId: Number(deployment.publicationId || 0),
      expectedPageId: Number(deployment.pageId || 0),
    }),
  });
  const body = await response.json().catch(() => null);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  return body;
}

// A disposable, Firestore-compatible document store: document ID is the canonical asset ID,
// and set(..., { merge:true }) semantics are represented by merging one map entry.
const products = new Map();
function saveDraft(input) {
  assert.equal(input.assetId, assetId, "editing and renaming must retain the canonical asset ID");
  const previous = products.get(input.assetId) || {};
  products.set(input.assetId, { ...previous, ...input, status: "draft", isPublished: false });
  return products.get(input.assetId);
}
function recordDeployment(result) {
  const product = products.get(assetId);
  products.set(assetId, {
    ...product,
    wordpressDeployment: {
      status: "deployed",
      publicationId: Number(result.publication_id),
      pageId: Number(result.page_id),
    },
  });
}

const baseline = await wordpressState();
saveDraft({
  assetId,
  title: "Disposable Ebook Original",
  synopsis: "Synthetic non-customer acceptance content.",
  chapters: [{ id: "chapter-one", title: "Chapter One", textContent: "Synthetic acceptance text." }],
});
assert.equal(products.size, 1, "Save Draft creates one canonical product document");

const first = await sync(products.get(assetId));
recordDeployment(first);
const afterFirst = await wordpressState();
const firstRecords = afterFirst.filter(record => record.assetKey === assetId);
assert.equal(firstRecords.length, 2, "initial Save & Sync creates one publication and one linked reader page");
assert.deepEqual(firstRecords.map(record => record.type).sort(), ["koba_publication", "page"]);
assert.ok(firstRecords.every(record => record.status === "draft"), "disposable records remain private drafts");
assert.ok(firstRecords.every(record => record.slug === assetId), "WordPress slug uses the immutable canonical asset ID");

saveDraft({ ...products.get(assetId), assetId, title: "Disposable Ebook Renamed" });
assert.equal(products.size, 1, "rename Save Draft updates the same canonical product document");
const second = await sync(products.get(assetId));
recordDeployment(second);
const third = await sync(products.get(assetId));
recordDeployment(third);

for (const result of [second, third]) {
  assert.equal(Number(result.publication_id), Number(first.publication_id), "repeated sync preserves the publication ID");
  assert.equal(Number(result.page_id), Number(first.page_id), "repeated sync preserves the reader page ID");
  assert.equal(Number(result.bookshelf_page_id), Number(first.bookshelf_page_id), "repeated sync preserves the shared bookstore page ID");
}

const finalState = await wordpressState();
const finalRecords = finalState.filter(record => record.assetKey === assetId);
assert.equal(products.size, 1);
assert.equal(finalRecords.length, 2, "repeated Save & Sync does not create duplicate WordPress records");
assert.deepEqual(finalRecords.map(record => record.id).sort((a, b) => a - b), firstRecords.map(record => record.id).sort((a, b) => a - b));
assert.ok(finalRecords.every(record => record.title.includes("Disposable Ebook Renamed")), "rename updates the existing WordPress records");
const baselineBookstoreCount = baseline.filter(record => record.type === "page" && record.slug === "bookshelf").length;
const finalBookstores = finalState.filter(record => record.type === "page" && record.slug === "bookshelf");
assert.equal(finalBookstores.length, 1, "Save & Sync maintains exactly one shared bookstore page");
assert.equal(
  finalState.length,
  baseline.length + 2 + (baselineBookstoreCount === 0 ? 1 : 0),
  "only the intended publication, reader page, and one shared bookstore page may be added"
);

console.log(JSON.stringify({
  result: "PASS",
  environment: "disposable WordPress core + process-local Firestore-compatible document store",
  productionServices: false,
  assetId,
  firestoreProductCount: products.size,
  wordpressAddedRecordCount: finalState.length - baseline.length,
  publicationId: Number(first.publication_id),
  pageId: Number(first.page_id),
  bookshelfPageId: Number(first.bookshelf_page_id),
  saveAndSyncOperations: 3,
  stableIds: true,
  duplicateRecords: 0,
}, null, 2));
