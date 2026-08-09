# Author first login and onboarding queue

## First-login contract

1. An owner provisions an author with immediate or deferred welcome delivery.
2. A delivery claim writes `welcomeEmailStatus=sending`, a five-minute lease, and a hashed invitation token to the existing `plugin_license_provisions/{provisionId}` record.
3. The email carries only an opaque `/setup-password?invite=...` link. The raw token is never stored.
4. The invitation expires after 72 hours and can be consumed once.
5. The invitation API resolves author email/name and validates exact ownership against `plugin_licenses/{studioKey}`.
6. The author creates only a password. No phone number is collected.
7. Firebase Admin creates or updates the email/password identity. Firestore atomically records `authConfigured=true`, `accountEstablishedAt`, and the Firebase UID on the provision, plugin license, and user profile.
8. A Firebase custom token is exchanged through the existing `/api/login` boundary, which issues the existing HTTP-only dashboard session.
9. Later access uses the normal `/signin` email/password flow.

The retired unsigned `/api/auth/activate` boundary returns `410 AUTHOR_ACTIVATION_REPLACED`.

## Welcome delivery lifecycle

`pending|deferred|failed -> sending -> sent|failed`

- `sent` is terminal for the existing send action and does not send twice.
- An active five-minute `sending` lease blocks concurrent delivery.
- An expired lease or `failed` delivery can be retried with the same provision/idempotency identity.
- The SMTP Message-ID is deterministic for the provision.
- Success updates to the provision and plugin license are committed as one Firestore batch.
- The unavoidable SMTP-accepted/database-unavailable case remains observable through the deterministic Message-ID and delivery claim; no second messaging system is introduced.

## Owner queue

`GET /api/admin/authors` is owner-only and reloads existing durable records from:

- `plugin_license_provisions`
- `plugin_licenses`
- `users`
- `connections/{studioKey}` and `connections/{studioKey}/websites`

It never returns Secret Manager references, WordPress usernames/passwords, or full StudioKeys. The queue groups authors as Needs setup, Welcome deferred, Welcome failed, Welcome sent / awaiting account, or Active. Deferred and failed rows invoke the existing idempotent provisioning endpoint for send/retry.

## Deployment note

Do not send a deferred customer welcome during deployment validation. Use mocked mail transport tests or a non-customer fixture. Existing deferred records require no migration; invitation fields are added only when delivery is explicitly requested.
