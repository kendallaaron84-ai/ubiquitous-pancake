# Phase 5B — WordPress gateway least privilege

Status: development candidate only. No production IAM or application change is
authorized by this document.

## Application boundary

- New connection verification and credential versioning run through the
  authenticated WordPress egress gateway.
- Saved-connection verification runs through
  `POST /verify-stored-wordpress`; the Dashboard never receives the stored
  Application Password.
- Publication delivery continues through `POST /publish-vault`.
- Production Dashboard code fails closed if the gateway is unavailable. The
  direct Secret Manager fallback is development-only.
- The gateway and Dashboard no longer call `getIamPolicy` or `setIamPolicy`
  during author requests.

## Proposed permission contract

Exact principal emails must be read back before a deployment plan is approved.

| Principal | Required permissions | Resource boundary |
| --- | --- | --- |
| Gateway runtime | `secretmanager.secrets.create` | Project parent. This permission cannot be constrained by the future secret name. |
| Gateway runtime | `secretmanager.versions.add`, `secretmanager.versions.access` | Conditioned to canonical `WP_CREDS_*` resources. |
| Content worker | `secretmanager.versions.access` | Conditioned to canonical `WP_CREDS_*` resources or granted on each exact secret. |
| Dashboard | Cloud Run invocation only | Exact WordPress gateway service. No Secret Manager permissions after this candidate is deployed. |

`roles/secretmanager.admin` is prohibited for these runtime identities.

## Control-plane dependency

The worker accessor grant must exist before a newly stored credential is used by
the Content Engine. The approved IAM operation must use a version-3 policy, the
current ETag, and a surgical binding delta that preserves unrelated bindings,
conditions, policy metadata, and audit configuration. A conflict or unexpected
delta is a STOP condition.

## Release gates

1. Read back the gateway, content-worker, and Dashboard principals.
2. Bind and hash the exact custom-role definitions and IAM conditions.
3. Verify new-secret onboarding, existing-secret versioning, stored-connection
   testing, Content Engine draft delivery, and publication delivery with
   disposable non-customer fixtures.
4. Prove that the Dashboard has no effective Secret Manager permission.
5. Prove that neither gateway nor Dashboard can get or set Secret Manager IAM
   policies.
6. Exercise ETag-conflict and inverse-delta rollback tests without production
   mutation.

