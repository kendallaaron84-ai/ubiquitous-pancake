# Tenant identity

## Canonical tuple

KOBA-I authorization decisions use a server-resolved tuple:

- authenticated author or reader principal;
- `studioKey`/StudioKey tenant identity;
- canonical `assetId` where a publication is involved;
- verified WordPress origin and website-connection identity where a deployment is involved.

Client-submitted labels, email addresses and origins are requests, not authority.

## Dashboard author context

Studio and Nexus routes resolve the authenticated session, author ID and StudioKey server-side. Publication reads and mutations require the stored product to belong to that author/tenant context. New publication records receive that context at creation.

## Website connections

`GET /api/nexus/websites` lists server-filtered connections for the authenticated author and StudioKey. `PATCH /api/nexus/websites` updates the existing connection by `websiteConnectionId` and `expectedOrigin`, with only the supported role/status fields. The response is non-cacheable, and subsequent GET is authoritative.

Website association chooses an authorized deployment destination. It does not create or replace publication identity and must not be used to merge tenant workspaces.

## Storefront site identity

The WordPress plugin stores a signed storefront site token obtained from the Dashboard license-verification boundary using the site's existing StudioKey and verified WordPress origin. The token, not StudioKey, authorizes the server-to-server tenant catalog request. It remains server-side and is refreshed once on the stable invalid-identity response.

## Reader tenant identity

Reader media authorization requires exact agreement between the requested tenant, product tenant, asset ID and active entitlement tenant/asset pair. Account switching or recovery must reconcile to the canonical purchase; it must not manufacture a duplicate entitlement.
