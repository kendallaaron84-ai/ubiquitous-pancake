# Phase 5A — Reader Identity

## Status

Implemented as an isolated reader-authentication boundary. Phase 5B purchase claiming and later Phase 5 slices are not implemented by this change.

## Canonical flow in this slice

```text
Firebase email/password authentication
  -> verified Firebase ID token
  -> POST /api/reader/session
  -> Firebase Admin token verification
  -> canonical reader_profiles upsert
  -> canonical reader_sessions creation
  -> opaque HttpOnly reader-session cookie
```

Reader authentication is deliberately separate from `/api/login`, the author dashboard session, author StudioKeys, and author feature entitlements.

## Routes and pages

- `/reader/signup` creates a Firebase email/password account and sends Firebase email verification.
- `/reader/signin` exchanges a verified password-provider Firebase ID token for a canonical reader session.
- `/reader/recover` uses Firebase password recovery. It does not reveal whether an account exists.
- `/reader/account` demonstrates that the server session can be validated without exposing its token to JavaScript.
- `POST /api/reader/session` creates the canonical session.
- `GET /api/reader/session` validates the opaque cookie and active verified reader profile.
- `POST /api/reader/logout` revokes the stored session and expires the browser cookie.

## Security properties

- No SMS or phone identity is accepted.
- No Google or other federated provider is accepted by the reader boundary.
- Firebase Admin, not browser claims, verifies the ID token.
- Email verification is required before profile/session persistence.
- Disabled and deleted reader profiles fail closed.
- Session tokens are random and only SHA-256 digests are stored in Firestore.
- Sessions expire no later than 30 days.
- Cookies are HttpOnly, SameSite=Lax, and Secure in production.
- Reader and author dashboard cookies have different names and validation paths.
- Tokens, private keys, cookie values, and complete environment values are not logged.

## Required environment

Client Firebase variables retain the existing `NEXT_PUBLIC_FIREBASE_*` convention. Server Firebase Admin retains `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. No new identity provider or duplicate configuration convention was introduced.

## Remaining risks and deferred work

- Purchase claiming is Phase 5B; a reader session currently creates no entitlement.
- The Bookshelf is Phase 5C; `/reader/account` is only a session-boundary demonstration.
- Password recovery is initiated by Firebase client APIs. Revoke-all-sessions on a completed password reset needs a trusted Firebase account-event boundary and remains pending.
- The deployed Firestore rules are not versioned in this repository and must be exported/audited before production approval.
- Cross-domain WordPress session exchange is Phase 5E and is not implemented here.
- Existing SMS routes remain unchanged but are not used by the new reader pages.

## Validation

The Phase 5A tests cover verified password identity, unverified email, non-password provider rejection, disabled accounts, opaque session validation, tamper rejection, reader/author cookie separation, 30-day maximum, expiration, and logout revocation.
