# Entitlement Lifecycle

## Purpose

`reader_entitlements` is the only canonical asset authorization record.

## Lifecycle

Allowed transitions are `active → suspended|revoked|refunded` and `suspended → active|revoked|refunded`. Revoked and refunded records are terminal. Promotion entitlements are deterministic per UID, tenant, and asset.

## Security

Authorization requires an exact active match on Firebase UID, tenant ID, and asset ID. Session validity never replaces this check. Unrelated assets are never affected by an item-scoped financial event.

## Extension points

`manual_grant` is reserved only. Gifts, delegated access, and family grants are not implemented.
