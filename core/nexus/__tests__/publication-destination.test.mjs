import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PUBLICATION_DESTINATION_CODES,
  PublicationDestinationError,
  assertCredentialReferenceForConnection,
  assertConfirmedPublicationOrigin,
  resolvePublicationDestination,
} from "../publication-destination.ts";

const ROOT = new URL("../../../", import.meta.url);
const STUDIO_KEY = "KOBA-AUDIO-TEST1234";
const AUTHOR_ID = "author@example.com";

function website(id, overrides = {}) {
  const origin = id === "primary"
    ? "https://business.example.com"
    : `https://${id}.example.com`;
  const gatewayKey = id === "primary" ? STUDIO_KEY : `${STUDIO_KEY}-${id}`;
  return {
    schemaVersion: 1,
    websiteConnectionId: id,
    studioKey: STUDIO_KEY,
    authorId: AUTHOR_ID,
    displayName: id === "primary" ? "Business Website" : "Story World Website",
    wordpressOrigin: origin,
    wordpressUsername: "publisher",
    secretCredentialRef: `projects/400566266819/secrets/WP_CREDS_${gatewayKey}/versions/latest`,
    contentRole: id === "primary" ? "business_brand" : "story_world",
    defaultUniverseId: null,
    status: "active",
    verifiedAt: null,
    lastValidatedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function resolve(overrides = {}) {
  return resolvePublicationDestination({
    studioKey: STUDIO_KEY,
    authorId: AUTHOR_ID,
    connections: [website("primary")],
    ...overrides,
  });
}

function expectDestinationError(fn, status, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof PublicationDestinationError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test("one verified site is selected automatically", () => {
  assert.equal(resolve().websiteConnectionId, "primary");
});

test("two verified sites require explicit selection", () => {
  expectDestinationError(
    () => resolve({ connections: [website("primary"), website("site_story")] }),
    400,
    PUBLICATION_DESTINATION_CODES.required
  );
});

test("an existing product destination is preserved", () => {
  const selected = resolve({
    connections: [website("primary"), website("site_story")],
    existingProduct: { websiteConnectionId: "site_story" },
  });
  assert.equal(selected.websiteConnectionId, "site_story");
});

test("a valid Story World default is selected", () => {
  const selected = resolve({
    connections: [website("primary"), website("site_story")],
    storyWorldDefaultWebsiteConnectionId: "site_story",
  });
  assert.equal(selected.websiteConnectionId, "site_story");
});

test("two products can resolve to two different verified websites", () => {
  const connections = [website("primary"), website("site_story")];
  const businessProduct = resolve({
    connections,
    requestedWebsiteConnectionId: "primary",
  });
  const storyProduct = resolve({
    connections,
    requestedWebsiteConnectionId: "site_story",
  });

  assert.equal(businessProduct.targetWpOrigin, "https://business.example.com");
  assert.equal(storyProduct.targetWpOrigin, "https://site_story.example.com");
  assert.notEqual(
    businessProduct.secretCredentialRef,
    storyProduct.secretCredentialRef
  );
});

test("explicit Business Brand and Both destinations are accepted", () => {
  const connections = [
    website("primary"),
    website("site_both", { contentRole: "both" }),
  ];
  assert.equal(resolve({ connections, requestedWebsiteConnectionId: "primary" }).contentRole, "business_brand");
  assert.equal(resolve({ connections, requestedWebsiteConnectionId: "site_both" }).contentRole, "both");
});

test("wrong-owner and wrong-studio destinations are rejected", () => {
  expectDestinationError(
    () => resolve({
      connections: [website("primary", { authorId: "someone-else@example.com" })],
      requestedWebsiteConnectionId: "primary",
    }),
    403,
    PUBLICATION_DESTINATION_CODES.forbidden
  );
  expectDestinationError(
    () => resolve({
      connections: [website("primary", { studioKey: "KOBA-AUDIO-OTHER" })],
      requestedWebsiteConnectionId: "primary",
    }),
    403,
    PUBLICATION_DESTINATION_CODES.forbidden
  );
});

test("disabled and unverified destinations are rejected", () => {
  for (const status of ["disabled", "verification_failed"]) {
    expectDestinationError(
      () => resolve({
        connections: [website("primary", { status })],
        requestedWebsiteConnectionId: "primary",
      }),
      409,
      PUBLICATION_DESTINATION_CODES.unavailable
    );
  }
});

test("a legacy associated website maps to the exact verified connection", () => {
  const selected = resolve({
    connections: [website("primary"), website("site_story")],
    existingProduct: { associatedWebsite: "https://site_story.example.com/path" },
  });
  assert.equal(selected.websiteConnectionId, "site_story");
});

test("an ambiguous legacy deployment is marked for review", () => {
  assert.throws(
    () => resolve({
      connections: [website("primary"), website("site_story")],
      existingProduct: {
        associatedWebsite: "https://retired.example.com",
        hasConfirmedDeployment: true,
      },
    }),
    (error) => {
      assert.equal(error.code, PUBLICATION_DESTINATION_CODES.ambiguous);
      assert.equal(error.destinationStatus, "needs_review");
      return true;
    }
  );
});

test("an existing deployed product is not silently moved", () => {
  const existingProduct = {
    websiteConnectionId: "primary",
    associatedWebsite: "https://business.example.com",
    hasConfirmedDeployment: true,
  };
  expectDestinationError(
    () => resolve({
      connections: [website("primary"), website("site_story")],
      existingProduct,
      requestedWebsiteConnectionId: "site_story",
    }),
    409,
    PUBLICATION_DESTINATION_CODES.confirmationRequired
  );
  assert.equal(resolve({
    connections: [website("primary"), website("site_story")],
    existingProduct,
    requestedWebsiteConnectionId: "site_story",
    confirmDestinationChange: true,
  }).websiteConnectionId, "site_story");

  expectDestinationError(
    () => resolve({
      connections: [website("primary"), website("site_story")],
      existingProduct: {
        associatedWebsite: "https://retired.example.com",
        hasConfirmedDeployment: true,
      },
      requestedWebsiteConnectionId: "site_story",
    }),
    409,
    PUBLICATION_DESTINATION_CODES.confirmationRequired
  );
});

test("gateway confirmation must match the selected origin", () => {
  assert.equal(
    assertConfirmedPublicationOrigin("https://site_story.example.com", "https://site_story.example.com/path"),
    "https://site_story.example.com"
  );
  expectDestinationError(
    () => assertConfirmedPublicationOrigin("https://site_story.example.com", "https://business.example.com"),
    502,
    "WORDPRESS_DEPLOYMENT_FAILED"
  );
});

test("deployment route uses the resolved destination and preserves publication payloads", async () => {
  const route = await readFile(new URL("app/api/agent/deploy/route.ts", ROOT), "utf8");
  assert.match(route, /websiteConnectionId\?: unknown/);
  assert.match(route, /resolvePublicationDestination/);
  assert.match(route, /destination: ResolvedPublicationDestination/);
  assert.match(route, /studioKey: input\.studioKey/);
  assert.match(route, /websiteConnectionId: input\.destination\.websiteConnectionId/);
  assert.match(route, /secretCredentialRef: input\.destination\.secretCredentialRef/);
  assert.match(route, /const targetWpOrigin = input\.destination\.targetWpOrigin/);
  assert.match(route, /const wpUsername = input\.destination\.wpUsername/);
  assert.match(route, /websiteConnectionId: destination\.websiteConnectionId/);
  assert.match(route, /chapters: input\.chapters/);
  assert.match(route, /ebookPayload: input\.ebookPayload/);
  assert.doesNotMatch(
    route,
    /async function deployPublicationToWordPress[\s\S]*?collection\("connections"\)/
  );
  assert.match(route, /stripeConnectId: FieldValue\.delete\(\)/);
  assert.match(route, /stripeAccountId: FieldValue\.delete\(\)/);
});

test("Product Catalog requires and submits a verified destination", async () => {
  const productPage = await readFile(new URL("app/products/page.tsx", ROOT), "utf8");
  assert.match(productPage, /Destination Website/);
  assert.match(productPage, /websiteConnectionId/);
  assert.match(productPage, /Choose where KOBA-I should create this book/);
  assert.match(productPage, /confirmDestinationChange/);
  assert.match(productPage, /contentRole/);
});

test("missing destination returns the stable 400 code when two sites exist", () => {
  assert.throws(
    () => resolve({ connections: [website("primary"), website("site_story")] }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "PUBLICATION_DESTINATION_REQUIRED");
      assert.match(error.publicMessage, /Choose where KOBA-I should create this book/);
      return true;
    }
  );
});

test("secondary website credentials use their exact connection-scoped secret", () => {
  const connection = website("site_story");
  assert.equal(
    assertCredentialReferenceForConnection(
      STUDIO_KEY,
      connection.websiteConnectionId,
      connection.secretCredentialRef
    ),
    connection.secretCredentialRef
  );
  expectDestinationError(
    () => assertCredentialReferenceForConnection(
      STUDIO_KEY,
      "site_story",
      website("primary").secretCredentialRef
    ),
    409,
    PUBLICATION_DESTINATION_CODES.unavailable
  );
});

test("publication page and bookshelf confirmations are required before success", async () => {
  const route = await readFile(new URL("app/api/agent/deploy/route.ts", ROOT), "utf8");
  assert.match(route, /publicationId = positiveInteger\(payload\.publication_id\)/);
  assert.match(route, /pageId = positiveInteger\(payload\.page_id\)/);
  assert.match(route, /bookshelfPageId = positiveInteger\(payload\.bookshelf_page_id\)/);
  assert.match(route, /publicationUrl = clean\(payload\.url\)/);
  assert.match(route, /bookshelfUrl = clean\(payload\.bookshelf_url\)/);
});

test("product stores the selected connection and gateway-confirmed origin", async () => {
  const route = await readFile(new URL("app/api/agent/deploy/route.ts", ROOT), "utf8");
  const migration = await readFile(new URL("core/nexus/publication-migration.ts", ROOT), "utf8");
  assert.match(route, /buildAuthoritativeDeploymentFields\(wordpress, timestamp\)/);
  assert.match(migration, /websiteConnectionId: confirmation\.websiteConnectionId/);
  assert.match(migration, /associatedWebsite: normalizeOrigin\(confirmation\.targetWpOrigin\)/);
  assert.match(migration, /targetWpOrigin: normalizeOrigin\(confirmation\.targetWpOrigin\)/);
});

test("deployment failure recovery preserves the last confirmed publication state", async () => {
  const route = await readFile(new URL("app/api/agent/deploy/route.ts", ROOT), "utf8");
  assert.match(route, /status: hasConfirmedWordPressDeployment[\s\S]*?clean\(existing\.status\)/);
  assert.match(route, /buildFailedDeploymentPatch/);
  assert.match(route, /DESTINATION_CHANGE_FAILED_MESSAGE/);
  assert.doesNotMatch(route, /originalAssets.*delete/i);
});

test("missing deployment configuration retains 503 behavior", async () => {
  const route = await readFile(new URL("app/api/agent/deploy/route.ts", ROOT), "utf8");
  assert.match(route, /new WordPressDeploymentError\(\s*503,/);
  assert.match(route, /if \(error instanceof WordPressDeploymentError\)/);
});

test("browser payload sends no WordPress credentials or origin", async () => {
  const productPage = await readFile(new URL("app/products/page.tsx", ROOT), "utf8");
  const payloadBlock = productPage.match(/const payload = \{[\s\S]*?\n    \};/)?.[0] || "";
  assert.match(payloadBlock, /websiteConnectionId: selectedWebsite\.websiteConnectionId/);
  assert.doesNotMatch(payloadBlock, /targetWpOrigin|wpUsername|secretCredentialRef|wpAppPassword/);
});

test("Save & Sync is disabled until an active destination is selected", async () => {
  const productPage = await readFile(new URL("app/products/page.tsx", ROOT), "utf8");
  assert.match(productPage, /!websiteConnections\.some\(\(website\) =>/);
  assert.match(productPage, /website\.status === "active"/);
  assert.match(productPage, /Save & Sync/);
});

test("product summaries display their bound destination", async () => {
  const productPage = await readFile(new URL("app/products/page.tsx", ROOT), "utf8");
  assert.match(productPage, /Destination: \{websiteConnections\.find/);
  assert.match(productPage, /product\.associatedWebsite/);
});
