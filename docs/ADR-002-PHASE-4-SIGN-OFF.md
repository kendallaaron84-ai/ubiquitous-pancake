# ADR-002 Phase 4 Lead Engineer Sign-Off Package — Full-Context Grounding Amendment

## Decision status

| Gate | Status |
| --- | --- |
| IMPLEMENTED | **PASS** — the approved full-context adjustment and Firebase configuration repair exist in the local review clone |
| VERIFIED | **PASS, with one repository build blocker** — worker, Nexus, security, TypeScript, Python, gateway, and optimized compilation checks pass |
| DEMONSTRATED | **NOT COMPLETE** — live UI and two-site demonstrations require approved deployment configuration |
| DEPLOYED | **NOT COMPLETE** — no push or deployment was authorized or performed |
| COMPLETE | **NO** — the repository-wide lint gate, live demonstrations, deployment equivalence, and strategy-source ingestion remain open |

Production approval remains withheld. This report does not claim vector retrieval or authoritative strategy-book ingestion.

## Controlled implementation scope

The implementation is additive to commit `9767d0ea9083b1b2243458dfa5e4cd61dca820eb` and preserves ADR-002 Version 1.0.

### Reference Guide intake and contract

- New Story World Reference Guides require an explicit author acknowledgement that the guide contains only public-facing information the engine may discuss.
- Normalized guide content is rejected when it exceeds either hard limit:
  - 5,000 normalized words; or
  - 30,000 normalized characters.
- Content is never silently truncated.
- The 5 MB upload ceiling is intentional: PDF and DOCX containers may be larger than their extracted prose. The route bounds the raw upload before parsing, independently validates normalized extracted text against both hard limits, rejects oversized output, and performs no truncation.
- Active guide/version records retain normalized word and character counts, the content-policy version, acknowledgement evidence, source digest, and Storage reference.
- Chunks remain as bounded traceability records. They are not used as the authoritative generation context and are not described as vector retrieval.

### Worker reasoning path

- Business Brand generation loads no Story World Reference Guide.
- New Story World generation requires `schemaVersion: 1`, `contentSource: story_world`, `knowledgeMode: full_reference_guide`, the tenant-bound universe and guide IDs, and the exact active acknowledged guide version.
- The worker retrieves the complete normalized active Reference Guide from its server-controlled Storage reference and independently rechecks both hard limits without truncating.
- Before generation, `assess_story_world_topic_support()` performs a structured support assessment against the complete guide. It is instructed to reason over direct facts, synonyms, implied relationships, thematic similarity, and indirect references.
- Unsupported or low-confidence topics fail with `NEXUS_INSUFFICIENT_GROUNDING` and author-facing remediation guidance.
- The generation prompt includes the complete Reference Guide, grounding assessment, selected catalog strategy summary, goal, topic, audience, keywords, and spoiler guardrails.
- After generation, `validate_article_against_full_context()` checks the complete draft against the complete guide. Invented canon, contradictions, or spoiler leakage raise `PermanentTaskError` before artwork generation or WordPress staging.
- Warning-only validation may continue to draft staging and persists warning metadata.
- WordPress staging remains `status=draft`.

### Strategy terminology

- The in-code object is named `NexusStrategyCatalogEntry`.
- `NexusStrategyGuide` is reserved for future ingested and versioned authoritative strategy sources.
- No strategy-book source content was fabricated.

### Firebase sign-in configuration repair

- Firebase browser configuration is validated before `initializeApp()` or `getAuth()` runs.
- Missing, placeholder, or malformed `NEXT_PUBLIC_FIREBASE_*` values now produce an actionable configuration error instead of the opaque `auth/invalid-api-key` failure.
- The repair does not add defaults, expose server credentials, or commit secrets.
- `.env.local` remains ignored. Production and preview Firebase values remain deployment-environment responsibilities.

## Direct worker verification

Command:

```text
python -m unittest discover -s services/content-engine-worker/tests -p "test_*.py"
```

Result: **25 passed, 0 failed**.

The direct Python tests import and execute the worker paths with mocked Firestore, Secret Manager, Gemini generation, artwork generation, and WordPress requests. Coverage includes:

