import assert from "node:assert/strict";
import test from "node:test";

import {
  createStudioPublication,
  loadStudioProduct,
  loadStudioTranscriptionQuote,
  uploadStudioFile,
} from "../../studio-client.ts";

const CANONICAL_ASSET_ID = "abk_1234567890abcdef1234567890abcdef";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("new publication creation precedes canonical upload and transcription", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ url, init, body });
    if (url === "/api/studio/publications" && requests.length === 1) {
      return json({ success: true, assetId: CANONICAL_ASSET_ID, product: { id: CANONICAL_ASSET_ID, status: "draft" } }, 201);
    }
    if (url === "/api/studio/publications" && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.assetId, CANONICAL_ASSET_ID);
      assert.equal(body.action, "create_upload");
      assert.equal(body.payload.contentType, "audio/mp4");
      return json({ success: true, upload: {
        uploadUrl: "https://storage.googleapis.test/signed-upload",
        storagePath: `studio/${CANONICAL_ASSET_ID}/studio_test/source/chapter.m4a`,
        canonicalUrl: "https://storage.googleapis.test/canonical/chapter.m4a",
        contentType: "audio/mp4",
      } });
    }
    if (url === "https://storage.googleapis.test/signed-upload") {
      assert.equal(init.method, "PUT");
      assert.equal(init.headers["Content-Type"], "audio/mp4");
      return new Response(null, { status: 200 });
    }
    if (url.startsWith("/api/studio/publications?assetId=")) {
      return json({ success: true, product: { id: CANONICAL_ASSET_ID, status: "draft" } });
    }
    if (url.startsWith("/api/studio/transcribe?assetId=")) {
      return json({ success: true, quote: { pendingTrackCount: 1 }, transcriptionStatus: "not_started" });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const created = await createStudioPublication("audiobook");
    assert.equal(created.assetId, CANONICAL_ASSET_ID);
    const file = new File([new Uint8Array([0, 1, 2])], "chapter.m4a", { type: "" });
    const upload = await uploadStudioFile(created.assetId, file, "source", "audio");
    assert.match(upload.storagePath, new RegExp(`^studio/${CANONICAL_ASSET_ID}/`));
    const reopened = await loadStudioProduct(created.assetId);
    assert.equal(reopened.product.id, CANONICAL_ASSET_ID);
    const transcription = await loadStudioTranscriptionQuote(created.assetId);
    assert.equal(transcription.quote.pendingTrackCount, 1);
    assert.deepEqual(requests.map((request) => request.url), [
      "/api/studio/publications",
      "/api/studio/publications",
      "https://storage.googleapis.test/signed-upload",
      `/api/studio/publications?assetId=${CANONICAL_ASSET_ID}`,
      `/api/studio/transcribe?assetId=${CANONICAL_ASSET_ID}`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unauthorized or placeholder upload never reaches storage", async () => {
  const originalFetch = globalThis.fetch;
  let storageRequests = 0;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("https://")) storageRequests += 1;
    return json({ success: false, code: "STUDIO_PUBLICATION_NOT_FOUND", error: "Publication workspace not found." }, 404);
  };
  try {
    const file = new File([new Uint8Array([0])], "chapter.mp3", { type: "audio/mpeg" });
    await assert.rejects(
      () => uploadStudioFile("abk_new-audiobook-draft", file, "source", "audio"),
      /Publication workspace not found/
    );
    assert.equal(storageRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a signed storage rejection retains its HTTP status for independent diagnosis", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "/api/studio/publications") {
      return json({ success: true, upload: {
        uploadUrl: "https://storage.googleapis.test/signed-upload",
        storagePath: `studio/${CANONICAL_ASSET_ID}/studio_test/source/chapter.mp3`,
        canonicalUrl: "https://storage.googleapis.test/canonical/chapter.mp3",
        contentType: "audio/mpeg",
      } });
    }
    if (url === "https://storage.googleapis.test/signed-upload") {
      return new Response(null, { status: 403 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const file = new File([new Uint8Array([0])], "chapter.mp3", { type: "audio/mpeg" });
    await assert.rejects(
      () => uploadStudioFile(CANONICAL_ASSET_ID, file, "source", "audio"),
      /HTTP 403/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
