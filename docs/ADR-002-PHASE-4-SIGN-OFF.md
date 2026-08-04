# ADR-002 Phase 4 Lead Engineer Sign-Off Package — Amended

## Decision status

| Gate | Status |
| --- | --- |
| IMPLEMENTED | **PASS** — repository implementation and fail-closed worker routing exist locally |
| VERIFIED | **PASS, with one repository build blocker** — direct worker, Nexus, security, TypeScript, Python, and gateway checks pass |
| DEMONSTRATED | **NOT COMPLETE** — live two-site demonstrations require deployment and production credentials |
| DEPLOYED | **NOT COMPLETE** — deployment is expressly approval-gated and was not performed |
| COMPLETE | **NO** — strategy-source ingestion, production build lint, live demonstrations, and deployment equivalence remain open |

Production approval remains withheld. This report does not claim that the six strategy books are integrated.

## Hardening implemented

- Added direct Python tests that import and execute the ADR-002 worker functions rather than relying on source-text assertions.
- Added isolated fakes/mocks for Firestore, Secret Manager, Gemini text generation, artwork generation, and WordPress requests.
- Added explicit blueprint schema/version routing:
  - ADR-002 blueprints use `schemaVersion: 1` and must declare `contentSource` as `business_brand` or `story_world`.
  - Missing or malformed `contentSource` on a version-1 blueprint fails closed with `PermanentTaskError`.
  - Legacy generation is allowed only for `schemaVersion: 0` plus `blueprintKind: legacy_content_blueprint`.
  - Unversioned, future-version, and ambiguously marked blueprints fail closed.
- Prevented malformed new tasks from reaching the title/genre-only `fetch_book_context()` legacy path.
- Preserved worker lease, retry, completed-attempt deduplication, transcription routing, image/social generation, Secret Manager credential resolution, and WordPress draft staging behavior.

## Direct worker test evidence

Command:

```text
python -m unittest discover -s services/content-engine-worker/tests -p "test_*.py"
```

Result: **17 passed, 0 failed**.

The tests directly cover:

1. Business Brand resolves without Story World context.
2. Story World requires `contentSource`, `universeId`, `referenceGuideId`, and an active version.
3. Cross-tenant knowledge chunks are rejected.
4. Restricted spoiler chunks are excluded.
5. Blueprint strategy IDs are validated and resolved.
6. Grounding failure raises `PermanentTaskError`.
7. Spoiler validation failure raises `PermanentTaskError`.
8. Failed validation prevents artwork and WordPress calls.
9. Warning validation permits draft staging and records warnings.
10. Successful Story World execution stages `status=draft`.
11. Audiobook transcription routing remains unchanged.
12. Retry accounting remains unchanged.
13. Completed-attempt deduplication remains unchanged.
14. `build_grounded_article_prompt()` includes retrieved Reference Guide facts and strategy context.
15. Active Reference Guide version mismatch fails closed.
16. Explicit legacy blueprints may use `fetch_book_context()`.
17. Malformed ADR-002 blueprints cannot use `fetch_book_context()`.

## Required verification results

| Check | Result |
| --- | --- |
| Direct Python worker tests | **PASS — 17/17** |
| Nexus tests | **PASS — 7/7** |
| Security regression suite | **PASS — 74/74** |
| TypeScript `tsc --noEmit` | **PASS** |
| Python worker/test compilation | **PASS** |
| WordPress gateway `node --check` | **PASS** |
| Next.js optimized compilation | **PASS** |
| Next.js production build | **FAIL — repository-wide ESLint gate** |

The production build reached `Compiled successfully` and then failed during lint enforcement. The errors are distributed across pre-existing auth, checkout, reader, generic UI, and documentation files (for example `no-explicit-any`, `no-require-imports`, unescaped JSX entities, and React hook purity rules). Correcting that repository-wide lint debt is outside ADR-002 verification scope. No unrelated files were modified to conceal the failure. TypeScript validation passes independently.

## Strategy-library status

**Authoritative source ingestion is incomplete.**

The worker currently uses a fixed in-code strategy catalog and summaries. No approved source files for the six strategy books were present, and no source content was fabricated. Therefore:

- strategy ID validation and deterministic selection are implemented and tested;
- authoritative strategy-guide ingestion/version evidence is absent;
- production approval remains withheld.

The acceptable closeout is to ingest and version owner-approved strategy source files in a later approved change, or amend ADR-002 with an approved strategy-summary contract.

## Live demonstration status

No deployment or live production mutation was authorized in this verification pass.

| Required demonstration | Status |
| --- | --- |
| Business Brand → `audio.koba-i.com` | **Pending** |
| Story World → `duncanhunter.koba-i.com` | **Pending** |
| Story World blueprint fields and active guide version observed | **Pending** |
| Reference-Guide-only fact appears in draft | **Pending** |
| Protected spoiler absent | **Pending** |
| WordPress status confirmed as draft | **Pending** |
| Returned edit URL bound to selected origin | **Pending** |

These demonstrations must run only after review and explicit deployment approval.

## Deployment-equivalence status

No deployment was performed. Consequently, the following evidence is intentionally not yet available:

| Evidence | Value |
| --- | --- |
| Approved deployed source commit | **Not assigned** |
| Deployed source SHA-256 | **Not recorded** |
| Cloud Run/Function revision | **Not created** |
| Deployment timestamp | **Not applicable** |

After approval, the deployment procedure must record the approved Git commit, calculate the SHA-256 of `services/content-engine-worker/main.py`, deploy that exact source, record the resulting revision/timestamp, and compare the deployed artifact digest/source with the approved file before marking DEPLOYED.

## Preserved security and behavior

- Cloud Tasks signature and queue validation remain unchanged.
- Worker leases, retries, terminal failure handling, and idempotent completed attempts remain intact.
- Destination origin and Secret Manager credential references remain server-bound.
- Failed grounding or spoiler validation stops execution before artwork and WordPress staging.
- Warning-only validation can stage a WordPress draft and records the warning state.
- WordPress staging remains draft-only.
- Featured-image and social-copy generation remain on the successful article path.
- Audiobook transcription remains routed through the existing transcription handler.
- Reader Platform and active SMS behavior were not changed.

## Remaining blockers

1. Provide and approve authoritative strategy-guide source files, then ingest/version them, or formally approve the current summaries as the contract.
2. Resolve or explicitly waive the repository-wide ESLint production-build gate without hiding errors.
3. Review the hardening commit and approve a deployment candidate.
4. Deploy the exact approved worker source and record commit/digest/revision equivalence.
5. Execute and retain evidence for both required live WordPress demonstrations.
6. Export, audit, emulator-test, and approve the authoritative Firestore rules before related infrastructure changes.

## Approval recommendation

Approve the hardening changes for code review. **Do not approve production deployment or label Phase 4 COMPLETE yet.**
