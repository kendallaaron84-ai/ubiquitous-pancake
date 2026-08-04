# Purchase Lifecycle

## Purpose and lifecycle

`reader_purchases` stores one Stripe-backed header. `reader_purchase_items` stores one asset per paid line. IDs are deterministic from Stripe account/session and line/tenant/asset evidence.

Paid webhook events create a pending claim. Duplicate events replay safely; older Stripe events cannot overwrite newer state. A mismatched verified email blocks the claim for manual review rather than transferring ownership.

## Refunds and disputes

Full asset refund marks its item and entitlement refunded. Partial asset refund revokes it. Open disputes suspend; a win restores an otherwise eligible entitlement; a loss revokes. Ambiguous multi-line allocations are not automated.

## Security and extension points

Browser success pages are not payment authority. Gift transfer and manual/cash workflows are deferred.
