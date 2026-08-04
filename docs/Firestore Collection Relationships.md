# Firestore Collection Relationships

| Collection | ID strategy | Relationship | Writer |
|---|---|---|---|
| `reader_profiles` | Firebase UID | principal for sessions/entitlements | profile service |
| `reader_purchases` | hash(account + checkout session) | header for line items/claim | Stripe service |
| `reader_purchase_items` | hash(purchase + line + tenant + asset) | one paid asset | Stripe service |
| `pending_purchase_claims` | hash(purchase) | purchase-to-UID bridge | purchase/claim services |
| `reader_entitlements` | hash(UID + tenant + asset + line) | canonical authorization | claim/entitlement services |
| `reader_sessions` | hash(UID + token digest) | temporary authentication session | session service |
| `legacy_reader_migrations` | hash(legacy entitlement) | immutable migration evidence | migration service |
| `reader_audit_events` | hash(type + subject + correlation + idempotency) | append-only history | audit service |

## Rules and indexes

All collections must deny direct client writes. Financial, claim, entitlement, migration, session, and audit reads/writes are server-only until deployed rules are exported and audited. Required compound indexes live in `firestore.indexes.json`; rules are not currently represented in this repository and must be exported before Phase 4.
