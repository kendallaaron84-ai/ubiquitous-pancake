# Phase 5E — Anonymous Free-Publication Turnstile Pass

## Scope

This repair adds a minimal anonymous path for publications that the server
proves are free, published, enabled, and deployed. Paid and owned media paths,
Firebase reader identity, promotion entitlements, SMS compatibility, and the
existing player manifest contract are unchanged.

## Flow

```text
WordPress free-publication action
  -> dashboard /reader/free?assetId=...
  -> Cloudflare Turnstile managed challenge
  -> POST /api/reader/media/free-handoff
  -> server-side Siteverify (hostname + action + asset cData)
  -> five-minute, one-use reader_free_handoffs record
  -> existing WordPress #koba_reader_handoff fragment
  -> existing /api/reader/media/handoff/exchange
  -> 72-hour maximum anonymous_free token (tenant + asset + origin)
  -> existing bearer /api/media/manifest
  -> protected signed chapter URLs
```

No account, email, phone, SMS, IP database, permanent entitlement, or public
media URL is created. The anonymous token is held in `sessionStorage`; closing
the browser tab can end access earlier than the 72-hour server maximum.

## Required configuration

Create one Cloudflare Turnstile Managed widget for `dashboard.koba-i.com` and
configure these Vercel server/client variables without committing their values:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_EXPECTED_HOSTNAME=dashboard.koba-i.com`

The server does not accept browser-provided tenant, origin, principal, status,
or entitlement fields. It does not send an IP address to Siteverify.

## Security invariants

- Siteverify runs before the product lookup or handoff creation.
- Siteverify success must match hostname `TURNSTILE_EXPECTED_HOSTNAME`, action
  `free_publication`, and `cdata` equal to the requested asset ID.
- The product is revalidated before handoff creation, after handoff exchange,
  and for every protected manifest request.
- The handoff is single-use and expires after five minutes.
- The media token expires after at most 72 hours and is bound to one tenant,
  one asset, and one exact HTTPS WordPress origin.
- A free token cannot authorize paid, disabled, unpublished, undeployed,
  cross-tenant, cross-asset, or cross-origin media.
- Signed chapter URLs retain the existing one-hour maximum.
- Canonical handoff failures remain canonical and do not silently fall through
  to SMS. Direct legacy URLs remain available until Phase 5F.

## Phase 5A session audit

The proposed “stay signed in until logout/revocation/security event” change is
deferred. The fixed 30-day reader-session maximum crosses more than three
production boundaries: session creation/validation, cookie lifetime, the
canonical session contract, and the reader-session API response. Reader auth
also propagates the expiry and tests enforce it. Removing the expiry would
change the approved session contract and require broader regression and
lifecycle work. No Phase 5A session file was changed by this repair.

Purchased entitlements are separate durable records. Session expiration does
not expire, refund, suspend, revoke, move, or delete an entitlement.

## Rollback

1. Revert the dashboard Turnstile commit and redeploy the prior dashboard.
2. Reinstall plugin 6.0.8 if plugin 6.0.9 has been released.
3. Leave `reader_free_handoffs` records to expire; they cannot authenticate as
   Phase 5A sessions and are unusable after five minutes or consumption.
4. Existing paid/Firebase and legacy playback continue on their prior paths.

Do not remove environment values until the previous dashboard revision is
serving, so in-flight challenge pages fail cleanly during rollback.
