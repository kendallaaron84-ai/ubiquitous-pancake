# Phase 3/4 application remediation — rules cutover dependencies

This branch does not deploy or modify Firebase rules. It reconciles the application
against AntiG's proposed production Firestore and Storage posture.

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

## STOP conditions before production rules cutover

AntiG's candidate rules are not yet production-compatible with every browser feature:

1. `app/workbench/[assetId]/page.tsx` uploads illustrations to `studio/**`, which the
   candidate Storage rules deny.
2. `components/admin-controls-modal.tsx` writes `system_config/**` directly from the
   browser, which both candidate rules deny.
3. Candidate Firestore privileged-field protection must explicitly cover
   `hasContentEngineAccess`, `contentEngineEnabled`, `blogEngineEnabled`, and
   `nexusEnabled`.
4. `sales_pipeline`, `steps`, and `saved_test_runs` require an explicit product
   decision (server route, tenant rule, or intentional retirement).
5. Browser audiobook requests must derive the target author from authentication;
   arbitrary cross-author `targetAuthorEmail` input is incompatible with tenant rules.

Production Firestore/Storage rules deployment remains blocked until these items are
corrected or explicitly removed from the supported release scope and independently
regression-tested in the emulators.
