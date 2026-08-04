# WordPress Egress Gateway

Version-controlled baseline of the production `wordpress-egress-gateway-prod` Cloud Run service.

## Runtime and entry point

- Runtime: Node.js 24 Google Cloud Buildpacks, ES modules.
- Package manager: pnpm 11.x.
- Entry point: `index.js`.
- Install: `pnpm install --frozen-lockfile`.
- Start: `pnpm start`.
- Syntax check: `pnpm check`.
- Health check: authenticated `GET /healthz` returns HTTP 200 JSON.

## Production target

- Region: `us-central1`.
- Service: `wordpress-egress-gateway-prod`.
- Authentication: Cloud Run invoker authentication is required.
- Network: the production service is attached to the KOBA-I Serverless VPC connector with all egress routed through Cloud NAT and its reserved WordPress egress IP.

Example source deployment (project, service account, connector, and environment values must be supplied by the deployment environment):

```bash
gcloud run deploy wordpress-egress-gateway-prod \
  --source=. \
  --region=us-central1 \
  --no-allow-unauthenticated \
  --vpc-connector=koba-vpc-connector \
  --vpc-egress=all-traffic
```

Do not deploy this baseline merely because it was committed.

## Environment variable names

- `PORT`
- `GOOGLE_CLOUD_PROJECT`
- `CONNECTION_SECRET_PROJECT_ID`
- `CONNECTION_SECRET_PROJECT_NUMBER`
- `CONTENT_WORKER_SERVICE_ACCOUNT`

## Managed secrets and credentials

- WordPress Application Passwords remain in Google Secret Manager.
- Firestore stores secret-version references, never raw passwords.
- The Cloud Run service account supplies Application Default Credentials; no key file is committed.

## Routes and preserved responsibilities

- `GET /healthz`: service health.
- `POST /verify-wordpress`: validates and vaults a tenant-bound WordPress connection.
- `POST /publish-vault`: loads the tenant credential, enforces stored origin/username binding, and forwards publication payloads through Cloud NAT.
- Redirect rejection, origin validation, secret validation, and WordPress draft/publication proof behavior remain unchanged in this baseline.

