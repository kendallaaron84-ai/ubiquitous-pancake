# KOBA-I engineering quality gates

The Dashboard release baseline is fail-closed. A production candidate is not eligible for approval unless all gates below pass against the exact candidate commit.

## Local development

- `npm run lint` runs the repository-owned Next.js 15 ESLint contract with zero warnings permitted.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run validate:commit` runs both checks and is installed as the repository pre-commit hook by `npm install`/`pnpm install`.
- Developers who bypass local hooks do not bypass CI or release acceptance.

## Release candidates

Run `npm run validate:release`. It executes lint, TypeScript, Nexus, security, business, Firebase rules, content-worker, and WordPress-gateway regressions, followed by the standard `npm run build` command. The rules gate requires Java 21 and uses the pinned Firebase CLI version from `package.json`. Release evidence must record the commit, dependency-lock hash, commands, results, and immutable package hash. `next build --no-lint`, rule downgrades, blanket exclusions, and warning baselines are not approved release paths.

Firestore and Storage rules, WordPress gateway checks, and service-specific suites remain mandatory in CI and deployment acceptance. Security-critical rules may not be disabled inline or globally without a separately reviewed, narrowly documented exception.

## CI and deployment acceptance

The `KOBA-I release gate` workflow runs on pull requests and release branches. Branch protection must require its Dashboard, rules, and WordPress gateway jobs before merge. Production deployment must use an artifact produced from a commit for which every required job passed; a later or locally modified tree is not equivalent evidence.

Any change to ESLint configuration, gate scripts, workflows, security rules, authentication, tenant isolation, billing, protected media, or publishing requires explicit review in the release record.
