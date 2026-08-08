# Phase 5F — Legacy Reader Authorization Retirement

## Final authorization boundary

- Free publications: Turnstile human verification, `anonymous_free` media token, canonical handoff, protected manifest.
- Paid publications: verified Firebase UID, active `reader_entitlement`, `/reader/open`, canonical handoff, protected manifest.
- Phone, SMS, PIN, legacy reader JWT, `reader_access_keys`, and legacy `entitlements` never authorize publication access.

## Refreshed dependency inventory

| Dependency | Classification | Production caller / replacement | Decision |
| --- | --- | --- | --- |
| `/api/auth/sms-send` and `/api/auth/sms-verify` | REMOVE NOW | Legacy Bloom phone gate; replaced by Turnstile free access and Firebase paid access | Return a stable retired response and remove reader authorization logic. |
| `/api/v2/auth/sms-send` and `/api/v2/auth/sms-verify` | REMOVE NOW | No production caller found; replaced by canonical paths | Return a stable retired response; handlers no longer execute. |
| Twilio Verify reader provider and environment requirements | REMOVE NOW | Only the retired v2 reader routes use them | Remove from the active reader boundary. |
| Sovereign Vault Gateway phone/PIN UI | REMOVE NOW | Legacy WordPress publication fallback | Replace with a fail-closed canonical-access message. |
| `jubilee-core.js` phone/PIN and checkout-completion token fallback | REMOVE NOW | Legacy publication bootstrap | Remove; canonical handoff is the only player bootstrap authorization. |
| E-reader `sessionStorage` legacy token and checkout completion fallback | REMOVE NOW | Legacy inline e-reader bootstrap | Remove; canonical handoff is the only e-reader authorization. |
| `/api/checkout/listener-session/complete` | PRESERVE — CANONICAL | Compatibility reconciliation for old completed-checkout URLs | Preserve Stripe verification and canonical purchase recording, but return `READER_PURCHASE_CLAIM_REQUIRED`; never mint a reader token or phone entitlement. |
| `/api/checkout` | PRESERVE — CANONICAL | Compatibility alias for paid checkout callers | Delegate to canonical `/api/checkout/listener-session`; never invoke SMS. |
| `/api/v2/checkout` and `/api/v2/media/token` | REMOVE NOW | No production caller found | Retire; they mint phone-derived access. |
| `/api/verify-entitlement` | REMOVE NOW | Legacy StudioKey/phone bypass manifest | Retire; it can no longer return media. |
| `/api/library-manifest` | REMOVE NOW | No current plugin caller; superseded by isolated public catalog and protected media manifest | Retire the unscoped legacy manifest. |
| Stripe listener webhook | PRESERVE — CANONICAL | Active financial source of truth | Keep canonical purchase recording; remove only legacy phone-entitlement side effects. |
| `/api/checkout/listener-session` | PRESERVE — CANONICAL | Active paid checkout creation | Keep; optional Stripe phone metadata remains non-authorizing. |
| `reader-token.ts` | PRESERVE — CANONICAL | Signs/verifies canonical Firebase and anonymous-free media tokens | Keep; reject `legacy` principals at the manifest. |
| `includes/streaming.php` provisioning endpoint | PRESERVE — CANONICAL | WordPress inbound publication provisioning | Keep unchanged. |
| `includes/streaming.php` public stream endpoint | REMOVE NOW | No current source caller; bypasses the protected manifest | Unregister/disable the legacy public reader stream route. |
| `reader_access_keys` collection | DATA ONLY | Historical reader migration/audit evidence | Preserve records; remove all authorization reads/writes. |
| Legacy `entitlements` collection | DATA ONLY | Historical purchase and migration evidence | Preserve records; remove all reader authorization reads/writes. |
| Legacy migration contracts and legacy-link fields on canonical entitlements | DATA ONLY | Audit and controlled migration evidence | Preserve. |
| Optional phone fields in Stripe/customer records | DATA ONLY | Optional commerce/contact metadata | Preserve; never use for access decisions and never send SMS absent compliant consent. |
| Dead author `PhoneOtpVerification` component/state | PRESERVE TEMPORARILY | No reachable transition in current author signup; author authentication is out of Phase 5F scope | Do not edit author authentication. Retired reader endpoints cannot authorize publications. |

No dependency remained `UNKNOWN` after caller tracing.

## Retired HTTP contract

Every endpoint classified `REMOVE NOW` returns the same public contract:

- HTTP status: `410 Gone`
- JSON code: `LEGACY_READER_AUTH_RETIRED`
- JSON body: `{ "success": false, "code": "LEGACY_READER_AUTH_RETIRED", "error": "This reader authorization method is no longer supported." }`
- Cache policy: `Cache-Control: no-store`

Compatibility commerce routes are not retirement endpoints: they delegate to or record canonical purchase state and cannot mint reader authorization.

## Data preservation

No Firestore collection, legacy entitlement, access key, audit event, Stripe evidence, Secret Manager credential, or optional phone metadata is deleted or migrated by this change.

## Rollback

Revert the Dashboard retirement commit and the plugin retirement commit independently. Do not roll back data because Phase 5F performs no data mutation. If the plugin must be rolled back, restore the immediately preceding plugin package while retaining the Dashboard commit only if legacy endpoints are not required by that plugin release.
