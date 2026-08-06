# Plugin `authorizedSites` Dry-Run Report

Date: 2026-08-06
Target StudioKey: `KOBA-AUDIO-E63DC9CA`
Mode: read-only; no Firestore mutations, migrations, pushes, or deployments were executed.

## Results

### Local development project

- Firebase project resolved from `.env.local`: `jubilee-command-center---dev`.
- `plugin_licenses/KOBA-AUDIO-E63DC9CA`: not present.
- `connections/KOBA-AUDIO-E63DC9CA`: not present.
- Proposed write count: `0`.
- Decision: `NO_LICENSE` in the development project; no migration is applicable there.

### Production project

- A read-only query was attempted using `.env.production.local`.
- Firestore rejected the locally configured credential with `UNAUTHENTICATED`.
- No production documents were read and no production writes were attempted.
- Proposed write count: `0`.
- Decision: `BLOCKED_PENDING_VALID_READ_CREDENTIAL`.

The production migration must remain unexecuted until a valid read credential is available and the dry-run output can confirm the license, authoritative ownership, verified website connections, exact normalized origins, independent credential references, and role configuration.

## Proposed migration behavior once production can be read

The included `scripts/dry-run-plugin-site-migration.mjs` tool:

1. Reads the target `plugin_licenses/{StudioKey}` document.
2. Reads the primary `connections/{StudioKey}` document and `connections/{StudioKey}/websites/*` documents.
3. Emits only sanitized ownership-presence, origin, role, verification, and credential-reference-presence data.
4. Runs the pure reconciliation function in memory.
5. Reports `NO_CHANGE`, `MIGRATION_AVAILABLE_REQUIRES_EXPLICIT_APPROVAL`, or `BLOCKED`.
6. Contains no Firestore write, batch, or transaction calls.

`associatedWebsite` is reported and preserved only as deprecated migration evidence. It is not used as the active authorization source after `authorizedSites` exists.

## Approved execution command after credentials are repaired

```powershell
$env:KOBA_DRY_RUN_ENV_FILE='.env.production.local'
node scripts/dry-run-plugin-site-migration.mjs KOBA-AUDIO-E63DC9CA
```

This command is read-only. Any future migration command requires separate explicit approval and is not included in this change group.