1. Business Brand routing without Story World context.
2. Required Story World source, universe, guide, active version, acknowledgement, and full-context mode.
3. Cross-tenant guide/chunk rejection.
4. Restricted spoiler trace chunks excluded from eligible trace IDs.
5. Strategy ID validation and strategy-context construction.
6. Full-context prompt construction.
7. Synonym topic support.
8. Implied-relationship topic support.
9. Thematic-similarity topic support.
10. Indirect-reference topic support.
11. Unsupported-topic failure with `NEXUS_INSUFFICIENT_GROUNDING`.
12. Low-confidence failure with `NEXUS_INSUFFICIENT_GROUNDING`.
13. Invented-canon blocking.
14. Contradiction blocking.
15. Spoiler-leakage blocking.
16. Failed pre-generation assessment prevents generation, artwork, and WordPress calls.
17. Failed post-generation validation prevents artwork and WordPress calls.
18. Warning-only validation stages a draft and records warnings.
19. Successful Story World execution stages `status=draft`.
20. Explicit version-0 legacy compatibility remains available.
21. Malformed new tasks cannot reach `fetch_book_context()`.
22. Audiobook transcription routing remains unchanged.
23. Retry accounting and completed-attempt deduplication remain unchanged.
24. Public-safe acknowledgement is enforced by the worker.
25. Oversized stored content fails without truncation.

## Verification results

| Check | Result |
| --- | --- |
| Direct Python worker tests | **PASS — 25/25** |
| Nexus contract tests | **PASS — 9/9** |
| Security regression suite | **PASS — 74/74** |
| TypeScript `tsc --noEmit` | **PASS** |
| Python worker compilation | **PASS** |
| WordPress gateway `node --check` | **PASS** |
| Git whitespace check | **PASS** |
| Next.js optimized compilation | **PASS — compiled successfully in 117 seconds** |
| Next.js production build | **FAIL — repository-wide ESLint gate** |

The optimized application compilation succeeds. The build then fails during the repository-wide ESLint gate on existing debt spread across auth, checkout, reader, product, generic UI, documentation, and other files (`no-explicit-any`, `no-require-imports`, unescaped JSX entities, hook-effect purity, and related rules). Independent TypeScript validation passes. Resolving that broad lint backlog would expand this adjustment beyond ADR-002, so no unrelated lint suppressions or rewrites were introduced.

## Preserved controls and behavior

- Cloud Tasks signing and queue validation are unchanged.
- Worker leases, retries, terminal failure handling, and completed-attempt idempotency remain intact.
- Destination origin binding and Secret Manager credential resolution remain server-controlled.
- Featured-image and social-copy generation remain on the successful article path.
- Failure validation blocks artwork and WordPress staging.
- WordPress output remains draft-only.
- Audiobook transcription routing is unchanged.
- Version-1 blueprints fail closed; only explicitly identified version-0 legacy blueprints may use the legacy title/genre path.
- Reader Platform and active SMS behavior were not changed.

## Documented backlog retained

The following items remain intentionally outside this adjustment:

1. Semantic embeddings and vector retrieval.
2. Asynchronous Reference Guide ingestion.
3. Connection concurrency changes.
4. Chunk-level spoiler classification.
5. Authoritative strategy-source ingestion and versioning.

## Strategy-library status

**Authoritative source ingestion remains incomplete.** The worker uses owner-visible in-code catalog summaries only. Strategy selection and ID validation are implemented and tested, but the six strategy books are not represented as ingested source material. Production approval remains withheld until approved source files are ingested/versioned or ADR-002 formally approves the catalog summaries as the production contract.

## Live demonstration status

No deployment or production mutation was authorized.

| Required demonstration | Status |
| --- | --- |
| Firebase sign-in UI with deployed production variables | **Pending** |
| Business Brand → `audio.koba-i.com` | **Pending** |
| Story World → `duncanhunter.koba-i.com` | **Pending** |
| Full-context blueprint/assessment/validation metadata observed | **Pending** |
| Reference-Guide-only facts present in draft | **Pending** |
| Protected spoilers absent | **Pending** |
| WordPress status confirmed as draft | **Pending** |
| Returned edit URL bound to selected origin | **Pending** |

## Deployment-equivalence status

No push or deployment was performed.

| Evidence | Value |
| --- | --- |
| Approved deployed source commit | **Not assigned** |
| Deployed source SHA-256 | **Not recorded** |
| Cloud Run/Function revision | **Not created** |
| Deployment timestamp | **Not applicable** |

After explicit approval, deployment must use the reviewed commit, record the SHA-256 of `services/content-engine-worker/main.py`, record the resulting revision and timestamp, and compare deployed source evidence with the approved file before marking DEPLOYED.

## Remaining approval gates

1. Review the controlled full-context grounding commit.
2. Resolve or explicitly waive the repository-wide ESLint production-build gate in a separately approved cleanup.
3. Provide and approve authoritative strategy sources, or formally approve the catalog-summary contract.
4. Approve and deploy the exact reviewed source.
5. Record commit, source digest, revision, and deployment timestamp equivalence.
6. Execute and retain both required live WordPress demonstrations and the Firebase sign-in demonstration.

## Approval recommendation

Approve this adjustment for code review. **Do not approve deployment or label Phase 4 COMPLETE yet.**
