# KOBA-I access and deployment audit — 2026-10-08

This is a point-in-time audit record. It does not authorize a deployment or production-data change.

## Repository exposure audit

The complete reachable Dashboard repository history contained 181 commits at the time of inspection.

- No tracked `.env`, PEM/key, PKCS, credential JSON, service-account JSON, or conventional secrets file was found in reachable history.
- No recognizable live AWS access key, Google API key, Stripe secret/restricted key, GitHub token, Slack token, credential-bearing database URI, or credential-bearing HTTP URI was detected by the targeted history scan.
- Private-key marker matches were inspected. They were Firebase private-key normalization code and deliberately truncated/test placeholder material, not a usable private key.
- Generic secret-assignment matches were inspected. They were explicit unit-test and benchmark placeholder values.
- This targeted scan is evidence, not a guarantee against every possible proprietary token format. A dedicated secret-scanning required check should remain part of the final CI gate.

## Vercel deployment isolation

The authenticated Vercel project is `koba-i/bug-free-robot`, connected to `kendallaaron84-ai/ubiquitous-pancake` and serving `dashboard.koba-i.com`.

- Production branch tracking is exactly `feature/content-engine-rehearsal`.
- Every commit to that branch creates a Production Deployment.
- Automatic assignment of production domains is enabled.
- `codex/governance-release-gate` is not the production branch and cannot become a Production Deployment through production branch tracking.
- No Vercel deploy hooks exist.
- A governance-branch push may still create a Preview Deployment; preview creation is not production promotion.

## GitHub access state

- The Dashboard repository was public at the time of inspection.
- The connected Codex GitHub session authenticates as repository owner `kendallaaron84-ai`, not as a demonstrably read-only reviewer identity.
- The connector reports no manageable GitHub App installations and cannot inspect collaborator permissions with its current integration permission.
- ChatGPT's local app policy permits GitHub actions, but this does not establish the GitHub OAuth/App repository scope. Installed-repository discovery returned no repository, and private-repository access remains unverified.
- Gemma/AntiG uses Antigravity against the workstation's authorized local checkouts. Authenticated remote fetches succeeded for both repositories, and the exact required Dashboard and plugin commit objects are present locally. It requires no GitHub account, App installation, password, or token.
- Private access remains unverified only for ChatGPT, so the Dashboard repository must remain public until that integration reads the repository after privacy is restored and the same pinned commits are reverified.

## Governance-branch publication state

- Dashboard `codex/governance-release-gate` was pushed at `5411b21f34c7d0ccf1622fb7968efba8fd70adc7` after Vercel production isolation was verified.
- Plugin `codex/governance-release-gate` was not pushed.
- No production branch, release, updater manifest, or production deployment was changed.

## First remote CI result

GitHub Actions run `37791826435` executed the Dashboard `KOBA-I release gate` from commit `5411b21...` and correctly returned **failure**:

- Dashboard build and regression: failed.
- Firestore tenant-isolation rules: failed.
- WordPress gateway: passed.
- Overall workflow: failed; no artifacts were published.

Authenticated job logs established two independent failures. The Dashboard security suite passed 269 of 270 tests and rejected a direct `firebase/storage` import in `app/dashboard/workbench/[assetId]/page.tsx`, violating the server-owned Studio API boundary. The Firestore job never executed a rules assertion because the root `firebase.json` caused Firebase CLI to validate framework-aware Hosting while running a Firestore-only emulator command; `webframeworks` was not enabled. The WordPress gateway job passed. This failed run must not be configured as a passing required check.

## Manual actions required from Kendall

1. Sign in to GitHub in the controlled browser session, or reauthorize the existing ChatGPT GitHub integration, so its selected-repository/private-repository scope can be inspected.
2. Grant the ChatGPT integration only the read access required for repository contents, metadata, pull requests, Actions and checks. Do not create a GitHub identity or credential for Gemma/AntiG.
3. After ChatGPT private access is configured, restore the Dashboard repository to private and immediately test the integration against the pinned production and review commits, a source file and workflow run. Keep the repository public if that test cannot be completed.

The Release Gate remains **not enforced** until branch/ruleset protections, required checks, independent review, staging evidence, and founder-controlled promotion are demonstrably active.
