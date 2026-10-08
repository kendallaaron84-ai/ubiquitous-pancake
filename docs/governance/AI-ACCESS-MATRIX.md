# AI repository access matrix

No credentials or repository permissions were changed while producing this matrix.

| Agent | Dashboard monorepo | Plugin repository | Verified identity/integration | Status |
|---|---|---|---|---|
| Cody / Codex | Local source/history and GitHub metadata available; exact production commit `a229e164...` retrieved successfully | Local source/history and GitHub metadata available; remote commit `5db01fd6...` retrieved successfully | Codex GitHub connection reports `kendallaaron84-ai` | **Verified for current public repositories**; local RC commits are not yet shared |
| ChatGPT | Kendall reports independent verification; not directly testable from this Codex session | Kendall reports repository access; not directly testable here | Exact GitHub integration identity and permissions still need recording | **Reported, not independently verified here** |
| Gemma / AntiG | Not testable from this Codex session | Public repository should be readable, but exact-commit/private access is unverified | Unknown | **Unverified** |

The Dashboard repository is currently public, so its present accessibility is not evidence that private read-only reviewer authorization works. Restoring privacy and granting selected-repository read access are separate operations.

## Least-privilege target

- Cody: read/write to non-production development/release branches; production promotion remains founder-controlled.
- ChatGPT: read-only repository contents, history, branches, PRs, checks, releases and artifacts.
- Gemma/AntiG: read-only access to the exact review branches, PR diffs, checks, releases and artifacts.
- Neither reviewer receives repository administration, secrets, deployment credentials or production write authority.

## Founder-approved setup required

1. Resolve the conflicting visibility direction. The repository is currently public, while the requested end state says to keep it private. Do not change visibility until Kendall explicitly confirms the desired end state.
2. In GitHub, confirm which GitHub App/OAuth connection ChatGPT uses and grant that integration read-only selected-repository access to `ubiquitous-pancake` before or when privacy is restored.
3. Identify Gemma/AntiG's GitHub account or supported integration. Add read-only access only after Kendall verifies the identity.
4. Prefer a private organization/team with repository `Contents: Read`, `Metadata: Read`, `Pull requests: Read`, `Actions: Read`, and `Checks: Read`.
5. Do not grant Actions secrets, administration, environments, deployments, issues write, contents write or organization ownership to independent reviewers.
6. Test each integration by fetching the exact production and RC commit, one source file, one PR diff and one workflow result.

These are permission-changing external actions and require explicit founder approval before execution.
