# Story World Authoring Security Gate

## Candidate boundary

Story World and Reference Guide authoring continues to use the existing Nexus records, immutable guide versions, private Firebase Storage objects, blueprints, worker, and WordPress draft pipeline. The Dashboard derives `studioKey`, `authorId`, and author email from the authenticated Dashboard session and active `plugin_licenses/{studioKey}` ownership. Browser input cannot choose or change those ownership fields.

The only MVP management routes added by this slice are:

- `/api/nexus/story-worlds`
- `/api/nexus/reference-guides`

Both retain `requireNexusAuthorContext()`, active license-email ownership, and Nexus/Content Engine entitlement checks. Unrelated MVP APIs remain unavailable.

## Production hold

Do not enable `NEXUS_STORY_WORLD_ENABLED` or `NEXUS_REFERENCE_GUIDE_ENABLED` for production author editing until an authorized operator exports the currently deployed Firestore rules from `author-jubilee-command-center` and audits them against this candidate.

The audit must prove that browser Firebase access cannot read or write:

- another StudioKey's `nexus_story_worlds` records;
- another author's nested `reference_guides`, `versions`, chunks, upload requests, or audit events;
- private Reference Guide Storage objects;
- authoritative ownership fields on Story Worlds or guides;
- `content_blueprints` outside the authenticated author's tenant.

The deployed rules are not versioned in this repository. Passing server-route tests does not replace the rules export, emulator test, review, and separately approved deployment gate.

## Canonical canon rule

`nexus_story_worlds/{universeId}.defaultReferenceGuideId` is the authoritative Canonical Guide. Dashboard knowledge resolution, blueprint creation, and worker execution all reject an alternate ready guide. Blueprints retain the exact selected version, and the worker fails closed if the canonical guide or current version changes after queueing.
