# P0 Storefront Isolation Production Gate

## Deployment candidates

- Dashboard/API: `0f8c1440364a34113f0df2eb83af9d12c5fc66bf`
- Dashboard CORS follow-up: the controlled commit containing this gate document
- WordPress plugin: `bd066177b4b404c804016cc096e754085308b640`
- WordPress plugin version: `6.0.8`

The dashboard and plugin form one compatibility boundary. Deploy them in one controlled maintenance window. Do not leave the new dashboard paired with an older StudioKey-header storefront, or plugin 6.0.8 paired with the old dashboard contract.

## Pre-deployment hold point

Before deployment, Antigravity must verify in the production Firebase project that only the intended KOBA-I platform license has one of these explicit authorities:

- `platformGlobalCatalogAuthority: true`; or
- an entitlement/plugin-entitlement equal to `platform_global_catalog`.

Record only the license document ID, authority field name, boolean/presence result, Firebase project ID, reviewer, and timestamp. Do not record credential values or signed storefront tokens. Every normal author license must lack this authority.

If the platform authority is absent, global presentation must remain unavailable and deployment approval is withheld until the authorized production configuration is approved. Do not infer authority from the owner email, StudioKey format, domain, or shortcode.

## Codex preflight evidence

- Focused P0 storefront tests: 9 passed, 0 failed.
- Full security suite: 191 passed, 0 failed.
- Nexus regression suite: 41 passed, 0 failed.
- Plugin regression suite: 8 passed, 0 failed.
- TypeScript `tsc --noEmit`: passed.
- Next.js production build: passed (34 static pages generated).
- Dashboard and plugin worktrees were clean before the CORS follow-up.
- Repository-wide consumer tracing found no browser-direct consumer of `/api/products/public` after plugin 6.0.8.

## Controlled deployment sequence

1. Record the current production Vercel deployment ID and the currently installed plugin package/version on each controlled site.
2. Confirm the server-side global authority hold point above.
3. Prepare the exact plugin 6.0.8 package from commit `bd06617`; verify its checksum and file inventory.
4. Deploy the dashboard candidate including `0f8c144` and the CORS follow-up. Record deployment ID, source commit, timestamp, and health result.
5. Immediately update the controlled WordPress sites to plugin 6.0.8. Record site origin, installed version, timestamp, and health result.
6. Re-run activation/verification on each controlled site only if the lazy signed-credential refresh does not succeed. Do not replace the StudioKey.
7. Execute the live smoke matrix and record request IDs, HTTP status codes, safe product counts, verified site/origin, and result. Never record bearer tokens, private keys, application passwords, or credential payloads.

## Required live smoke matrix

| Case | Expected result |
| --- | --- |
| Normal Author A catalog | Only Author A published/deployed products |
| Normal Author B catalog | Only Author B published/deployed products |
| Story World site | Only same-tenant products assigned to its authoritative `websiteConnectionId` |
| Tampered browser StudioKey | No effect on tenant; public StudioKey is not authorization |
| Normal site requests `scope=global` | `403 STOREFRONT_GLOBAL_SCOPE_FORBIDDEN` |
| Manual dashboard request without site bearer identity | `401 STOREFRONT_SITE_IDENTITY_REQUIRED` |
| Invalid/expired site bearer identity | `401 STOREFRONT_SITE_IDENTITY_INVALID` |
| Valid StudioKey from unauthorized origin | License verification/site authorization fails closed |
| Explicitly privileged KOBA-I platform site | Global catalog succeeds |
| Draft/private/disabled/unpublished/undeployed records | Excluded from all results |

P0 passes only when a normal author installation cannot receive another StudioKey's product records from the server.

## Rollback

Rollback is a coordinated pair operation:

1. Stop live smoke traffic and record the failing request ID/code without secrets.
2. In Vercel, promote/redeploy the last known-good dashboard deployment built from dashboard commit `2c22c9db8416b35ae9678bc46bfcf01c1f800217` (the parent state before the P0 dashboard commit).
3. On every site updated during the window, restore the verified plugin 6.0.7 package from plugin commit `a8638341bd1d99f481c5c41f9ff8d02e7b933147`.
4. Purge only application/CDN caches required to load the restored plugin assets. Do not delete connection, license, authorized-site, Secret Manager, product, or deployment-history records.
5. Verify the restored dashboard health, plugin activation, catalog rendering, player rendering, and prior production behavior.
6. Record rollback deployment ID, plugin checksum/version, sites restored, timestamp, operator, and outcome.

Do not roll back only one side and leave the incompatible API/plugin pair active.

## Phase 5F hold

Phase 5F legacy retirement remains blocked until:

- this P0 live gate passes;
- paid Phase 5E protected playback passes;
- promotion/free Phase 5E protected playback passes;
- protected-media inventory is complete; and
- every required media migration is approved and verified.

No Phase 5F code or destructive retirement action is included in this package.
