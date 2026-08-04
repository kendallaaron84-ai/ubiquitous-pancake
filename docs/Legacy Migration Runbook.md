# Legacy Migration Runbook

## Scope

Phase 3 classifies and records migration evidence only. It does not run a production migration or delete legacy fields.

## Evidence retained

Legacy entitlement ID, normalized phone principal, reader access key, reader JWT subject, network hash, migration status, and claimed Firebase UID are retained as read-only evidence after claim.

## Procedure

1. Export and back up legacy and canonical collections.
2. Classify active records with tenant, asset, and legacy principal evidence.
3. Reject ambiguous records for review.
4. In a later approved phase, claim to one verified UID transactionally.
5. Audit every claim or rollback.

## Rollback

Mark the migration `rolled_back`, revoke only the canonical migration entitlement, and leave original legacy evidence unchanged. Never delete Stripe evidence.
