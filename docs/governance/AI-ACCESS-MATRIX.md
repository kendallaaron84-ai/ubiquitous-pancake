# AI repository access matrix

No credentials or repository permissions were changed while producing this matrix.

| Agent | Dashboard monorepo | Plugin repository | Verified identity/integration | Status |
|---|---|---|---|---|
| Cody / Codex | Local source/history and GitHub metadata available; exact production commit `a229e164...` retrieved successfully | Local source/history and GitHub metadata available; remote commit `5db01fd6...` retrieved successfully | Codex GitHub connection reports `kendallaaron84-ai` | **Verified for current public repositories**; local RC commits are not yet shared |
| ChatGPT | Kendall reports independent verification; not directly testable from this Codex session | Kendall reports repository access; not directly testable here | Exact GitHub integration identity and permissions still need recording | **Reported, not independently verified here** |
| Gemma / AntiG through Antigravity | Uses the workstation's authorized local checkout; exact production, RC and governance commits are present and the remote fetch credential path succeeds | Uses the workstation's authorized local checkout; exact pilot, RC and governance commits are present and the remote fetch credential path succeeds | No separate GitHub principal by design | **Verified for local inspection/fetch** |

The Dashboard repository is currently public, so its present accessibility is not evidence that the ChatGPT GitHub integration can read it after privacy is restored. Antigravity is intentionally outside this GitHub-principal model because it reviews the authorized local checkout.

## Least-privilege target

- Cody: read/write to non-production development/release branches; production promotion remains founder-controlled.
- ChatGPT: read-only repository contents, history, branches, PRs, checks, releases and artifacts.
- Gemma/AntiG: local read-only review of the exact fetched commits and artifacts through Antigravity. It receives no separate GitHub identity, token, repository administration or deployment authority.
- Neither reviewer receives repository administration, secrets, deployment credentials or production write authority.

## Founder-approved setup required

1. Resolve the conflicting visibility direction. The repository is currently public, while the requested end state says to keep it private. Do not change visibility until Kendall explicitly confirms the desired end state.
2. In GitHub, confirm which GitHub App/OAuth connection ChatGPT uses and grant that integration read-only selected-repository access to `ubiquitous-pancake` before or when privacy is restored.
3. Do not create a GitHub account, App installation or token for Gemma/AntiG. Verify Antigravity by fetching and resolving the pinned commits through the existing workstation checkout and Git credentials.
4. For ChatGPT, prefer a selected-repository integration with `Contents: Read`, `Metadata: Read`, `Pull requests: Read`, `Actions: Read`, and `Checks: Read`.
5. Do not grant Actions secrets, administration, environments, deployments, issues write, contents write or organization ownership to independent reviewers.
6. Test ChatGPT by fetching the exact private production and review commits, one source file, one PR diff and one workflow result. Test Antigravity against the corresponding local commit objects and artifacts.

These are permission-changing external actions and require explicit founder approval before execution.
