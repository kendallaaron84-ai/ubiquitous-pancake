# KOBA-I system overview

Status: implementation snapshot for stabilization RC1. This document describes source verified at Dashboard commit `ab8f833` (production baseline `a229e16`) and plugin commit `d08ec56` (plugin baseline `50c49d7`). It is not a deployment record.

## Source layout

KOBA-I is maintained in two known Git repositories.

1. The private Dashboard monorepo (`kendallaaron84-ai/ubiquitous-pancake`) contains the Next.js Dashboard, Studio, Workbench, Nexus, reader and commerce APIs, Firebase/Firestore configuration, security services, and the WordPress egress gateway under `services/wordpress-egress-gateway`.
2. The WordPress plugin repository (`kendallaaron84-ai/koba-i-audio-updated-07.16.2026`) contains the KOBA-I Audio plugin, WordPress publication/storefront integration, and packaged Bloom/ebook reader code.

No independently versioned Bloom Player, entitlement, licensing, Stripe, or Firebase-security repository was found in the verified local source. Those components are part of one of the two repositories above. The Python content/transcription worker is referenced by the monorepo, but its authoritative repository has not been identified and is therefore a governance blocker.

## Runtime map

| Runtime | Source | Verified responsibility |
|---|---|---|
| `dashboard.koba-i.com` on Vercel | Dashboard monorepo | Dashboard UI, Studio, Workbench, Nexus, server-owned author/session APIs, reader and commerce routes |
| `wordpress-egress-gateway-prod` on Cloud Run, `us-central1` | `services/wordpress-egress-gateway` | Authenticated, tenant-bound WordPress egress through controlled credentials and network egress |
| Firebase Authentication, Firestore and Cloud Storage | Dashboard monorepo configuration and server SDK calls | User identity, tenant/publication records, purchases/entitlements, audit state, protected media |
| Tenant WordPress sites | WordPress plugin repository | Storefront, publication pages, plugin reader shell, WordPress identity mapping |
| Stripe | Dashboard monorepo server routes | Checkout/webhook processing at request time; never browser-side secret ownership |
| Cloud Tasks/content worker | Dashboard monorepo client; worker source unresolved | Asynchronous transcription/content work |

## Control plane and data plane

- The Dashboard is the authoring and orchestration control plane.
- Firestore `products/{assetId}` is the canonical publication workspace.
- Cloud Storage holds tenant-bound protected media. URLs and signed tickets are delivery mechanisms, not canonical identity.
- WordPress is a deployment projection. Its post IDs are destination mappings, not publication identity.
- Reader access is authorized using authenticated reader identity plus exact tenant, asset and active entitlement state.
- The updater manifest controls fleet distribution of the WordPress plugin and is intentionally separate from pilot installation state.

## Known deployment boundary issue

The repository contains `firebase.json` with root-level Next.js Hosting source configuration, but the verified Dashboard production path is Vercel. The complete monolith must not be replicated into Firebase Hosting/`ssrcontentengineprod` without an explicit architecture decision because the source tree also contains commerce, reader, email, administration and webhook responsibilities.
