# Reader Platform Architecture

## Purpose

The Reader Platform is the shared server-side ownership and access foundation for every KOBA-I publication. Firebase UID is the reader principal; Stripe evidence creates purchases; claims attach purchases to a verified UID; entitlements authorize assets.

## Canonical flow

`Stripe checkout → reader_purchases → reader_purchase_items → pending_purchase_claims → Firebase UID → reader_entitlements → reader library → reader_audit_events`

The Stripe webhook is authoritative. The checkout-completion route may reconcile a paid session directly with Stripe for abandoned-webhook recovery. Legacy phone access continues in parallel until Phase 5.

## Security responsibilities

- Authorization always resolves UID + tenant + asset + active entitlement.
- Email assists a claim but is never an authorization principal.
- Phone, IP, JWT, cookies, and browser storage do not establish canonical ownership.
- All canonical collections are server-only until deployed Firestore rules are exported and audited.

## Future extension points

Phase 4 integrates WordPress; Phase 5 integrates secure cookies and cuts traffic over from SMS. `manual_grant` is reserved but has no current workflow. Gift and family-sharing systems are outside scope.
