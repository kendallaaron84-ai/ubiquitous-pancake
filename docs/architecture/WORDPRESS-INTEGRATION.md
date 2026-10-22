# WordPress integration

## Components

- Dashboard deployment route: prepares an authorized publication projection.
- Cloud Run `wordpress-egress-gateway-prod`: the only verified server egress path for tenant WordPress publication writes.
- KOBA-I Audio plugin: exposes `/wp-json/kobai/v1/*`, stores WordPress mappings and renders storefront/reader experiences.

## Credential boundary

WordPress Application Passwords belong in Google Secret Manager. Firestore stores references, not raw passwords. The gateway uses its service identity to load credentials, enforces stored origin and username bindings, rejects redirects, and calls the plugin. Browser clients never receive these credentials.

## Publication identity

The canonical bridge key is `assetId`, stored in WordPress metadata as `_koba_asset_key`. A deployment may additionally carry `expectedPublicationId` and `expectedPageId` from the confirmed Firestore mapping. The plugin must reject an expected ID whose stored asset metadata belongs to another publication.

Resolution order for stabilization RC1:

1. Valid expected WordPress ID with matching canonical asset metadata.
2. Existing post located by canonical asset metadata.
3. Legacy slug fallback only for compatibility.
4. Insert only when no existing identity is found.

Identity ambiguity returns HTTP 409 `publication_identity_conflict` and is preserved through the gateway.

## Storefront and reader

The public catalog is a tenant-filtered projection. Anonymous browsing may be public, but the WordPress server authenticates its tenant catalog request with the signed storefront site identity. Protected reader/media requests remain subject to reader-session and entitlement authorization.

## Version boundary

The plugin source header is `6.2.0`, while `info.json` still advertises updater version `6.1.0`. This deliberately prevents the pilot/stabilization code from propagating through the production updater before approval.
