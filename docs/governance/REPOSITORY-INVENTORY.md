# KOBA-I repository inventory

Verified 2026-10-08 from local Git metadata and the connected Codex GitHub integration. Unknown items are intentionally not inferred.

## Authoritative repositories

| System | Repository | Visibility/access observed | Default/production branch | Production reference | Active candidate | Deployment | Dependencies |
|---|---|---|---|---|---|---|---|
| Dashboard, Studio, Workbench, Nexus, Next.js reader/commerce APIs, Firebase configuration | [kendallaaron84-ai/ubiquitous-pancake](https://github.com/kendallaaron84-ai/ubiquitous-pancake) | Private or installation-restricted; connected GitHub integration returns 404 | Remote-tracked `feature/content-engine-rehearsal` | `a229e164d2d6b29661aee4d7ba92adc6d4790104` | Local `codex/stabilization-rc1` at `ab8f833e56f6aada2610fb8ce226b7e0fcdefc17` | Vercel, `dashboard.koba-i.com` | Firebase/GCP, gateway, plugin, Stripe, email/Twilio, content worker |
| WordPress egress gateway | Same monorepo, `services/wordpress-egress-gateway` | Same as monorepo | Same | Source at `a229e16` | Source at `ab8f833` | Cloud Run `wordpress-egress-gateway-prod`, `us-central1` | Secret Manager, Cloud Run IAM/VPC/NAT, tenant plugin sites |
| KOBA-I Audio WordPress plugin and packaged Bloom/ebook reader | [kendallaaron84-ai/koba-i-audio-updated-07.16.2026](https://github.com/kendallaaron84-ai/koba-i-audio-updated-07.16.2026) | Public; connected integration has read/write/admin scope | `main` | Fleet updater: tag `v6.1.0`/manifest `6.1.0`; audio pilot was previously verified at local `50c49d7` but remote `origin/main` is `5db01fd` | Local `codex/stabilization-rc1` at `d08ec56ad0fe49e02db686420c50dede1a5dfb2b` | Tenant WordPress sites; updater served by `audio.koba-i.com` | Dashboard catalog/reader APIs, WordPress, protected storage |
| Firestore rules/indexes and Firebase Hosting descriptor | Dashboard monorepo (`firestore.rules`, `firestore.indexes.json`, `firebase.json`) | Same as monorepo | Same | `a229e16` | `ab8f833` | Firebase project `content-engine-prod`; production Dashboard remains Vercel | Firebase CLI/emulators; project IAM |
| Stripe Connect, checkout, webhooks, entitlements and licensing | Dashboard monorepo routes/services | Same as monorepo | Same | `a229e16` | `ab8f833` | Vercel server routes plus Stripe/Firebase | Stripe secrets/webhook secret, Firestore |

## Components that are not separate repositories

- Dashboard, Studio, Workbench and Nexus are one Next.js monorepo.
- The WordPress egress gateway is a subproject in that monorepo.
- Reader authorization and entitlement services live in the monorepo.
- The WordPress/Bloom reader shell lives in the plugin repository.
- Firebase rules currently live in the monorepo.

## Unresolved repository ownership

The Cloud Tasks Python transcription/content worker is referenced by environment contract, but no authoritative GitHub repository was found in the verified workspace or accessible GitHub installation. Release governance is incomplete until its repository, production commit, deployment workflow and owners are recorded.

## Divergence requiring review

- Dashboard RC1 is local and not available to other agents through GitHub.
- Plugin candidate `d08ec56` and pilot parent `50c49d7` are local; GitHub `origin/main` remains `5db01fd`.
- The plugin repository is already public. This work did not alter visibility. Founder review should decide whether it is intentionally public; do not change it as part of access setup.
