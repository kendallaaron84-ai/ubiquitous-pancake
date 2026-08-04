# ADR-002 Phase 4 Operations

## Deployment hold

These changes are review-only. Do not deploy the dashboard, worker, gateway, Firestore indexes, or Firestore rules until the Phase 4 commits and the Lead Engineer Sign-Off Package are approved.

## Feature flags

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXUS_MULTI_SITE_ENABLED` | `false` | Enables selection and management of a second active WordPress website. |
| `NEXUS_STORY_WORLD_ENABLED` | `false` | Enables Story World as a new generation source. |
| `NEXUS_REFERENCE_GUIDE_ENABLED` | `false` | Enables Reference Guide ingestion and selection. |
| `NEXUS_STRATEGY_SELECTOR_ENABLED` | `true` | Enables automatic or manual strategy selection. |
| `NEXUS_GROUNDING_VALIDATION_ENABLED` | `false` | Enforces grounded-output validation before staging. |

Rollback turns the applicable flag off and leaves guides, chunks, blueprints, and existing WordPress drafts intact. Technical content may remain readable on historical blueprints but is not selectable for new generation.

## Firestore indexes

`firestore.indexes.json` declares the Nexus composite indexes used by Story World tenancy/status lookup and Reference Guide de-duplication. Their presence in this repository does not prove that they are deployed. Deployment is a separately approved infrastructure action.

## Firestore rules evidence gate

The authoritative production Firestore rules are not present in this repository, and neither `gcloud` nor the Firebase CLI is available in this clone environment. ADR-002 explicitly prohibits treating invented rules as authoritative.

Before production deployment, an authorized operator must:

1. Export the deployed rules from `author-jubilee-command-center` without changing them.
2. Commit that exact export separately as the production baseline.
3. Compare the baseline against the Nexus collections and document every proposed rule change.
4. Verify author/studio isolation, Reference Guide and chunk isolation, platform-owned strategy access, protected secret references, author-scoped blueprints, and Admin-only worker access.
5. Run the rule suite with the Firebase Emulator Suite.
6. Review and approve the rule/index deployment separately.

Until that sequence is complete, the Firestore-rules acceptance criterion remains blocked and Phase 4 must not be approved for production.

## Known integration evidence still required

- Staging a Business Brand draft to `audio.koba-i.com`.
- Staging a Story World draft to `duncanhunter.koba-i.com`.
- Confirming both edit URLs and draft-only status.
- Confirming Reference Guide influence, recorded chunk IDs, and recorded strategy selection.
- Exercising the deployed worker and gateway with production-like Cloud Tasks authentication.
- Confirming featured image, social copy, and audiobook transcription regression behavior.
