# Phase 5B — Purchase Claim

Status: implemented and verified locally; not pushed or deployed.

## Scope

Phase 5B connects the approved Phase 5A Firebase reader identity boundary to the
canonical Phase 3 Stripe purchase records. It does not redesign reader identity,
Stripe, entitlements, author authentication, Nexus, WordPress activation, or
publication routing.

## Canonical flow

```text
WordPress publication checkout
  -> Stripe Checkout
  -> central /reader/claim?session_id=...
  -> Phase 5A verified reader session
  -> trusted listener_checkout_sessions record
  -> server-side Stripe session and line-item retrieval
  -> reader_purchases + reader_purchase_items + pending_purchase_claims
  -> idempotent claim transaction
  -> one reader_entitlement per eligible paid line item
```

The browser supplies only the opaque Stripe checkout session ID. It cannot supply
a UID, verified email, tenant, asset, amount, line item, purchase state, claim
state, or entitlement state.

## Financial source of truth

Stripe remains the financial source of truth.

- The signed Stripe webhook records the canonical purchase before invoking
  legacy listener fulfillment.
- If legacy phone/SMS fulfillment fails, the canonical purchase remains recorded
  and the webhook returns success for the canonical path.
- If the canonical write fails, the webhook returns an error so Stripe can retry;
  legacy fulfillment is not run first.
- If the browser reaches the claim page before the webhook, the server re-fetches
  the Checkout Session and line items from Stripe. It records the same canonical,
  deterministic purchase from trusted Stripe evidence before claiming.
- Later webhook delivery is idempotent and may reconcile the same purchase.

## Reader identity and email rules

Claiming requires the existing secure Phase 5A reader cookie. The server resolves
the Firebase UID and active verified reader profile from that cookie. The verified
profile email must hash to the purchase email recorded from Stripe. A mismatch
does not attach the purchase to the reader and enters the existing Phase 3
manual-review state.

A purchase already claimed by the same UID replays safely. A purchase claimed by
another UID is rejected.

## Phone/SMS clarification

Stripe phone-number collection remains enabled as optional customer metadata.
No canonical purchase, claim, entitlement, reader session, or claim-page decision
reads or requires the phone field. This slice sends no SMS. Existing legacy SMS
fulfillment remains isolated and cannot block canonical recording.

## Multiple assets

Canonical line items are resolved from Stripe product/price metadata. Each paid,
eligible line item produces its own deterministic purchase item and reader
entitlement. The purchase header remains one record per Stripe Checkout Session.

## Recovery

The central claim URL is stable and reload-safe. An unauthenticated reader is
sent through reader sign-in or signup and returned to the same claim URL.
An incomplete payment returns HTTP 202 with a retry instruction. Repeated claims
and delayed webhook deliveries are idempotent.

## Stable claim responses

- `202 READER_PURCHASE_PAYMENT_PENDING`
- `400 CHECKOUT_SESSION_REQUIRED`
- `401 READER_SESSION_INVALID`
- `403 READER_PURCHASE_EMAIL_MISMATCH`
- `404 READER_CHECKOUT_NOT_FOUND`
- `409 READER_CHECKOUT_INVALID`
- `409 READER_PURCHASE_ALREADY_CLAIMED`
- `409 READER_PURCHASE_CLAIM_BLOCKED`
- `500 FIREBASE_ADMIN_NOT_CONFIGURED`
- `503 STRIPE_CONFIGURATION_MISSING`

## Validation evidence

- Phase 5B direct tests: 12 passed.
- Complete security suite: 140 passed.
- Nexus/Phase 4 suite: 41 passed.
- Repository-wide TypeScript validation: passed with `tsc --noEmit`.
- Next.js production build: passed; `/reader/claim` and
  `/api/reader/purchases/claim` are present in the production route manifest.

The Phase 5A -> Phase 5B integration test establishes a verified Firebase
password identity, persists its central reader session/profile, records a paid
Stripe purchase with no phone number, claims it using the resulting UID, and
asserts the entitlement.

## Remaining risks

1. A live Stripe/Firebase demonstration requires approved non-production Stripe
   evidence and configured local Firebase Admin credentials; automated tests use
   in-memory Firestore and mocked Stripe.
2. The existing Phase 3 mismatch policy marks an email-mismatched claim for
   manual review. This is intentionally preserved and should receive an operator
   workflow in a future approved slice.
3. Phase 5C must provide the canonical Reader Bookshelf UI; Phase 5B links to the
   existing reader account placeholder after a successful claim.

## Deployment

No push or deployment was performed.