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
- ChatGPT private-repository access has not been independently tested from this session.
- Gemma's exact GitHub account or GitHub App identity has not been provided and therefore cannot be granted or tested.
- Private least-privilege access is not established for all three reviewers, so repository visibility must not yet be changed.

## Governance-branch publication state

- Dashboard `codex/governance-release-gate` was pushed after Vercel production isolation was verified.
- Plugin `codex/governance-release-gate` was not pushed.
- No production branch, release, updater manifest, or production deployment was changed.

## Manual actions required from Kendall

1. Sign in to GitHub in the controlled browser session so installed GitHub Apps and repository access settings can be inspected.
2. Identify the exact ChatGPT and Gemma GitHub App installations or GitHub usernames. A name such as “ChatGPT” or “Gemma” is not sufficient to grant repository access safely.
3. If read-only access must be enforced, use selected-repository GitHub Apps with `Contents`, `Metadata`, `Pull requests`, `Checks`, and `Actions` read permissions, or an organization team with a read role. A personal-repository collaborator should not be treated as read-only without proof of its granted role.
4. After all three identities retrieve an exact private commit and required branch, change repository visibility to private and repeat the retrieval tests.

The Release Gate remains **not enforced** until branch/ruleset protections, required checks, independent review, staging evidence, and founder-controlled promotion are demonstrably active.
