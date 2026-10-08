# Security invariants

These conditions are release-blocking.

1. Canonical publication IDs are immutable across edit, rename, save, retry and WordPress synchronization.
2. Tenant and author identity are resolved from authenticated server context, not accepted from browser assertions.
3. A storage path used by Studio or deployment must be bound to the exact canonical asset and tenant.
4. Signed URLs, blob URLs, stream tickets and WordPress post IDs are never canonical publication or progress identity.
5. Protected media requires the correct reader principal and exact active tenant/asset entitlement unless the publication's verified access contract explicitly allows anonymous access.
6. Purchases, entitlements, refunds, disputes and suspensions are preserved and changed only through their canonical services.
7. WordPress writes travel through the authenticated gateway using vaulted, origin-bound credentials.
8. Storefront bearer tokens and WordPress credentials remain server-side. StudioKey is not a bearer token.
9. Webhook signatures are validated before event handling; secret-backed SDKs initialize only on request paths that require them.
10. A publication cannot be reported published when required protected objects or WordPress confirmations are missing.
11. Cross-tenant lookup fallbacks, automatic workspace merges and silent StudioKey rebinding are prohibited.
12. CI, staging acceptance, independent review and founder approval must all pass before production promotion.

## Known open security finding

The current full security suite reports one failure because inline Workbench chapter-image upload still imports Firebase Storage directly. Audio and illustrated-page uploads already use the server-owned publication API. This remains a release-gate finding until separately repaired or explicitly risk-accepted by the founder after independent review.
