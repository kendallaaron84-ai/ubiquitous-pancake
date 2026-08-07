import assert from "node:assert/strict";
import test from "node:test";

import {
  createPaidReaderLaunchHandler,
  paidReaderLaunchPath,
  safeReaderContinuation,
} from "../reader-paid-launch.ts";

test("signed-out paid launch preserves the asset through reader sign-in", async () => {
  let handoffRequest;
  const handler = createPaidReaderLaunchHandler(async (request) => {
    handoffRequest = request;
    return Response.json(
      { success: false, code: "READER_SESSION_INVALID", error: "Sign in." },
      { status: 401 }
    );
  });

  const response = await handler(
    new Request(
      "https://dashboard.koba-i.com/reader/open?assetId=ebk_testing-paid-book"
    )
  );

  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/reader/signin");
  assert.equal(
    location.searchParams.get("next"),
    "/reader/open?assetId=ebk_testing-paid-book"
  );
  assert.deepEqual(await handoffRequest.json(), {
    assetId: "ebk_testing-paid-book",
  });
});

test("signed-in paid launch delegates to the canonical handoff and redirects", async () => {
  const handler = createPaidReaderLaunchHandler(async (request) => {
    assert.equal(request.headers.get("cookie"), "koba_reader_session=session.token");
    assert.deepEqual(await request.json(), { assetId: "abk_owned" });
    return Response.json({
      success: true,
      launchUrl:
        "https://author.example/koba_publication/book/#koba_reader_handoff=opaque",
    });
  });

  const response = await handler(
    new Request("https://dashboard.koba-i.com/reader/open?assetId=abk_owned", {
      headers: { cookie: "koba_reader_session=session.token" },
    })
  );

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "https://author.example/koba_publication/book/#koba_reader_handoff=opaque"
  );
});

test("paid launch input fails closed before handoff", async () => {
  let calls = 0;
  const handler = createPaidReaderLaunchHandler(async () => {
    calls += 1;
    return Response.json({ success: true });
  });

  for (const url of [
    "https://dashboard.koba-i.com/reader/open",
    "https://dashboard.koba-i.com/reader/open?assetId=bad%2Fasset",
    "https://dashboard.koba-i.com/reader/open?assetId=abk_book&uid=attacker",
  ]) {
    const response = await handler(new Request(url));
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

test("reader continuation accepts only claim or strict paid launch paths", () => {
  assert.equal(
    safeReaderContinuation("/reader/claim?session_id=cs_live_123"),
    "/reader/claim?session_id=cs_live_123"
  );
  assert.equal(
    safeReaderContinuation("/reader/open?assetId=ebk_testing-paid-book"),
    "/reader/open?assetId=ebk_testing-paid-book"
  );
  assert.equal(safeReaderContinuation("https://attacker.example/reader/open?assetId=abk_book"), null);
  assert.equal(safeReaderContinuation("/reader/open?assetId=bad/asset"), null);
  assert.equal(safeReaderContinuation("/reader/open?assetId=abk_book&next=/admin"), null);
});

test("paidReaderLaunchPath normalizes only valid asset IDs", () => {
  assert.equal(paidReaderLaunchPath("  abk_book  "), "/reader/open?assetId=abk_book");
  assert.equal(paidReaderLaunchPath("x"), null);
  assert.equal(paidReaderLaunchPath("abk/book"), null);
});
