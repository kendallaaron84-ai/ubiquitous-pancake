# Vercel production environment

Configure these values in **Vercel → Project Settings → Environment Variables**
for the Production environment. Never commit secret values to source control.

## Dashboard access

| Variable | Purpose |
| --- | --- |
| `KOBA_OWNER_EMAILS` | Comma-separated platform-owner emails. Controls owner navigation and is rechecked by privileged server routes. |
| `KOBA_DASHBOARD_SESSION_SECRET` | Random secret of at least 32 characters used to sign dashboard sessions. Use a production-only value. |
| `KOBA_ALLOWED_ORIGINS` | Comma-separated HTTPS dashboard origins allowed to call privileged same-origin routes, including `https://dashboard.koba-i.com`. |

## Firebase Admin

| Variable | Purpose |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Production Firebase/GCP project ID. |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin service-account email. |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin private key with escaped `\n` line breaks preserved. |
| `FIREBASE_STORAGE_BUCKET` | Canonical GCS/Firebase Storage bucket that contains audio and generated transcript objects. Required for signed transcript URLs. |

## WordPress connection control plane

| Variable | Purpose |
| --- | --- |
| `CONNECTION_SECRET_PROJECT_ID` | GCP project containing per-author WordPress credential secrets. |
| `CONNECTION_SECRET_PROJECT_NUMBER` | Numeric GCP project number used to build canonical Secret Manager references. |
| `CONTENT_WORKER_SERVICE_ACCOUNT` | Cloud Run worker service account granted `roles/secretmanager.secretAccessor`. |

The Vercel Firebase Admin identity also needs permission to create secret versions
and update IAM policies in the configured Secret Manager project. The Cloud Run
worker receives read-only accessor permission for each author credential secret.

## Author welcome-package delivery

| Variable | Purpose |
| --- | --- |
| `GOOGLE_WORKSPACE_EMAIL` | Google Workspace mailbox used as the welcome-package sender and reply-to address. |
| `GOOGLE_WORKSPACE_APP_PASSWORD` | App Password for the sender mailbox. Store it only as a Vercel secret. |
| `KOBA_PLUGIN_DOWNLOAD_URL` | Public HTTPS URL for the tested, release-version KOBA-I Audio plugin ZIP. Provisioning fails closed when this value is absent. |
| `KOBA_DASHBOARD_URL` | Production dashboard origin used by the welcome email, normally `https://dashboard.koba-i.com`. |

Publish and verify the plugin ZIP before enabling Stripe fulfillment. Do not point
`KOBA_PLUGIN_DOWNLOAD_URL` at a local build, an unpublished route, or a mutable
development artifact.

## Author plugin storefront

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key used only by server routes and webhook verification. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the production `/api/webhook/stripe` destination. |
| `STRIPE_PRICE_PLUGIN_EREADER` | Stripe Price ID offered as the E-Reader product on `/signup`. |
| `STRIPE_PRICE_PLUGIN_AUDIOBOOK` | Stripe Price ID offered as the Audiobook Player product on `/signup`. |
| `STRIPE_PRICE_PLUGIN_BUNDLE` | Stripe Price ID offered as the combined author publishing bundle on `/signup`. |

The three Stripe prices may be one-time or recurring. The checkout route derives the
correct Stripe Checkout mode from the configured Price object and never accepts a
Price ID from the browser. Stripe must deliver `checkout.session.completed` and
`checkout.session.async_payment_succeeded` to `/api/webhook/stripe`.

## Content generation queue

| Variable | Purpose |
| --- | --- |
| `CLOUD_TASKS_PROJECT_ID` | GCP project that owns the content-generation queue. |
| `CLOUD_TASKS_LOCATION` | Queue region. It must match the deployed queue. |
| `CLOUD_TASKS_QUEUE` | Queue name, such as `content-generation-queue`. |
| `PYTHON_CONTENT_ENGINE_URL` | HTTPS Cloud Run task endpoint. |
| `CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT` | Service account used for Cloud Tasks OIDC authentication. |
| `KOBA_TASK_HMAC_SECRET` | Random secret of at least 32 characters used to sign the task body for worker verification. |

## Pre-deployment checks

1. Confirm `KOBA_OWNER_EMAILS` contains only approved platform owners.
2. Confirm `https://dashboard.koba-i.com` is present in `KOBA_ALLOWED_ORIGINS`.
3. Confirm Firebase Admin credentials target the production project.
4. Confirm Secret Manager and Cloud Tasks IAM grants use least privilege.
5. Confirm all three plugin Price IDs are active in the same Stripe mode as `STRIPE_SECRET_KEY`.
6. Confirm the welcome-package mailbox and plugin ZIP URL using a Stripe test-mode purchase through `/signup`.
7. Run `pnpm test:security`, `pnpm tsc --noEmit`, and `pnpm build` before deployment.

## Cloud Run transcription worker

Configure these values on the Python Cloud Run worker rather than in browser-visible variables:

| Variable | Purpose |
| --- | --- |
| `FIREBASE_STORAGE_BUCKET` | Bucket used for GCS audio inputs and `transcripts/{studioKey}/{assetId}/{trackId}.json` outputs. |
| `TRANSCRIPTION_MODEL` | Vertex Gemini model used for time-synchronized audiobook transcription. |

The worker identity needs read access to audiobook objects and create/update access
under the `transcripts/` prefix. The Vercel Firebase Admin identity needs object-read
access so `/api/media/manifest` can issue short-lived signed transcript URLs. Configure
the bucket CORS policy for the approved WordPress storefront origins so the player can
fetch those signed JSON files directly.
