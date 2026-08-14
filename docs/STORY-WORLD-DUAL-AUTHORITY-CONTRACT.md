# Story World Dual-Authority Contract

## Status

Platform standard for new Story World generation. Business Brand generation is unchanged.

## Authority hierarchy

1. **Canonical Reference Guide** is the persistent Story World authority and always wins.
2. **Story Brief** is immutable, Blueprint-scoped authority. It may introduce facts where the Canonical Reference Guide is silent, but it may not override or contradict global canon.
3. **Custom Directives** are generation instructions only. They are never evidence that a factual claim is true.

## Blueprint versioning

- Schema-version 1 Story World Blueprints remain `canonical_only`.
- Schema-version 2 Story World Blueprints explicitly select `canonical_only` or `canonical_plus_story_brief`.
- A schema-version 2 Blueprint using a Story Brief pins its `storyBriefId`, immutable version, and normalized-text SHA-256.
- The existing Canonical Reference Guide ID and immutable version remain pinned.
- The Blueprint does not contain raw Story Brief prose or Storage paths.

## Protected Story Brief records

Story Brief metadata is stored beneath:

`nexus_story_worlds/{universeId}/story_briefs/{storyBriefId}/versions/{version}`

Raw and normalized content are stored through the existing protected Cloud Storage boundary. Firebase browser clients cannot access the `nexus_story_worlds` hierarchy directly; the Dashboard uses authenticated server APIs.

## Validation lifecycle

Before generation, the worker verifies the exact tenant, author, Story World, Blueprint, Story Brief version, content digest, and public-safe acknowledgment. It evaluates topic support across the complete pinned Canonical Reference Guide and, when present, the complete pinned Story Brief.

- Facts supported by either authority may be used.
- A Story Brief conflict with global canon fails before generation.
- Facts supported only by Custom Directives remain unsupported.
- Facts absent from both authorities fail with author-facing guidance to add a Story Brief or intentionally update global canon.

After generation, the worker validates claims and contradictions against both pinned authorities. Unsupported claims, contradictions, invented canon, and spoiler leakage block artwork and WordPress staging. Warning-only output may continue under the existing draft-only contract.

## Non-goals

- Story Brief facts are not promoted automatically into the Canonical Reference Guide.
- No alternate datastore or public Storage representation is introduced.
- Schema-version 1 Story World behavior is not reinterpreted.
- Business Brand generation and Strategy Intelligence are not changed by this contract.
