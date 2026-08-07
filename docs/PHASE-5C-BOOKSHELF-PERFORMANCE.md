# Phase 5C Reader Bookshelf Performance Hardening

## Outcome

The Reader Bookshelf no longer performs one Firestore product lookup per
entitled publication. Product metadata is loaded through one Firestore
`getAll` multi-document request for every non-empty Bookshelf. An empty
Bookshelf performs no product metadata request.

## Measurement Method

Command:

```powershell
node scripts/benchmark-reader-bookshelf.mjs
```

The benchmark executes the real server-side session, entitlement, metadata
projection, publication filtering, and sorting services against an instrumented
Firestore-compatible test database. Controlled latency is applied to each
Firestore operation so cold and warm results are reproducible and network
roundtrip growth is visible.

- Cold profile: document read 40 ms, document write 35 ms, query 50 ms,
  multi-get 60 ms.
- Warm profile: document read 10 ms, document write 8 ms, query 14 ms,
  multi-get 18 ms.
- Cold values are one cold sample.
- Warm values are averages of five independent samples.
- Total server render is server session validation, Bookshelf data loading,
  safe projection, filtering, sorting, and page-prop preparation. It excludes
  response transfer and browser hydration.

These are controlled application/service measurements, not claims about a
deployed Vercel region or production Firestore. A deployed trace should be
collected after deployment approval.

## Results

All values are milliseconds.

| Request | Publications | Session validation | Entitlement query | Product metadata join | Total server render | Metadata RPCs |
|---|---:|---:|---:|---:|---:|---:|
| Cold | 0 | 145.53 | 109.42 | 0.00 | 255.22 | 0 |
| Cold | 1 | 140.54 | 109.34 | 63.52 | 313.49 | 1 |
| Cold | 10 | 139.04 | 108.31 | 85.60 | 333.02 | 1 |
| Cold | 25 | 148.04 | 110.40 | 64.15 | 322.71 | 1 |
| Cold | 50 | 145.51 | 105.71 | 61.27 | 312.60 | 1 |
| Warm | 0 | 47.47 | 31.43 | 0.00 | 79.00 | 0 |
| Warm | 1 | 46.58 | 31.78 | 31.24 | 109.64 | 1 |
| Warm | 10 | 46.90 | 31.47 | 32.17 | 110.59 | 1 |
| Warm | 25 | 46.88 | 31.52 | 30.95 | 109.41 | 1 |
| Warm | 50 | 46.09 | 31.46 | 31.93 | 109.55 | 1 |

## Roundtrip Analysis

The authenticated non-empty request has a fixed Firestore network shape:

1. Read and validate the reader session.
2. Update session `lastValidatedAt`.
3. Read and validate the reader profile.
4. Revalidate the reader profile at the entitlement service boundary.
5. Query active entitlements by exact Firebase UID and active status.
6. Batch-read all entitled product metadata in one `getAll` request.

Library size changes the number of documents returned by step 6, but does not
add product metadata roundtrips. The empty path omits step 6.

The 50-publication direct test also asserts:

- one metadata batch call;
- 50 documents in that batch;
- no product `doc(...).get()` calls;
- one active-entitlement query;
- the expected 50 safe publication projections.

## Target Assessment

- Sub-second controlled cold request: **PASS** (worst observed 333.02 ms).
- Sub-second controlled warm request: **PASS** (worst observed 110.59 ms).
- Empty Bookshelf: **PASS** (no metadata RPC).
- No linear metadata network-roundtrip degradation through 50 books: **PASS**.
- Live production regional latency: **PENDING DEPLOYMENT APPROVAL**.

## Scope Preserved

This hardening changes no Phase 5A identity contract, Phase 5B purchase/claim
contract, entitlement schema, media authorization, player behavior, or
WordPress plugin integration.
