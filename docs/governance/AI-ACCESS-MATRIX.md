# AI repository access matrix

No credentials or repository permissions were changed while producing this matrix.

| Agent | Dashboard monorepo | Plugin repository | Verified identity/integration | Status |
|---|---|---|---|---|
| Cody / Codex | Local source and history available; GitHub connector returns 404 | Local source/history and GitHub metadata available | Codex GitHub connection reports `kendallaaron84-ai` | **Partial** — private monorepo is not independently retrievable through GitHub |
| ChatGPT | Not testable from this Codex session | Not independently tested | Unknown until Kendall connects/authorizes GitHub in ChatGPT | **Unverified** |
| Gemma / AntiG | Not testable from this Codex session | Public repository should be readable, but exact-commit/private access is unverified | Unknown | **Unverified** |

## Least-privilege target

- Cody: read/write to non-production development/release branches; production promotion remains founder-controlled.
- ChatGPT: read-only repository contents, history, branches, PRs, checks, releases and artifacts.
- Gemma/AntiG: read-only access to the exact review branches, PR diffs, checks, releases and artifacts.
- Neither reviewer receives repository administration, secrets, deployment credentials or production write authority.

## Founder-approved setup required

1. In GitHub, confirm which GitHub App/OAuth connection ChatGPT uses and grant that integration read-only access to `ubiquitous-pancake`.
2. Identify Gemma/AntiG's GitHub account or supported integration. Add read-only access only after Kendall verifies the identity.
3. Prefer a private organization/team with repository `Contents: Read`, `Metadata: Read`, `Pull requests: Read`, `Actions: Read`, and `Checks: Read`.
4. Do not grant Actions secrets, administration, environments, deployments, issues write, contents write or organization ownership to independent reviewers.
5. Test each integration by fetching the exact production and RC commit, one source file, one PR diff and one workflow result.

These are permission-changing external actions and require explicit founder approval before execution.
