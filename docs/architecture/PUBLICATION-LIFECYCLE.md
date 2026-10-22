# Publication lifecycle

## Creation

1. The authenticated author requests `POST /api/studio/publications` with `action=create_publication` and a publication type.
2. The server generates `abk_<uuid>` or `ebk_<uuid>`.
3. The server creates `products/{assetId}` with the authenticated author and tenant context.
4. Studio opens only after this persisted canonical workspace is returned. Placeholder identifiers such as `abk_new-audiobook-draft` are not canonical publications.

## Upload and authoring

1. `create_upload` first loads `products/{assetId}` through the owned-publication guard.
2. The server validates the application-supported media extension/type contract and creates a short-lived signed upload URL.
3. Storage paths are server-generated beneath `studio/{assetId}/{studioKey}/...`.
4. Saving a Studio manifest or Workbench draft verifies referenced objects and keeps the same `assetId`.
5. Refresh/re-entry reloads the persisted workspace by canonical `assetId`.

## Save & Sync

1. The deployment route loads the existing product using the submitted canonical `assetId`; it does not derive identity from the title.
2. Tenant/destination authorization is validated.
3. Required protected paths must belong to the canonical publication and exist before a published deployment can succeed.
4. Existing confirmed WordPress post/page IDs are sent as `expectedPublicationId` and `expectedPageId` when the destination has not changed.
5. The Cloud Run gateway validates and forwards the payload using the tenant's stored WordPress credential.
6. The plugin resolves the target in this order: expected post ID, canonical `_koba_asset_key` metadata, then legacy slug fallback.
7. Conflicting identity returns HTTP 409 `publication_identity_conflict`; it must not create a duplicate.
8. Only a complete WordPress confirmation updates the Firestore deployment mapping and published state.

## Reader resolution

The reader resolves canonical tenant and `assetId`, loads the product/manifest, verifies publication availability, verifies the current reader session and exact entitlement when required, and only then issues protected-media access. A public WordPress page does not prove protected media is available.

## Idempotency contract

- Rename: same `assetId`, same WordPress mapping.
- Repeated Save & Sync: update the mapped WordPress records.
- Retry after ambiguous failure: reconcile using canonical asset metadata and expected IDs.
- Destination change: requires explicit authorized destination selection; stale post IDs from another site are not forwarded.
