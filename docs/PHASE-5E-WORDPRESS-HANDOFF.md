# Phase 5E — Canonical Bookshelf-to-WordPress Handoff

## Status

- Server authorization: implemented and verified.
- WordPress handoff: implemented and verified with executable local integration tests.
- Plugin production baseline: captured separately at `e71aed2` (version 6.0.6).
- Plugin release candidate: version 6.0.7 at `a863834` on `codex/phase-5e-reader-handoff`.
- Production media inventory: tooling implemented; live read-only execution is blocked by invalid local Firestore credentials.
- Live production playback: not demonstrated and not deployed.
- Phase 5F: blocked until inventory/migration and live playback gates pass.

## Dependency map

| Surface | Existing responsibility | Phase 5E impact |
|---|---|---|
| `components/reader/ReaderAccount.tsx` | Server-owned Bookshelf card UI | Replaces direct publication navigation with a same-origin handoff request. |
| `app/api/reader/media/handoff/route.ts` | New central handoff boundary | Validates the central reader session, derives tenant/origin from Firestore, validates entitlement, and creates a five-minute opaque author-site handoff. |
| `app/api/reader/media/handoff/exchange/route.ts` | New cross-origin exchange boundary | Requires exact HTTPS Origin, consumes the handoff once, revalidates entitlement and origin, and returns a `firebase_uid` media JWT. |
| `core/security/reader-media-authorization.ts` | Canonical publication/tenant/origin/entitlement authorization and protected manifest paths | Reused without weakening its active-entitlement or namespaced-storage requirements. |
| `app/api/media/manifest/route.ts` | Existing bearer-token manifest endpoint | Unchanged. Canonical and legacy principals remain explicitly separated by `principalType`. |
| Plugin `assets/reader-handoff.js` | New bootstrap-only integration | Removes the opaque fragment, performs the exchange, and stores the JWT in the existing tenant registry. |
| Plugin `assets/jubilee-core.js` | Catalog, checkout, legacy session, bearer-manifest request, audio/video bootstrap | Awaits and prefers a canonical session for the selected asset; canonical failure cannot fall through to SMS/legacy. |
| Plugin `koba-i-audio.php` | Activation, shortcodes, templates, e-reader bootstrap, asset enqueue/localization | Enqueues/localizes the bootstrap and gives the e-reader its studio identity; activation and routing are unchanged. |
| Plugin `assets/bloom-player.js` | Audio/video rendering | Unchanged. |
| Plugin `includes/shortcodes-v2.php` | Reader shortcode delegation | Unchanged. |
| Plugin `includes/streaming.php` | Legacy streaming route | Unchanged until Phase 5F. |

## Security flow

```text
verified central reader cookie
  -> POST /api/reader/media/handoff { assetId }
  -> server derives tenant and exact WordPress origin
  -> active UID/tenant/asset entitlement required
  -> five-minute one-time author_site session bound to origin + asset
  -> publication URL fragment contains only opaque session credentials
  -> plugin removes fragment before exchange
  -> POST /api/reader/media/handoff/exchange with exact Origin
  -> one-time session consumed atomically
  -> entitlement and publication origin revalidated
  -> firebase_uid bearer token returned
  -> existing Authorization: Bearer contract calls /api/media/manifest
  -> protected, complete chapter manifest
```

The central Firebase UID JWT is never placed in the launch URL. The fragment is not sent to WordPress and is removed before exchange. A handoff is bound to one exact HTTPS origin and one asset and is consumed once.

## Canonical and legacy coexistence

- A canonical fragment activates only the canonical exchange.
- Canonical rejection is marked and cannot open the SMS/access-key fallback.
- In the absence of a canonical fragment/session, existing checkout, tenant registry, session-storage migration, and SMS/access-key behavior remain available until Phase 5F.
- The manifest route continues to distinguish `principalType=firebase_uid` from unmarked legacy JWTs.

## Blast radius

No behavioral changes were made to plugin activation/licensing, `jubilee_catalog`, `koba_window`, Story World content, WordPress publication routes, global catalog rendering, Bloom audio/video rendering, or the manifest response shape. The required plugin version bump is 6.0.6 to 6.0.7 because one PHP file and two runtime assets changed.

## Verification

- Focused server tests: 26 passed.
- Full security suite: 182 passed.
- Nexus suite: 41 passed.
- Plugin executable tests: 4 passed.
- TypeScript: passed.
- Next.js production build: passed.
- Plugin JavaScript syntax: passed.
- Plugin PHP lint: unavailable because PHP CLI is not installed on this workstation.

The executable integration tests demonstrate paid and promotion entitlement handoffs and fail closed for anonymous, wrong-origin, expired, replayed, revoked, refunded, suspended, and cross-tenant requests.

## Protected media inventory and migration gate

`scripts/inventory-reader-media-storage.mjs` is read-only. It reports each audio/video chapter as `protected`, `public_url_only`, or `missing`, emits only a public origin (not the full URL), and proposes a deterministic `studio/{assetId}/chapter-N.ext` target. It never truncates, copies, uploads, or writes Firestore.

The configured local production credentials returned Firestore `UNAUTHENTICATED` during the read-only run, so the current production counts are not proven. No data was changed. Public-only records remain intentionally blocked by canonical manifest delivery until an approved migration copies the media, verifies the protected object, and atomically records its namespaced `storagePath`.

## Remaining gates before Phase 5F

1. Repair read-only production Firestore credentials and capture the inventory report.
2. Review and approve a media-copy migration procedure; do not mutate product records before object verification.
3. Deploy the approved dashboard commit and plugin 6.0.7 release candidate.
4. Demonstrate paid and promotion playback on an authorized author WordPress origin.
5. Confirm complete multi-chapter audio/video manifests and signed protected URLs.
6. Only then consider Phase 5F legacy retirement.
