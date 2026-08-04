# Reader Lifecycle

## Purpose and lifecycle

A verified Firebase account creates or updates `reader_profiles/{uid}`. Status is `active`, `disabled`, or `deleted`. Entitlements remain attached to UID when email changes.

## Relationships

The profile owns sessions and entitlements by UID. Purchases remain immutable financial evidence and are connected to the UID only through a completed pending claim.

## Security

Claims and promotion entitlements require a verified email and active profile. Disablement or deletion revokes sessions. Account deletion anonymizes optional presentation data while preserving financial and audit evidence.

## Extension points

Firebase sign-up, verification, recovery, and account-management UI are later phases.
