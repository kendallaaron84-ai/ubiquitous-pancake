# AI repository access matrix

No credentials or repository permissions were changed while producing this matrix.

| Agent | Dashboard monorepo | Plugin repository | Verified identity/integration | Status |
|---|---|---|---|---|
| Cody / Codex | Local source/history and authenticated remote fetch available; production `a229e164...`, RC `ab8f833e...`, public governance `5411b21f...` and local audit `064635f4...` resolve | Local source/history and authenticated remote fetch available; pilot `50c49d71...`, RC `d08ec56a...` and governance `9d338241...` resolve | Workstation Git credential path and Codex GitHub connection | **Verified for local inspection and authenticated fetch** |
| ChatGPT | Public repository reads work, but private selected-repository scope is not proven | Public repository reads work; private access is not material to the Dashboard privacy gate | App policy allows GitHub actions, but installed-repository discovery is empty and collaborator permission inspection returns `403` | **Private Dashboard access unverified** |
| Gemma / AntiG through Antigravity | Uses the workstation's authorized local checkout; exact production, RC and governance commits are present and the remote fetch credential path succeeds | Uses the workstation's authorized local checkout; exact pilot, RC and governance commits are present and the remote fetch credential path succeeds | No separate GitHub principal by design | **Verified for local inspection/fetch** |

The Dashboard repository is currently public, so its present accessibility is not evidence that the ChatGPT GitHub integration can read it after privacy is restored. Antigravity is intentionally outside this GitHub-principal model because it reviews the authorized local checkout.

## Least-privilege target

- Cody: read/write to non-production development/release branches; production promotion remains founder-controlled.
- ChatGPT: read-only repository contents, history, branches, PRs, checks, releases and artifacts.
- Gemma/AntiG: local read-only review of the exact fetched commits and artifacts through Antigravity. It receives no separate GitHub identity, token, repository administration or deployment authority.
- Neither reviewer receives repository administration, secrets, deployment credentials or production write authority.

## Founder-approved setup required

1. Keep the Dashboard repository public until the ChatGPT integration's private selected-repository scope is configured and ready for the private-state verification.
2. In GitHub, confirm which GitHub App/OAuth connection ChatGPT uses and grant that integration read-only selected-repository access to `ubiquitous-pancake`; then restore privacy and immediately reverify.
3. Do not create a GitHub account, App installation or token for Gemma/AntiG. Verify Antigravity by fetching and resolving the pinned commits through the existing workstation checkout and Git credentials.
4. For ChatGPT, prefer a selected-repository integration with `Contents: Read`, `Metadata: Read`, `Pull requests: Read`, `Actions: Read`, and `Checks: Read`.
5. Do not grant Actions secrets, administration, environments, deployments, issues write, contents write or organization ownership to independent reviewers.
6. Test ChatGPT by fetching the exact private production and review commits, one source file, one PR diff and one workflow result. Test Antigravity against the corresponding local commit objects and artifacts.

Repository visibility and integration-permission changes require action-time founder confirmation before execution.
