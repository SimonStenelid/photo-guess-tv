# Deploy to Google Cloud Run

This setup gives the TV and phones one HTTPS address. Cloud Run runs the Node server, Firestore stores the current room, and a private Cloud Storage bucket holds photos. Use one service, database, and bucket for each group that needs to play independently. The app runs one room per deployment.

## Prerequisites

Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and sign in using `gcloud auth login`. Use a project with billing enabled and permission to enable APIs, deploy Cloud Run, create the resources below, and grant their IAM roles. Run the commands from the project directory in Bash or a similar shell with OpenSSL installed. Pick a region supported by all three services.

```sh
export PROJECT_ID=your-google-cloud-project
export REGION=europe-west1
export SERVICE=photo-guess-tv
export DATABASE=photo-guess
export BUCKET="${PROJECT_ID}-photo-guess"
export RUNTIME_ID=photo-guess-run
export SECRET=photo-guess-host-code

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_EMAIL="${RUNTIME_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
PUBLIC_ORIGIN="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com storage.googleapis.com \
  secretmanager.googleapis.com --project="$PROJECT_ID"
```

Bucket names are globally unique. If your chosen name already exists, change `BUCKET` before continuing. See Google's [source deployment prerequisites](https://cloud.google.com/run/docs/deploying-source-code) for the deployer permissions and the `roles/run.builder` grant to the Cloud Build service account. The build identity and the runtime identity below have different jobs.

## Set up storage and the host code

```sh
gcloud firestore databases create --database="$DATABASE" --location="$REGION" \
  --type=firestore-native --project="$PROJECT_ID"
gcloud firestore fields ttls update purgeAt --collection-group=photoGuessGames \
  --enable-ttl --database="$DATABASE" --project="$PROJECT_ID"

gcloud storage buckets create "gs://$BUCKET" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention \
  --soft-delete-duration=0 --project="$PROJECT_ID"

LIFECYCLE_FILE="$(mktemp)"
cat > "$LIFECYCLE_FILE" <<'JSON'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":1,"matchesPrefix":["games/"]}}]}
JSON
gcloud storage buckets update "gs://$BUCKET" \
  --lifecycle-file="$LIFECYCLE_FILE" --project="$PROJECT_ID"
rm "$LIFECYCLE_FILE"

openssl rand -hex 16 | tr -d '\n' | gcloud secrets create "$SECRET" \
  --replication-policy=automatic --data-file=- --project="$PROJECT_ID"
```

The bucket command turns off recovery of deleted photos for this dedicated bucket. Firestore TTL and object lifecycle cleanup are asynchronous. Photos normally get deleted by the app during play or when the host ends the game.

## Give Cloud Run access and deploy

```sh
gcloud iam service-accounts create "$RUNTIME_ID" --project="$PROJECT_ID"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_EMAIL" --role=roles/datastore.user \
  --condition="expression=resource.name == 'projects/$PROJECT_ID/databases/$DATABASE',title=PhotoGuessDatabase"

gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$RUNTIME_EMAIL" --role=roles/storage.objectUser \
  --project="$PROJECT_ID"
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:$RUNTIME_EMAIL" --role=roles/secretmanager.secretAccessor \
  --project="$PROJECT_ID"

gcloud run deploy "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --source=. --service-account="$RUNTIME_EMAIL" \
  --no-invoker-iam-check --ingress=all --min=0 --max=1 \
  --cpu=1 --memory=256Mi --cpu-throttling --no-cpu-boost --timeout=30s \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT_ID,PHOTO_DATABASE=$DATABASE,PHOTO_BUCKET=$BUCKET,PUBLIC_ORIGIN=$PUBLIC_ORIGIN" \
  --set-secrets="PHOTO_HOST_CODE=$SECRET:1"
```

The public HTTPS endpoint lets guests join without a Google account. Only someone with the host code can open or control the room. If your organization blocks public Cloud Run services, use a project whose policies allow them or host on your local network.

Check the service URL and retrieve the host code with an account that has access to the secret:

```sh
gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT_ID" \
  --format='value(status.url)'
gcloud secrets versions access 1 --secret="$SECRET" --project="$PROJECT_ID"
```

Open `$PUBLIC_ORIGIN/tv` and start a room. If the project uses a different service hostname, update the Cloud Run `PUBLIC_ORIGIN` environment variable to match the HTTPS origin shown by `describe`, with no trailing slash. Complete a test round with two players. Follow the [Samsung TV guide](local.md#install-on-a-samsung-tizen-tv) to build an app pointed at your service.

## Idle behavior and charges

With request-based billing and zero minimum instances, Cloud Run can scale down when traffic stops. Close the TV app and phone tabs after a game so they stop polling. Deployments and stored artifacts, logs, database operations and TTL deletes, object storage, Secret Manager, and network traffic may incur costs separately. An open room or other requests can generate charges. Set a [Cloud Billing budget alert](https://cloud.google.com/billing/docs/how-to/budgets) in your project to track spending. For pricing details, see [Cloud Run pricing](https://cloud.google.com/run/pricing).

See also [Cloud Run service identities](https://cloud.google.com/run/docs/configuring/services/service-identity), [Firestore IAM](https://cloud.google.com/firestore/docs/security/iam), and [Cloud Run service URLs](https://cloud.google.com/run/docs/triggering/https-request).
