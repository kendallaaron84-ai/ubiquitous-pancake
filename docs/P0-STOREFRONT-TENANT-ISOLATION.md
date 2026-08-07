# P0 Storefront Tenant Isolation Audit

## Vulnerability found

`[koba_window]` rendered the activated StudioKey into public HTML. `jubilee-core.js` copied that value into `X-Studio-Key`, and `GET /api/products/public` treated the header as the tenant authority. Although the Firestore query included `where("studioKey", "==", studioKey)`, the untrusted browser selected `studioKey`. CORS also allowed every origin. A caller who altered or manually supplied another active StudioKey could select that tenant's public catalog.

## Remediated flow

```text
verified WordPress connection
  -> websiteConnectionId
  -> authorizedSites grant
  -> signed storefront-site credential stored by WordPress
  -> same-origin WordPress catalog proxy
  -> dashboard verifies signature and live license/site evidence
  -> server-resolved StudioKey
  -> tenant-bound Firestore query
  -> safe published/deployed metadata only
```

The StudioKey remains in WordPress only for the existing activation protocol. It is no longer accepted by the public catalog as authorization. Shortcode `scope="global"` is only a request; the server grants it solely when the verified license has `platformGlobalCatalogAuthority: true` or the explicit `platform_global_catalog` entitlement.

Story World sites additionally require the product deployment's `websiteConnectionId` to match the verified Story World connection. Type filters can only remove results.

## Blast radius

- `[koba_window]` catalogs must use plugin version containing the same-origin catalog proxy.
- Existing activated installations obtain the signed credential lazily on the first catalog request; administrators do not need to replace the StudioKey.
- A revoked/disabled/unverified website immediately fails when the dashboard revalidates its live grant.
- Legacy products without confirmed `wordpressDeployment.status = deployed`, registered author identity, or authoritative tenant are intentionally hidden.
- Player media authorization, Reader Platform sessions, checkout, WordPress publishing, Nexus, and legacy reader-token compatibility are unchanged.
- Existing KOBA-I global presentation requires explicit production license authorization before `scope="global"` will work.

No production data was changed and no deployment was performed.
