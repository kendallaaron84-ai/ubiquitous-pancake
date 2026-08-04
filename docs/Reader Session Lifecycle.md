# Reader Session Lifecycle

## Purpose and lifecycle

`reader_sessions` stores opaque-token digests for central or author-site sessions. Raw tokens are returned once and never stored. Maximum lifetime is 30 days.

Sessions transition from active to revoked or expired. Logout, password reset, account disablement/deletion, and security events must revoke applicable sessions in Phase 5.

## Security

Phase 3 implements business logic only. Cookie creation is prohibited here. Phase 5 cookies must be Secure, HttpOnly, `SameSite=Lax`, use `__Host-` naming where possible, and never substitute for entitlement validation.
