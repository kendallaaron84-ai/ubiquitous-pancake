# Phase 5C — Reader Bookshelf

Status: implemented and verified locally; not pushed or deployed.

## Scope

Phase 5C makes `/reader/account` the canonical reader landing experience. It
preserves the approved Phase 5A identity/session and Phase 5B purchase/claim
contracts. It does not change media playback, WordPress integration, author
management, entitlement creation, or purchase processing.

## Authorization boundary

The Bookshelf is rendered from the server. The server:

1. reads the HttpOnly Phase 5A reader-session cookie;
2. validates the persisted reader session and active verified profile;
3. queries only `reader_entitlements` whose `readerUid` matches the session UID
   and whose status is `active`;
4. joins each entitlement to the exact `products/{assetId}` document;
5. requires the product tenant to match the entitlement tenant;
6. includes only published products and rejects non-deployed publication states;
7. returns a fixed safe reader-facing metadata projection.

The client receives no Firestore query capability, entitlement query, author
email, chapters, media URLs, Stripe evidence, credential references, or
author-management controls.

## Safe publication metadata

- asset ID
- title
- description
- verified stored author display name
- publication type
- category
- safe HTTPS or local cover URL
- confirmed HTTPS WordPress publication URL, when available

Multiple active entitlements for the same tenant and asset are deduplicated in
the Bookshelf. Multiple different entitled publications are displayed.

## Reader experience

- `/reader` redirects to `/reader/account`.
- An invalid or absent reader session redirects to reader sign-in and preserves
  the Bookshelf continuation.
- A new reader with no active entitlements receives a clear empty state.
- An entitled reader sees a responsive card for every authorized published
  publication.
- Author Library and Product Catalog remain separate and unchanged.

## Phase 5A → 5B → 5C demonstration

The direct integration test creates a verified Firebase password reader and
central session through Phase 5A, records and claims a Stripe-backed purchase
through the canonical Phase 5B services, and then proves the resulting active
entitlement is the only authority that adds the published product to the Phase
5C Bookshelf.

## Validation evidence

- Phase 5C direct tests: 6 passed.
- Complete security suite: 146 passed.
- Nexus/Phase 4 suite: 41 passed.
- Repository-wide TypeScript validation: passed with `tsc --noEmit`.
- Next.js production build: passed; `/reader/account` is rendered dynamically
  on the server.

## Remaining risks

1. The demonstration is automated with in-memory Firestore; a live
   non-production Firebase/Stripe demonstration requires approved credentials.
2. Media authorization remains deliberately unchanged until Phase 5E. Opening a
   publication uses its already-confirmed WordPress URL and does not create a new
   playback authorization path.
3. Free-publication promotion entitlement creation belongs to Phase 5D.

## Deployment

No push or deployment was performed.
