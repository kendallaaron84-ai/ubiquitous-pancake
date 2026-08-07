# Phase 5E — Media Authorization

Status: implemented and verified locally; not pushed or deployed.

## Existing-boundary audit

Before Phase 5E, `/api/media/manifest` treated a legacy reader JWT as the media
principal, then authorized it through `reader_access_keys` and the legacy
`entitlements` collection. Free publications did not require that check. The
Phase 5A HttpOnly session and Phase 3 `reader_entitlements` were therefore not
the authority for playback.

The existing asymmetric reader JWT remains a sound cross-origin transport. It
is retained, but canonical tokens now carry an explicit
`principalType=firebase_uid` claim. Tokens without the claim are treated as
explicit legacy version-0 evidence until Phase 5F. The two paths never silently
fall through into each other.

## Canonical flow

```text
Bookshelf reader
  -> Phase 5A HttpOnly central session
  -> POST /api/reader/media/token
  -> active verified reader profile
  -> exact deployed products/{assetId}
  -> active reader_entitlements UID + tenant + asset
  -> firebase_uid media token
  -> GET /api/media/manifest?asset={assetId}
  -> entitlement revalidation
  -> complete protected chapter manifest
```

Every manifest request revalidates the entitlement. A session or signed token
does not replace authorization. Refund, revocation, or dispute suspension blocks
the next manifest request. Already-issued Storage URLs have a maximum one-hour
authorization window.

## Token endpoint

`POST /api/reader/media/token`

Request body:

```json
{
  "assetId": "abk_publication",
  "tenantId": "KOBA-AUDIO-EXAMPLE"
}
```

Only those two fields are accepted. UID, principal, entitlement ID, source, and
status are always derived server-side. The endpoint requires the Phase 5A
HttpOnly reader cookie and returns a private, non-cacheable response containing
the tenant-scoped media token, expiration, and verified publication URL.

## Manifest authorization

- A token is required for paid and free publications.
- `firebase_uid` tokens authorize only through canonical `reader_entitlements`.
- Unmarked tokens authorize only through the existing legacy boundary.
- Tenant, asset, product, deployment, and requesting WordPress origin must all
  match authoritative server records.
- Disabled, unpublished, non-deployed, refunded, revoked, suspended, missing,
  or cross-tenant evidence fails closed.
- Complete chapter order is preserved.
- Audio and video chapters must reference `studio/{assetId}/...` Storage paths.
- Transcript pointers must reference
  `transcripts/{tenantId}/{assetId}/...`.
- Raw Storage paths and preexisting raw media URLs are removed from responses.
- Signing failures and unmigrated audio/video return a stable 503 instead of a
  public or stale media URL.
- E-book text chapters may be returned without a media Storage object.

## Stable public codes

| Status | Code |
| --- | --- |
| 400 | `READER_MEDIA_REQUEST_INVALID` |
| 400 | `READER_MEDIA_ASSET_INVALID` |
| 400 | `READER_MEDIA_TENANT_INVALID` |
| 401 | `READER_SESSION_INVALID` |
| 401 | `INVALID_READER_MEDIA_TOKEN` |
| 403 | `READER_MEDIA_TENANT_MISMATCH` |
| 403 | `READER_MEDIA_ENTITLEMENT_REQUIRED` |
| 403 | `READER_MEDIA_ORIGIN_NOT_ALLOWED` |
| 403 | `READER_MEDIA_PUBLICATION_NOT_DEPLOYED` |
| 404 | `READER_MEDIA_PUBLICATION_NOT_FOUND` |
| 404 | `READER_MEDIA_PUBLICATION_UNAVAILABLE` |
| 500 | `FIREBASE_ADMIN_NOT_CONFIGURED` |
| 500 | `READER_MEDIA_AUTHORIZATION_FAILED` |
| 503 | `READER_MEDIA_MANIFEST_UNAVAILABLE` |

## Phase 5A through 5E demonstration

The automated integration creates a verified Firebase password reader and its
central session, supplies an active purchase or promotion entitlement, requests
a canonical media token, verifies the token is bound to the Firebase UID and
tenant, revalidates the exact entitlement, and builds a complete two-chapter
manifest containing only namespaced signed URLs.

The same tests prove anonymous, expired, cross-tenant, wrong-origin, disabled,
unpublished, non-deployed, revoked, refunded, and suspended access cannot mint
or consume canonical media authorization.

## Scope preservation

- No Stripe or paid-claim behavior changed.
- No promotion-acquisition behavior changed.
- No phone, SMS, or Twilio dependency was added.
- No Firebase client or direct browser Firestore access was added.
- No author, Nexus, website-connection, publishing, or WordPress activation
  contract changed.
- Legacy retirement remains Phase 5F.

## External WordPress handoff dependency

The WordPress player source is not versioned in the authoritative dashboard
repository. Its existing player already consumes bearer reader tokens at
`/api/media/manifest`, so the server contract is compatible. However, the
external plugin still needs a reviewed handoff that obtains the canonical token
after a Bookshelf click and stores it on the author origin. This commit does not
edit or deploy that external source and does not claim a live cross-domain
player demonstration.

Until that handoff is versioned and reviewed, the dashboard-side Phase 5E
authorization boundary is verified, while live Bookshelf-to-WordPress playback
remains a production integration gate.

## Migration risks

1. Audio/video products containing only public URLs and no namespaced Storage
   path now fail closed. They must be migrated before cutover.
2. `FIREBASE_STORAGE_BUCKET` and Storage signing permissions are required.
3. WordPress origins must exactly match deployed product evidence.
4. The one-hour signed-URL revocation window is bounded but not instantaneous;
   new manifest requests are rejected immediately after entitlement changes.
