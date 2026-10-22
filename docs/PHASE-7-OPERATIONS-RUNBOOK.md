# Phase 7 External-Author Operations Runbook

Status: controlled rehearsal; customer execution requires Founder approval.

## Release packaging

The canonical plugin source is:

`C:\Users\kenda\Local Sites\koba-dev\app\public\wp-content\plugins\koba-i-audio`

Build releases only with the committed packager from that repository:

```powershell
pwsh -NoProfile -File .\scripts\package-plugin.ps1 `
  -Version 6.0.20 `
  -Commit 63a46f4abd85d92f51bb16dc0c311b8713252c0f `
  -OutputPath "C:\absolute\release\path\koba-i-audio-6.0.20.zip"
```

The packager exports tracked files from the exact commit, adds the canonical Composer `vendor/` tree, validates the ZIP, and extracts it into a temporary simulated `wp-content/plugins` directory.

Required install shape:

```text
wp-content/plugins/
└── koba-i-audio/
    ├── koba-i-audio.php
    ├── assets/
    ├── includes/
    └── vendor/
```

Packaging fails when:

- `koba-i-audio/koba-i-audio.php` is absent;
- an entry exists beneath `koba-i-audio/koba-i-audio/`;
- an entry exists outside the single `koba-i-audio/` root;
- a required runtime file or directory is absent;
- the extracted install does not expose the main plugin file at exactly `wp-content/plugins/koba-i-audio/koba-i-audio.php`;
- the destination archive already exists.

Validate a release or rollback archive independently:

```powershell
pwsh -NoProfile -File .\scripts\package-plugin.ps1 `
  -ValidateArchive "C:\absolute\release\path\koba-i-audio-6.0.20.zip" `
  -Version 6.0.20
```

Run the executable packaging regression:

```powershell
node --test .\tests\packaging-shape.test.mjs
```

Never extract the ZIP into an already-created `koba-i-audio` directory. WordPress replacement and manual rehearsals must target the parent `wp-content/plugins` directory.

## Phase 7B concierge onboarding

### Founder-controlled inputs

- author published name;
- normalized author email;
- approved capabilities: audiobook player, e-reader, or both;
- welcome delivery: immediate or deferred;
- exact HTTPS WordPress origin;
- WordPress username;
- dedicated WordPress Application Password;
- content role: Business Brand, Story World, or Both.

### Rehearsed sequence

1. The authenticated platform owner opens **Author Connections**.
2. Enter the author name and email.
3. Select only the capabilities approved for that author.
4. Select **Defer welcome package** when setup must remain silent.
5. Provision the workspace. The transaction creates or reuses the tenant-specific StudioKey idempotently by normalized email.
6. Record the returned StudioKey in the owner workflow; do not place credentials in notes or screenshots.
7. Continue to **Connect an Author's WordPress Site**.
8. Enter the exact HTTPS origin, WordPress username, dedicated Application Password, and content role.
9. The server validates owner identity and StudioKey ownership, resolves the origin, calls the existing WordPress egress gateway, and receives verified-site evidence.
10. The gateway stores the raw WordPress credential through the approved Secret Manager boundary. Firestore receives only `secretCredentialRef`.
11. The modern persistence transaction writes the authoritative website connection, `websiteConnectionId`, and plugin-license `authorizedSites` grant atomically.
12. Confirm the storefront is tenant-scoped before any author communication.
13. Send the welcome package later only through the existing owner-controlled action and only after Founder approval.

### Idempotency and rollback

- Repeating provisioning for the same normalized author email reuses the StudioKey and does not duplicate the author or license.
- Re-verifying the same normalized origin reuses the deterministic `websiteConnectionId` and does not duplicate `authorizedSites`.
- Gateway verification failure creates no website connection or authorized-site grant.
- The Firestore transaction writes connection and license grant together; either both commit or neither commits.
- Deferred welcome sends no email. Repeating a deferred request leaves delivery deferred.
- Before a live onboarding, retain the plugin rollback ZIP and record the pre-change site/plugin state.
- If site verification fails, leave the provisioned workspace intact and correct the WordPress boundary; do not create a replacement StudioKey.
- If a later deployment fails, preserve the verified connection and historical deployment metadata and roll back only the failed publication/plugin release as applicable.

### Control ownership

| Action | Control |
| --- | --- |
| Provision/recover workspace | Founder-controlled, automated transaction |
| Select capabilities | Founder-controlled |
| Defer/send welcome | Founder-controlled |
| Create WordPress Application Password | Author/Founder-controlled in WordPress |
| Verify and store WordPress credential | Automated gateway/Secret Manager boundary |
| Persist website connection and grant | Automated atomic transaction |
| Validate storefront isolation | Founder-controlled acceptance |
| Install/rollback plugin | Production-only controlled operation |

## Fixture rehearsal

The executable fixture chain is:

`node --test app/api/admin/phase7b-concierge-rehearsal.test.mjs`

It uses non-customer `.example.test` identities and in-memory dependencies. It makes no network requests, sends no email, writes no Firestore data, and stores no credential. It proves deferred welcome, capability selection, tenant StudioKey reuse, gateway-first connection verification, safe credential-reference handling, deterministic website identity, authorized-site idempotency, and fail-before-persistence behavior.
