# ADR-002 Phase 4 Lead Engineer Sign-Off Package

## Decision status

**Implementation complete for repository review; production approval is withheld.**

The repository implementation is committed behind rollback flags. No dashboard, worker, gateway, Firestore index, or Firestore rule deployment was performed. Production approval remains blocked by the evidence gates listed below.

## Implementation report

### Implemented

- Imported the current Content Engine worker and WordPress egress gateway into `services/` as separate baseline source, with equivalence notes.
- Added canonical Nexus contracts for Business Brand and Story World. Technical content is not available for new generation.
- Extended the existing `connections/{studioKey}` model to support at most two active WordPress websites; the primary record remains compatible and an optional second site lives below `connections/{studioKey}/websites`.
- Added authenticated, author-scoped Nexus context, website, Business Profile, Story World, Reference Guide, and blueprint APIs.
- Adapted `users/{authorEmail}/profile/brand_voice` as the Business Profile rather than creating a competing profile store.
- Added PDF, DOCX, Markdown, and text Reference Guide ingestion, extraction, versioning, deduplication, private GCS storage, chunking, and author/universe-scoped retrieval.
- Added deterministic automatic strategy selection and manual selection of one primary plus at most one distinct support strategy.
- Bound each blueprint and Cloud Task to the selected website connection, exact WordPress origin, Secret Manager credential reference, content source, knowledge IDs, and strategy decision.
- Extended the worker with source-aware prompting, Story World retrieval, strategy context, safe-HTML checks, canon/spoiler/grounding validation, and validation metadata.
- Preserved direct WordPress draft staging and returned WordPress result data through the existing worker path; no separate editorial interface was added.
- Added feature flags, index declarations, operations gates, and targeted regression tests.

### Principal created files

- `services/content-engine-worker/*`
- `services/wordpress-egress-gateway/*`
- `services/BASELINE_EQUIVALENCE.md`
- `core/nexus/*`
- `app/api/nexus/*`
- `components/nexus-knowledge-panel.tsx`
- `docs/ADR-002-PHASE-4-OPERATIONS.md`

### Principal modified files

- `app/nexus-engine/page.tsx`
- `components/author-intake-form.tsx`
- `app/api/connections/verify/route.ts`
- `core/cloud-tasks.ts`
- `firestore.indexes.json`
- `package.json`
- `pnpm-lock.yaml`

### Preserved behavior

- Cloud Tasks HMAC/OIDC signature and queue checks.
- Worker leases, retry/idempotency paths, terminal states, and legacy blueprints.
- Exact destination-origin and Secret Manager credential binding.
- WordPress draft-only staging and existing-draft updates.
- Featured-image and social-copy generation.
- Audiobook transcription through the shared worker entry point.
- Existing primary WordPress connection behavior.
- Reader Platform and SMS behavior were not changed.

### Deferred or blocked

- Export, review, emulator testing, and deployment of the authoritative production Firestore rules.
- Deployment of declared Firestore indexes.
- Production-like end-to-end demonstrations against both target WordPress websites.
- A complete integration-test matrix for upload parsing, worker retries, WordPress staging, image/social output, and transcription.
- Actual vector embeddings. Current chunks record `embeddingModel: "lexical-v1"` and use deterministic lexical retrieval because ADR-002 did not identify an embedding model, vector store, or production embedding contract.
- Platform-owned source documents for the six strategy guides. The implementation has a fixed safe catalog and deterministic guidance summaries, but the authoritative guide artifacts/storage paths were not present in the repository.

### Deviations and risks

1. **Embedding gap:** Reference Guides are extracted, chunked, scoped, and retrievable, but are not vector-embedded. Calling this compliant with the embedding acceptance criterion would be inaccurate.
2. **Strategy-source gap:** Six catalog entries exist, but no authoritative strategy-guide source files were available to import or verify.
3. **Rules gap:** Adding collections before reviewing deployed rules may create denied operations or overly broad access if infrastructure is changed without the required audit.
4. **Integration gap:** Local contract/regression tests cannot prove behavior against Cloud Tasks, Secret Manager, GCS, or the two WordPress sites.
5. **Build gate:** TypeScript and targeted tests pass, but the Next.js production build stalled during optimized compilation. It did not emit `BUILD_ID`; therefore the build criterion is not passed.

## Architecture map

```text
Author input
   ↓
Authenticated Nexus API
   ↓
Blueprint (`content_blueprints/{blueprintId}`)
   ↓
Website binding (`connections/{studioKey}` or one child website)
   ↓
Content-source routing (Business Brand | Story World)
   ↓
Knowledge retrieval (brand_voice | scoped Reference Guide chunks)
   ↓
Strategy selection (one primary + optional support)
   ↓
Signed Cloud Task
   ↓
Leased Content Engine worker
   ↓
Grounded generation and validation
   ↓
Featured image and social copy
   ↓
Secret-bound WordPress egress
   ↓
WordPress draft and edit URL
```

## Data report

