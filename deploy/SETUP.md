# Deploying Bond to Google Cloud

`.github/workflows/deploy.yml` tests every push and, on `main`, deploys four Cloud Run services
(`niroun-api`, `niroun-dashboard`, `niroun-admin-app`, `niroun-homepage`). Do this setup once.

Replace the values in the first block, then run the rest in a shell with `gcloud` signed in as a project owner.

```bash
export PROJECT_ID=your-project-id
export REGION=us-central1
export GITHUB_REPO=vinothdinakar/Niroun     # owner/name
export BUCKET=$PROJECT_ID-niroun-docs

gcloud config set project $PROJECT_ID
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

# 1. APIs, image repository, document bucket
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com
gcloud artifacts repositories create niroun --repository-format=docker --location=$REGION
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access

# 2. Service accounts: one for GitHub to deploy with, one for the running services
gcloud iam service-accounts create niroun-deploy
gcloud iam service-accounts create niroun-runtime
DEPLOY_SA=niroun-deploy@$PROJECT_ID.iam.gserviceaccount.com
RUNTIME_SA=niroun-runtime@$PROJECT_ID.iam.gserviceaccount.com

for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$DEPLOY_SA --role=$role
done
gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SA \
  --member=serviceAccount:$DEPLOY_SA --role=roles/iam.serviceAccountUser
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$RUNTIME_SA --role=roles/storage.objectAdmin

# 3. Secrets. Use a MongoDB Atlas connection string (Cloud Run can't host MongoDB).
#    Allow Atlas to accept connections from Cloud Run (0.0.0.0/0 or a static egress IP).
printf '%s' 'mongodb+srv://USER:PASS@cluster.mongodb.net/' | gcloud secrets create niroun-mongo-url --data-file=-
# BOND_ENCRYPTION_KEY: check api/src for the required format; this assumes 32 random bytes, base64.
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create niroun-encryption-key --data-file=-
for s in niroun-mongo-url niroun-encryption-key; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$RUNTIME_SA \
    --role=roles/secretmanager.secretAccessor
done

# 4. Workload Identity Federation: lets this GitHub repo (and only it) act as the deploy account
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github-repo --location=global \
  --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition="assertion.repository=='$GITHUB_REPO'"
gcloud iam service-accounts add-iam-policy-binding $DEPLOY_SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO"

# 5. GitHub repository variables (needs the gh CLI)
gh variable set GCP_PROJECT_ID --body $PROJECT_ID
gh variable set GCP_REGION --body $REGION
gh variable set GCP_DEPLOY_SA --body $DEPLOY_SA
gh variable set GCP_RUNTIME_SA --body $RUNTIME_SA
gh variable set BOND_GCS_BUCKET --body $BUCKET
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER \
  --body "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-repo"
```

## First deploy: the console URLs

`BOND_PUBLIC_URL` (dashboard) and `BOND_STAFF_URL` (admin app) are the consoles' public URLs, which don't exist
until the services do. So:

1. Set both to a placeholder, e.g. `gh variable set BOND_PUBLIC_URL --body https://placeholder.invalid`, and
   likewise `BOND_STAFF_URL`. Create a `production` environment in GitHub (Settings > Environments); add
   required reviewers there if you want approval before each deploy.
2. Push to `main` (or run the workflow manually). All four services are created.
3. Read the real URLs: `gcloud run services list --region $REGION`. Set the two variables to the dashboard and
   admin app URLs, then re-run the workflow so the API picks them up.

## Notes

- All services are deployed with `--allow-unauthenticated`. Put the admin app behind Identity-Aware Proxy or
  restrict it before real use.
- The first `main` push after setup is the real test of the Docker builds; watch that run.
- Custom domains: map them in Cloud Run, then update `BOND_PUBLIC_URL` / `BOND_STAFF_URL`.

## Deploying one app at a time

GitHub > Actions > CI/CD > Run workflow, then pick `api`, `dashboard`, `admin-app` or `homepage` (or `all`).
Deploy `api` first; the consoles need it to exist. Pushes to `main` deploy `all`.
