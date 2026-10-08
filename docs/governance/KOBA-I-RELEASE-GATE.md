# KOBA-I mandatory release gate

## Rule

A production release is **NO-GO** unless every mandatory automated check passes, staging evidence is attached to the exact commits/artifacts, an independent reviewer approves those exact artifacts, and Kendall provides explicit production approval.

## Required evidence

| Gate | Evidence | Enforcement mechanism |
|---|---|---|
| Source identity | Full commit SHAs for every repository and SHA-256 for each artifact | CI artifact manifest and PR/release record |
| Functional/regression | Dashboard, Nexus, gateway, plugin and reader suites | Required GitHub Actions checks |
| Integration | Publication creation/upload/deploy, WordPress identity preservation, protected-storage resolution | Required automated tests plus staging record |
| Security/tenant isolation | Security suite and Firestore emulator rules suite | Required GitHub Actions checks; any failure blocks |
| Backward compatibility | Existing reflowable, audio/video and entitlement paths | Required plugin/dashboard regression checks |
| PHP | Lint every non-vendor PHP file on supported PHP versions | Required plugin workflow |
| Staging acceptance | Human-readable evidence mapped to acceptance criteria | `staging` GitHub Environment with required reviewer |
| Independent review | ChatGPT or Gemma reviews exact commits and artifacts without modifying the branch | Required approving PR review from designated review team |
| Founder authorization | Explicit Kendall approval after all earlier gates | `production` GitHub Environment required reviewer |

## Prepared workflows

- Dashboard monorepo: `.github/workflows/koba-release-gate.yml`
- Plugin repository: `.github/workflows/koba-release-gate.yml`

The workflows are intentionally failing gates when tests fail. The Dashboard security suite currently has one known failure for direct inline Workbench image upload, so RC1 remains NO-GO until repaired or separately reviewed and explicitly risk-accepted.

## External controls still required

Local workflow files do not prevent a Vercel or WordPress deployment by themselves. A GitHub administrator must, with founder approval:

1. Protect the actual production branch and prohibit direct pushes/force pushes/deletion.
2. Require both repository workflow checks and current branches before merge.
3. Require at least one independent reviewer; dismiss stale approvals on new commits.
4. Create `staging` and `production` GitHub Environments with Kendall as a required reviewer for production.
5. Configure Vercel production to deploy only the protected production branch after required checks.
6. Ensure Cloud Run and plugin deployment credentials are available only to environment-protected jobs.
7. Disable or constrain any alternate Firebase root deployment that could publish the monolithic Next.js runtime.

Until these settings are verified, the implementation status is **prepared but not enforced**.

## Current enforcement audit — 2026-10-08

The Release Gate is **not enforced**:

- production-related Dashboard branches and plugin `main` are unprotected;
- repository ruleset lists are empty;
- no required status checks are configured;
- the prepared workflow files exist only on local governance branches;
- Vercel's production-branch and automatic-deployment configuration has not been verified because manual two-factor authentication is required;
- no evidence yet demonstrates that an unapproved commit is technically blocked from production.

Accordingly, governance branches have not been pushed. Pushing them before deployment isolation is confirmed could create a preview or production deployment depending on the unknown Vercel Git configuration.

## Promotion sequence

1. Push review branches only after founder approval of repository-access changes.
2. Open PRs pinning exact cross-repository commit references.
3. Pass all required automated checks.
4. Build immutable artifacts and record SHA-256 values.
5. Deploy to staging through the protected staging environment.
6. Attach production-like acceptance evidence.
7. Obtain independent approval on the exact artifacts.
8. Obtain Kendall's production approval.
9. Promote without rebuilding.
10. Execute and record post-deployment smoke tests; roll back on any mandatory failure.

## Current references

- Dashboard production baseline: `a229e164d2d6b29661aee4d7ba92adc6d4790104`
- Dashboard/gateway RC1: `ab8f833e56f6aada2610fb8ce226b7e0fcdefc17`
- Plugin updater baseline: tag `v6.1.0` (`2bd29d5`)
- Plugin pilot parent: `50c49d717c2652adc1ad2240ccdef12fff89da2c`
- Plugin stabilization RC1: `d08ec56ad0fe49e02db686420c50dede1a5dfb2b`
