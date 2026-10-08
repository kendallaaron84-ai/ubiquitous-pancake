# KOBA-I system boundaries

## Authority table

| Concern | Canonical authority | Non-authoritative projections |
|---|---|---|
| Publication identity | Firestore document ID `products/{assetId}` and matching stored `assetId` | Title, slug, WordPress post ID, storage URL |
| Tenant identity | Verified `StudioKey`/`studioKey` bound to author/workspace and permitted site origin | Browser-selected website label, query parameters |
| Author identity | Authenticated Dashboard session resolved server-side | Submitted email, client-supplied author ID |
| Reader identity | Firebase UID in the verified reader session | Email text, stale client state |
| Purchases | Canonical commerce/order record | WordPress page, browser receipt state |
| Entitlements | Server-managed entitlement keyed to reader UID, tenant and asset | Login alone, publication visibility |
| Protected media | Cloud Storage object path bound to canonical asset and tenant | Signed URL, blob URL, stream ticket |
| WordPress deployment | Firestore deployment mapping plus WordPress metadata `_koba_asset_key` | Title/slug matching alone |

## Trust boundaries

1. Browser to Dashboard API: authentication and tenant/author ownership are re-established server-side. Authoritative fields are rejected from client payloads.
2. Dashboard to Cloud Storage: upload operations require a persisted publication; the server creates short-lived signed upload URLs for tenant-bound paths.
3. Dashboard to WordPress: the Dashboard calls the authenticated Cloud Run egress gateway. The gateway loads the stored tenant credential and validates destination origin.
4. Gateway to plugin: the plugin validates StudioKey/site authorization and upserts by expected WordPress ID or canonical asset metadata.
5. Reader to protected media: the reader session is insufficient by itself; tenant, asset, publication status and entitlement predicates must pass.
6. Stripe/webhooks: signature verification and any Stripe client construction occur only on the server request path requiring them.

## Prohibited shortcuts

- Never regenerate an `assetId` because a title or slug changed.
- Never use StudioKey itself as a browser bearer credential.
- Never expose storefront site bearer tokens to browsers.
- Never accept a WordPress title match as proof of publication identity.
- Never use a signed or temporary URL as progress or publication identity.
- Never weaken IAM, CORS, authentication, ownership or entitlement checks to repair an integration failure.
