# Phase 5D — Free Publication Acquisition

## Status

Implemented and verified locally. Not pushed or deployed.

## Phase 3 Promotion-Service Audit

The approved Phase 3 service already provided the correct low-level
capabilities:

- deterministic promotion entitlement ID derived from Firebase UID, tenant ID,
  and asset ID;
- canonical `source: promotion` and `status: active` fields;
- transactional entitlement creation;
- append-only `entitlement.created` audit evidence;
- active and verified reader enforcement.

It was retained rather than redesigned. It was not sufficient as a public
acquisition boundary because it did not load the product, validate free
eligibility, require a completed deployment, validate tenant ownership, or
reject replay of a revoked entitlement. Phase 5D adds those controls around the
existing service.

## Canonical Flow

```text
Free publication request
  -> HttpOnly Phase 5A reader-session cookie
  -> active and verified Firebase UID
  -> exact server-side products/{assetId} read
  -> published + deployed + explicitly free validation
  -> exact product tenant match
  -> deterministic promotion entitlement transaction
  -> append-only audit events
  -> /reader/account Bookshelf continuation
```

The Phase 5C Bookshelf remains the sole authenticated reader entitlement
surface. No author-management record or interface is used as a reader content
source.

## API Contract

`POST /api/reader/publications/free-acquire`

Required JSON body:

```json
{
  "assetId": "abk_example",
  "tenantId": "KOBA-AUDIO-EXAMPLE"
}
```

The request body is strict. Additional keys are rejected. In particular, the
browser cannot submit a Firebase UID, entitlement source, entitlement status,
purchase evidence, or entitlement type.

Authentication is the canonical `koba_reader_session` HttpOnly cookie. The
server resolves the Firebase UID from that session.

Successful response:

```json
{
  "success": true,
  "assetId": "abk_example",
  "entitlementId": "deterministic-server-id",
  "acquired": true,
  "replay": false,
  "bookshelfUrl": "/reader/account"
}
```

A duplicate request returns `200`, the same entitlement ID, `acquired: false`,
and `replay: true`.

All responses use `Cache-Control: private, no-store`.

## Free Eligibility

A product must meet every requirement:

- exact product document exists;
- `status` is `published` or `isPublished` is `true`;
- `wordpressDeployment.status` is exactly `deployed`;
- stored `studioKey` or `wpStudioKey` exactly matches the requested tenant;
- the server-owned product explicitly indicates free access through
  `isFree: true`, `accessType: free|promotion|public`, or an explicit numeric
  `price`/`unitPrice` of zero.

Missing prices are not treated as free. Positive, malformed, draft, missing,
disabled, non-deployed, and cross-tenant products fail closed.

## Stable Public Errors

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `FREE_PUBLICATION_REQUEST_INVALID` | Invalid JSON, missing fields, or browser-supplied authority fields |
| 400 | `FREE_PUBLICATION_ASSET_INVALID` | Malformed asset identifier |
| 400 | `FREE_PUBLICATION_TENANT_INVALID` | Malformed tenant identifier |
| 401 | `READER_SESSION_INVALID` | Missing, invalid, or expired reader session |
| 403 | `READER_EMAIL_VERIFICATION_REQUIRED` | Reader email is not verified |
| 403 | `READER_ACCOUNT_NOT_ACTIVE` | Reader is disabled or deleted |
| 404 | `FREE_PUBLICATION_NOT_FOUND` | Exact product does not exist |
| 409 | `FREE_PUBLICATION_DISABLED` | Product is explicitly disabled |
| 409 | `FREE_PUBLICATION_UNPUBLISHED` | Product is draft or unpublished |
| 409 | `FREE_PUBLICATION_NOT_DEPLOYED` | WordPress deployment is not confirmed |
| 403 | `FREE_PUBLICATION_NOT_ELIGIBLE` | Product is not configured for free acquisition |
| 403 | `FREE_PUBLICATION_TENANT_MISMATCH` | Product belongs to another tenant |
| 403 | `FREE_PUBLICATION_ASSET_MISMATCH` | Stored product asset evidence conflicts with the requested document |
| 409 | `FREE_PUBLICATION_ENTITLEMENT_INACTIVE` | Deterministic promotion entitlement was revoked/inactivated |
| 409 | `FREE_PUBLICATION_ENTITLEMENT_CONFLICT` | Deterministic ID contains incompatible evidence |
| 500 | `FIREBASE_ADMIN_NOT_CONFIGURED` | Required server configuration is unavailable |
| 500 | `FREE_PUBLICATION_ACQUISITION_FAILED` | Safe unexpected server failure |

## Audit Evidence

First acquisition writes:

- canonical `entitlement.created` with `source: promotion`; and
- `promotion.acquired` identifying the reader actor and exact tenant/asset.

Repeated acquisition creates neither another entitlement nor another
acquisition event. Revoked promotion entitlements remain revoked and cannot be
reactivated through this endpoint.

## Phase 5A → 5D Demonstration

The direct integration test executes:

1. verified Firebase password identity establishment;
2. central reader-session creation;
3. authenticated free-publication request;
4. server-side product and tenant validation;
5. deterministic promotion-entitlement creation;
6. Phase 5C `listReaderBookshelf` using the same active-entitlement query;
7. the acquired publication appearing in the Bookshelf safe projection.

## Security and Scope

- No Stripe import or call.
- No phone-number field or dependency.
- No SMS or Twilio import or call.
- No client Firestore access.
- No media token, manifest, stream, or playback change.
- No WordPress plugin change.
- No paid purchase/claim change.
- No legacy-path retirement.

## Remaining Risks

- Existing production products must carry an explicit free signal and a
  confirmed deployment status before this endpoint will grant access.
- No author-storefront button is added in this slice because WordPress/plugin
  integration is explicitly excluded. The endpoint is ready for a separately
  reviewed caller.
- Live Firebase/Firestore and deployed-route demonstration remains pending
  explicit deployment approval.
