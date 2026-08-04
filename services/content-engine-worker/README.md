# Content Engine Worker

Version-controlled baseline of the production `content-engine-worker-prod` Cloud Run service.

## Runtime and entry point

- Runtime: Python 3 Google Cloud Buildpacks / Functions Framework. The production source did not pin a Python minor version when imported; confirm the deployed revision runtime before changing it.
- HTTP entry point: `process_blog_topics` in `main.py`.
- Health behavior: Cloud Run uses its container startup/TCP probe. The worker intentionally exposes no separate unauthenticated health route.
- Dependency installation: `python -m pip install -r requirements.txt`.
- Local syntax check: `python -m py_compile main.py`.
- Local start: `functions-framework --target=process_blog_topics --port=8080` after setting the required environment.

## Production target

- Google Cloud project: configured at deployment time.
- Region: `us-central1` unless explicitly changed.
- Service: `content-engine-worker-prod`.
- Authentication: Cloud Run authentication plus the existing KOBA-I HMAC task signature and Cloud Tasks queue binding.

Example source deployment (values and secrets must come from the deployment environment, not this repository):

```bash
gcloud run deploy content-engine-worker-prod \
  --source=. \
  --region=us-central1 \
  --no-allow-unauthenticated
```

Do not deploy this baseline merely because it was committed.

## Environment variable names

Required:

- `CONTENT_FIRESTORE_PROJECT_ID`
- `KOBA_TASK_HMAC_SECRET` (secret value; never commit it)

Configured/defaulted by the worker:

- `GCP_REGION`
- `VERTEX_ARTICLE_REGION`
- `VERTEX_IMAGE_REGION`
- `ARTICLE_MODEL`
- `ARTWORK_MODEL`
- `TRANSCRIPTION_MODEL`
- `FIREBASE_STORAGE_BUCKET`
- `CLOUD_TASKS_QUEUE`
- `MAX_TASK_ATTEMPTS`

## Managed secrets and credentials

- WordPress Application Passwords remain in Google Secret Manager and are loaded only from task-bound secret-version references.
- `KOBA_TASK_HMAC_SECRET` is supplied to the runtime as a secret-backed environment variable.
- Application Default Credentials come from the Cloud Run service account; no service-account key file belongs in this directory.

## Preserved production responsibilities

- signed Cloud Tasks request validation and queue validation;
- Firestore leases, retries, and terminal attempts;
- Gemini article, social-copy, and featured-image generation;
- tenant WordPress credential and origin validation;
- deterministic WordPress draft creation/update;
- audiobook transcription through the same function entry point.

