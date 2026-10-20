# Phase 3/4 application remediation — RC2 rules contract

This branch contains the application changes and candidate Firestore/Storage rules
as one reviewable RC2 contract. Nothing in this branch deploys either ruleset.

## Compatible after this branch

- Login requires a verified Firebase ID token.
- Subscription checkout and status resolve a signed Dashboard session or verified
  Firebase Bearer identity and reject inactive or cross-email StudioKeys.
- Nexus derives its StudioKey from the authenticated session; callers cannot select
  a fallback key.
- Product Catalog cover/background uploads use
  `users/{lowercase-auth-email}/assets/**`.
- Raw public content/publication routes return HTTP 410.
- Legacy Stripe destinations delegate to the canonical signature-verified webhook;
  the canonical `/api/webhook/stripe` integration is unchanged.
- Workbench illustrations use tenant/asset-scoped signed uploads under
  `studio/{assetId}/{studioKey}/illustrated_page/**`. Stored chapter HTML retains
  only that protected identity; Reader manifests replace it with a short-lived
  signed URL and reject cross-tenant pointers.
- Admin Controls writes fixed `system_config` records only through the same-origin,
  authenticated platform-owner API. Automation templates and snapshots use the
  corresponding owner API; ordinary authors have no browser rule access.
- Audiobook requests derive the author identity and StudioKey from the verified
  Dashboard session or Firebase Bearer identity.
- The unused Sales Funnel browser component is retired. `sales_pipeline`, `steps`,
  and `saved_test_runs` are browser-denied by the candidate rules.
- User profile writes use an explicit non-privileged field allowlist. Content
  Engine, Blog Engine, Nexus, license, role, plan, StudioKey, and plugin entitlement
  fields cannot be self-granted by a Firebase browser client.
- Direct browser Storage is limited to the authenticated author's
  `users/{email}/**` and `vault/audio/{email}/**` namespaces. All server-owned
  namespaces, including `studio/**` and `system_config/**`, are denied.

## Verified offline acceptance

- TypeScript compilation, the complete security suite, Nexus suite, API suite, and
  Firestore/Storage emulator contract must all pass for the exact RC2 commit.
- HTTP-level authentication coverage exercises the actual session route handler for
  valid cookie, valid Firebase Bearer, missing, invalid/expired, and cross-license
  identities.
- Emulator tests prove ordinary author profile editing remains available while
  privileged self-grants, cross-tenant data, global configuration, automation,
  sales, Nexus, and server-owned Storage remain denied.

## STOP conditions before production deployment

1. Deploy commands must name the intended Firebase project explicitly. The checked-in
   `.firebaserc` still defaults to `content-engine-prod`, while the accepted Dashboard
   browser assignment is `author-jubilee-command-center`; no implicit default is safe.
2. `KOBA_OWNER_EMAILS` must be set to the approved platform-owner identities before
   Admin Controls or Automation Center owner operations are accepted.
3. The exact immutable RC2 application/rules package requires independent validation.
4. Firestore and Storage rules need a separately authorized backup, deployment,
   monitoring, and rollback window. Application deployment must be coordinated with
   that cutover so neither half is released alone.
