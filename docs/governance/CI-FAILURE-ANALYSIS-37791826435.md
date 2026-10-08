# GitHub Actions run 37791826435 — failure analysis

Commit: `5411b21f34c7d0ccf1622fb7968efba8fd70adc7`

Workflow: `KOBA-I release gate`

## Dashboard build and regression — FAIL

Setup, dependency installation, TypeScript compilation and Nexus tests passed. The failure occurred in `pnpm run test:security`.

The security suite completed 270 tests: 269 passed and one failed. The failing invariant was:

`Studio and Workbench clients use only the server-owned API`

`app/dashboard/workbench/[assetId]/page.tsx` imports `getStorage`, `ref`, `uploadBytesResumable` and `getDownloadURL` directly from `firebase/storage`. This violates the locked client boundary checked by `core/security/__tests__/studio-publication-access.test.mjs:232`. The build was then correctly skipped.

This is a product/security-boundary defect, not a flaky CI problem. The test must remain blocking until the illustrated-page/image upload path uses the authenticated server-owned Studio upload contract.

## Firestore tenant-isolation rules — FAIL before assertions

Java setup and dependency installation passed. The Firebase emulator command failed before starting Firestore or executing the rules tests:

`Cannot emulate a web framework because the experiment webframeworks is not enabled.`

Cause: the repository's production `firebase.json` contains root-level Next.js Hosting configuration (`"hosting": { "source": "." }`). Firebase CLI 14.18.0 validates that unrelated framework-hosting configuration even when the command requests only the Firestore emulator.

The release-gate preparation now uses `firebase.ci.json`, which contains only Firestore rules, indexes and emulator configuration. This removes the unrelated Hosting/framework boundary from the rules job without enabling an experiment, changing production Firebase configuration, or weakening any rule/test.

## WordPress gateway — PASS

Dependency installation, `pnpm check`, and `credential-reference.test.mjs` all passed.

## Enforcement conclusion

The workflow is correctly red while the Workbench bypass remains. The Firestore job configuration repair must be run remotely before the rules gate can be called valid. No failing check should be waived or omitted from branch protection.
