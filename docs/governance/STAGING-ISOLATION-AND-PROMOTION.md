# KOBA-I isolated staging and production promotion

Status: **prepared, not provisioned, not enforced**. Production remains **NO-GO**.

## Required staging boundary

Staging must use a separately billed GCP/Firebase project. A second database or
bucket inside the production project is not an acceptable boundary.

| Boundary | Staging requirement | Production resource forbidden |
|---|---|---|
| Vercel | Separate `koba-dashboard-staging` project or a dedicated staging environment whose variables are fully detached from Preview/Production | `bug-free-robot` Production environment and all inherited Production values |
| Firebase Auth | Staging Firebase project and test-only identities | Production users, UID exports, and production Identity Platform tenants |
| Firestore | Default database in the staging project, loaded only with synthetic fixtures | Production project/database, exports, purchases, entitlements, publications, and audit records |
| Storage | Staging-only bucket with a distinct project-owned service account | Production media bucket, signed URLs, objects, and IAM grants |
| Cloud Run | Staging gateway and worker with `min-instances=0` and staging-only identities | Production gateway URL, worker URL, or invoker roles on production services |
| Secret Manager | Staging project secrets containing only staging WordPress credentials | Production WordPress, Stripe, email, Twilio, Firebase, or customer secrets |
| WordPress | Separate WordPress installation and hostname with the review plugin build | Any existing author or KOBA-I production WordPress site |
| Commerce/email | Test mode or deterministic fakes; no real delivery except named test inboxes | Live Stripe keys/webhooks, production email, purchases, claims, refunds, or entitlements |

The Vercel documentation states that variables are environment-scoped and that a
Production deployment is created from the Production Branch or `vercel --prod`.
Staging therefore may not inherit the current shared Preview values. See
<https://vercel.com/docs/environment-variables> and
<https://vercel.com/docs/git#using-a-staging-branch>.

## Provisioning sequence

Provisioning requires founder approval of the new billing/project resources.

1. Create a new GCP/Firebase project with a unique ID containing `staging`.
2. Attach a budget alert at USD 5 and a hard operational review threshold at USD 20.
3. Create one Firestore database, one Storage bucket, and test-only Firebase identities.
4. Create distinct Dashboard Admin, gateway, worker, and task service accounts.
5. Grant those accounts roles only in the staging project. Confirm each account has
   **zero** IAM roles on the production project.
6. Deploy a staging WordPress installation at a new hostname. Create a staging-only
   Application Password for a least-privilege publication user.
7. Store only that credential in staging Secret Manager.
8. Deploy staging gateway/worker services with ingress and identity-token checks.
9. Create the separate Vercel staging project/environment with only staging IDs,
   URLs, origins, buckets, and secrets.
10. Load synthetic books, audio, images, purchases, and identities. Never import a
    production export.

## Isolation acceptance

Write-path E2E may start only after all checks below are captured as release evidence:

- Vercel environment inventory contains no production project ID, bucket, gateway,
  worker, WordPress hostname, secret resource, Stripe key, or email credential.
- Each staging service account's IAM policy in the production project is empty.
- A staging Admin SDK read against the production project fails authorization.
- A staging signed upload request names only the staging bucket.
- A staging gateway request to a production WordPress origin is rejected before
  secret lookup.
- Production WordPress Application Passwords do not authenticate on staging and
  staging passwords do not authenticate on production.
- Firestore and Storage audit logs show only staging resource names for the complete
  acceptance run.
- A canary record written in staging is absent from production, verified by a
  read-only production query.

Until those checks run against real staging resources, isolation is a design claim,
not proof.

## Low-volume cost estimate

Expected incremental infrastructure cost is **USD 0–10/month** for occasional
acceptance runs and scale-to-zero services, excluding a separately purchased
WordPress hosting plan. Set a USD 20 review ceiling.

- Firestore provides one free database per project with 1 GiB stored data, 50,000
  reads/day, 20,000 writes/day, 20,000 deletes/day, and 10 GiB outbound/month:
  <https://firebase.google.com/docs/firestore/pricing>.
- Cloud Run request-based services include 2 million requests plus CPU/RAM free
  allowances per billing account and can scale to zero:
  <https://cloud.google.com/run/pricing>.
- Secret Manager includes six active versions and 10,000 access operations per
  billing account/month; additional active versions are USD 0.06/month:
  <https://cloud.google.com/secret-manager/pricing>.
- Standard regional Storage is usage-based and has Always Free allowances in select
  US regions: <https://cloud.google.com/storage/pricing>.
- Vercel usage is plan/usage based. Use a separate staging project if Custom
  Environments are not included; do not pay for or activate a plan change without
  founder approval: <https://vercel.com/docs/pricing>.

WordPress cost is **USD 0 incremental** only if the current hosting plan includes a
truly separate staging installation. Otherwise obtain a provider quote before
provisioning; no hosting purchase is authorized by this document.

## Proposed GitHub rulesets (not activated)

Apply to the actual production branch in both repositories only after founder review:

1. Require a pull request; prohibit direct pushes, force pushes, deletions, and branch
   bypass except an audited founder break-glass role.
2. Require one independent approving review, Code Owner approval for security,
   deployment, workflow, gateway, and plugin entrypoint files, dismissal of stale
   reviews, and approval of the most recent push.
3. Require resolved conversations and linear history.
4. Require exact required checks:
   - Dashboard build and regression
   - Firestore tenant-isolation rules
   - WordPress gateway
   - Plugin PHP compatibility
   - Plugin source and contract regression
   - Packaged reader browser acceptance
   - staging-e2e / exact-release-sha
5. Require signed commits where every contributor can comply.
6. Require the branch to be current before merge and prevent ruleset bypass by GitHub
   Apps that do not need it.

## Proposed founder-controlled Vercel promotion (not activated)

1. Remove automatic production promotion from ordinary branch pushes.
2. Keep Preview isolated from Production secrets; staging deploys only from the
   protected staging environment and exact candidate SHA.
3. Build once after required checks, record the Git SHA and deployment/artifact IDs,
   and run staging E2E on that immutable deployment.
4. Require a GitHub `production` Environment with Kendall as required reviewer.
5. After independent approval and Kendall's explicit authorization, promote the
   already-tested deployment without rebuilding.
6. Record the promoted SHA/deployment ID and retain the previous production deployment
   for immediate rollback.

No ruleset, Vercel setting, cloud project, secret, or production deployment is changed
by this plan.