| Store | Purpose | Scope / identity |
| --- | --- | --- |
| `users/{authorEmail}/profile/brand_voice` | Adapted Business Profile | Authenticated author email and StudioKey context |
| `connections/{studioKey}` | Existing primary WordPress site | StudioKey |
| `connections/{studioKey}/websites/{websiteConnectionId}` | Optional second active WordPress site | StudioKey + author ID; hard maximum of two total |
| `nexus_story_worlds/{universeId}` | Story World metadata | StudioKey + author ID |
| `.../reference_guides/{referenceGuideId}` | Active guide pointer and spoiler policy | Universe + StudioKey + author ID |
| `.../versions/{version}` | Immutable extracted guide version metadata | Reference Guide version |
| `.../versions/{version}/chunks/{chunkId}` | Ordered knowledge chunks | Universe + guide version + tenant fields |
| `content_blueprints/{blueprintId}` | Input, binding, strategy, retrieval, execution and output metadata | Author + StudioKey + task attempt |

Reference Guide objects are stored privately under:

```text
nexus/{studioKey}/story-worlds/{universeId}/reference-guides/{referenceGuideId}/v{version}/source/{safeFileName}
nexus/{studioKey}/story-worlds/{universeId}/reference-guides/{referenceGuideId}/v{version}/extracted.txt
```

The active guide is replaced only after the new version reaches `ready`; failed replacements leave the prior ready version active. SHA-256 provides per-world deduplication. No destructive backfill or migration was added.

`firestore.indexes.json` declares the Story World tenancy lookup and Reference Guide deduplication indexes. They have not been deployed. No Firestore rule change was invented or deployed.

## Security report

- All Nexus routes require the existing author session and active Content Engine authorization.
- Website, Story World, guide, and blueprint access is checked against StudioKey and author identity.
- The browser cannot supply an untrusted destination or raw WordPress password to the worker. The selected stored website produces the exact origin and Secret Manager reference placed into the signed task.
- WordPress credentials remain in Secret Manager; Firestore stores references, not passwords.
- The worker re-resolves blueprint context and validates source-specific knowledge before generation.
- Story World retrieval is restricted to the selected universe, ready guide, active version, and recorded chunk IDs.
- Task signature, queue identity, lease, retry, and terminal-state code paths remain present.
- Logs record IDs and validation state, not raw credentials or uploaded source text.
- Platform strategy metadata is read-only in the UI/API. Author selection records IDs and reasons only.

The authoritative deployed Firestore rules remain an explicit security blocker until exported, stored, audited, and emulator-tested.

## Test report

| Check | Result |
| --- | --- |
| Nexus contract/regression tests | **7 passed, 0 failed** |
| Existing security regression suite | **74 passed, 0 failed** |
| TypeScript `tsc --noEmit` | **Passed** |
| WordPress gateway syntax check | **Passed** |
| Content worker Python compile check | **Passed** |
| Next.js production build | **Inconclusive / blocked** — entered optimized compilation, stalled without CPU progress, no `BUILD_ID` |
| Firestore emulator rule tests | **Not run** — authoritative rules absent |
| Live two-site integration suite | **Not run** — deployment prohibited and credentials unavailable |

Targeted tests cover content-source contracts, the two-site limit, deterministic/manual strategy selection, file limits and chunking, feature-flag defaults, and source-level regression assertions for signature, lease, origin, draft, image/social, and transcription paths. They are not a substitute for the required live integration matrix.

## Demonstration evidence

| Required demonstration | Evidence status |
| --- | --- |
| Business Brand draft staged to `audio.koba-i.com` | **Pending live test** |
| Story World draft staged to `duncanhunter.koba-i.com` | **Pending live test** |
| Reference Guide influenced Story World draft | **Pending live test**; worker records chunk IDs and validation metadata in code |
| Strategy selection recorded | **Implemented and unit-tested**; live record pending |
| Both WordPress edit URLs returned | **Pending live test** |
| Technical mode absent | **Implemented and unit-tested** |
| Audiobook transcription operational | **Code-preservation and existing regression checks passed; live regression pending** |

## Controlled commits

1. `5b3a7af6761d1200722ac0850adec145bd919813` — production service baselines
2. `cc9c095` — contracts and service foundation
3. `43638d7465cf597e69806103eff2db5971df5fb0` — protected knowledge and blueprint APIs
4. `625517fd9ac6e41a805b3f6b4d99c0ac8881aa3b` — SEO draft and knowledge workspace
5. `a9ab3866d2253b85b3625ed3b73eb34f95717a54` — source-aware grounded worker generation
6. `820111a01529339db54edec32d093b71be0bdbc6` — knowledge and website management
7. `7cc6ff104cbc5dddb3533ab43b927a8029bc3dac` — regression and operations gates

## Approval recommendation

Approve the commits for continued review, **not production deployment**. Before production approval:

1. Resolve the embedding and strategy-source contract gaps with explicit ADR-002-compatible decisions.
2. Export and commit the authoritative Firestore rules baseline, audit it, and run emulator tests.
3. Deploy indexes only after review.
4. Resolve the production build stall and obtain a clean build exit.
5. Run the required two-site, worker, gateway, image/social, and transcription integration demonstrations.
6. Exercise and record rollback-flag behavior.

