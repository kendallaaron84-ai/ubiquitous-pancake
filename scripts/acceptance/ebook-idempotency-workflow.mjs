import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const origin = process.env.KOBA_DISPOSABLE_WORDPRESS_ORIGIN || "http://127.0.0.1:9400";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST is required; this acceptance must use the real Firestore emulator");
const firestoreProject = "koba-ebook-idempotency-test";
const firestoreBase = `http://${firestoreHost}/v1/projects/${firestoreProject}/databases/(default)/documents`;
const firestoreAdminHeaders = { Authorization: "Bearer owner" };
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

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toFirestoreValue(nested)])) } };
}
function fromFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [key, fromFirestoreValue(nested)]));
  throw new Error(`Unsupported Firestore value: ${JSON.stringify(value)}`);
}
async function assertFirestoreSuccess(response) {
  if (response.status !== 200) {
    throw new Error(`Firestore emulator HTTP ${response.status}: ${await response.text()}`);
  }
}
async function readProduct(id) {
  const response = await fetch(`${firestoreBase}/products/${encodeURIComponent(id)}`, { headers: firestoreAdminHeaders });
  if (response.status === 404) return null;
  await assertFirestoreSuccess(response);
  const document = await response.json();
  return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
}
async function writeProduct(id, product) {
  const response = await fetch(`${firestoreBase}/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...firestoreAdminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(product).map(([key, value]) => [key, toFirestoreValue(value)])) }),
  });
  await assertFirestoreSuccess(response);
  return readProduct(id);
}
async function productCount() {
  const response = await fetch(`${firestoreBase}/products?pageSize=100`, { headers: firestoreAdminHeaders });
  await assertFirestoreSuccess(response);
  const payload = await response.json();
  return (payload.documents || []).length;
}
async function saveDraft(input) {
  assert.equal(input.assetId, assetId, "editing and renaming must retain the canonical asset ID");
  const previous = await readProduct(input.assetId) || {};
  return writeProduct(input.assetId, { ...previous, ...input, status: "draft", isPublished: false });
}
async function recordDeployment(result) {
  const product = await readProduct(assetId);
  return writeProduct(assetId, {
    ...product,
    wordpressDeployment: {
      status: "deployed",
      publicationId: Number(result.publication_id),
      pageId: Number(result.page_id),
    },
  });
}

const baseline = await wordpressState();
let product = await saveDraft({
  assetId,
  title: "Disposable Ebook Original",
  synopsis: "Synthetic non-customer acceptance content.",
  chapters: [{ id: "chapter-one", title: "Chapter One", textContent: "Synthetic acceptance text." }],
});
assert.equal(await productCount(), 1, "Save Draft creates one canonical Firestore product document");

const first = await sync(product);
product = await recordDeployment(first);
const afterFirst = await wordpressState();
const firstRecords = afterFirst.filter(record => record.assetKey === assetId);
assert.equal(firstRecords.length, 2, "initial Save & Sync creates one publication and one linked reader page");
assert.deepEqual(firstRecords.map(record => record.type).sort(), ["koba_publication", "page"]);
assert.ok(firstRecords.every(record => record.status === "draft"), "disposable records remain private drafts");
assert.ok(firstRecords.every(record => record.slug === assetId), "WordPress slug uses the immutable canonical asset ID");

product = await saveDraft({ ...product, assetId, title: "Disposable Ebook Renamed" });
assert.equal(await productCount(), 1, "rename Save Draft updates the same canonical Firestore product document");
const second = await sync(product);
product = await recordDeployment(second);
const third = await sync(product);
product = await recordDeployment(third);

for (const result of [second, third]) {
  assert.equal(Number(result.publication_id), Number(first.publication_id), "repeated sync preserves the publication ID");
  assert.equal(Number(result.page_id), Number(first.page_id), "repeated sync preserves the reader page ID");
  assert.equal(Number(result.bookshelf_page_id), Number(first.bookshelf_page_id), "repeated sync preserves the shared bookstore page ID");
}

const finalState = await wordpressState();
const finalRecords = finalState.filter(record => record.assetKey === assetId);
assert.equal(await productCount(), 1);
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
  environment: "disposable WordPress core + real local Firestore emulator",
  productionServices: false,
  assetId,
  firestoreProductCount: await productCount(),
  wordpressAddedRecordCount: finalState.length - baseline.length,
  publicationId: Number(first.publication_id),
  pageId: Number(first.page_id),
  bookshelfPageId: Number(first.bookshelf_page_id),
  saveAndSyncOperations: 3,
  stableIds: true,
  duplicateRecords: 0,
}, null, 2));
