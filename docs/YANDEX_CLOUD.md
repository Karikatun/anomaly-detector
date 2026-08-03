# Yandex Cloud Production

Anomaly Detector uses this runbook for its Russian public test and production
environment. The application is publicly reachable, but the first test launch has no
marketing campaign: links are distributed directly to known testers.

## Service Map

- Browser API and WebSocket ingress: Yandex Application Load Balancer on a custom
  `api.<site-domain>` host, with TLS from Certificate Manager and WebSocket enabled.
- Backend runtime: a fixed-size Compute Cloud instance group. Each VM runs two
  containers from the same immutable backend image: `api` and `worker`.
- Runtime recovery: instance-group health checks cover API readiness on port `3000`
  and worker readiness on its private health port `3001`; failed instances are restarted
  or recreated.
- Edge protection: Smart Web Security and Advanced Rate Limiter attach to the
  Application Load Balancer virtual host.
- Images: immutable backend images live in Yandex Container Registry.
- Production database: Yandex Managed Service for PostgreSQL.
- Uploads and media: Yandex Object Storage.
- Static `webapp` and fully prerendered `website` output: Yandex Object Storage static website hosting.
- CDN: Yandex Cloud CDN in front of public static sites and public media when production performance, custom domains, or cache controls matter.
- Real-time Pub/Sub: Yandex Managed Service for Valkey only when horizontally scaled WebSocket features need cross-instance fanout.
- CLI: Yandex Cloud CLI, `yc`.

## Confirmed Public Hosts

- Webapp: `https://anomaly-detector.ru`.
- API and WebSocket: `https://api.anomaly-detector.ru`.
- Redirect only: `https://www.anomaly-detector.ru` to `https://anomaly-detector.ru`.
- Support: `support@anomaly-detector.ru`; do not publish legal/support pages until
  inbound and outbound delivery has been verified.

The DNS zone is currently hosted by REG.RU. Before cutover, lower the affected records'
TTL, preserve mail records, and replace only the web/API address records with the
Application Load Balancer/CDN targets. Do not delegate the whole zone merely to set up
mail.

## Intake

Ask only product and release questions:

- which surfaces are being deployed now: backend/API, webapp, website, or full-stack;
- production domains for API, webapp, website, and media/CDN;
- expected simultaneous testers and the acceptable monthly infrastructure budget;
- support contact for account recovery, incidents, and privacy requests;
- whether uploads/media are public, private, or mixed;
- whether images need fixed-size generated variants, dynamic transformations,
  compression, cropping, or moderation.

## Prerequisites

Manual prerequisites for the user:

- Yandex Cloud account with billing enabled.
- Cloud and folder selected.
- Production domains and DNS access for the authenticated webapp and API. Browser auth requires same-site custom hosts such as `app.example.com` and `api.example.com`.
- A Certificate Manager certificate for the Application Load Balancer custom domain.
- Docker running locally if the backend image will be built from this machine.
- AWS CLI when uploading static build output or media through the S3-compatible Object Storage API.
- `jq` when using the shell snippets below that parse `yc --format json` output.
- Yandex Cloud CLI installed and initialized:

```bash
curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash
yc init --username=<email_address>
yc config list
```

Use `yc config set folder-id <folder_ID>` when the active folder must be changed.

## Backend Image

Use `backend/Dockerfile` from the monorepo root as the Docker build path, the same as the DigitalOcean path.

Create and configure Container Registry:

```bash
yc container registry create --name <project-registry>
yc container registry configure-docker
```

Build and push the backend image:

```bash
REGISTRY_ID=$(yc container registry get --name <project-registry> --format json | jq -r .id)
docker build -f backend/Dockerfile -t cr.yandex/$REGISTRY_ID/<project>-backend:<tag> .
docker push cr.yandex/$REGISTRY_ID/<project>-backend:<tag>
```

Use an immutable tag containing the release commit SHA. Do not deploy `latest`.

## Compute Runtime

Create a service account that can pull only the backend image and read only the
application's Lockbox secrets. The instance group uses a Container Optimized Image and
starts both processes from the committed
[`backend-runtime.compose.yaml.example`](../deploy/yandex/backend-runtime.compose.yaml.example)
definition:

- API: `bun run start:api`, public to the load balancer on port `3000`;
- worker: `bun run start:worker`, no public application routes;
- worker health: `GET /health/live` and `GET /health/ready` on private port `3001`;
- both containers: `restart: always`, the same immutable image and production env.

Do not combine API and worker into one process. A failed worker must be visible even when
the API remains healthy. Do not publish port `3001` to the internet; allow it only from
the instance-group health-check address ranges/security group.

Start with a fixed-size group of one non-preemptible VM for the public test. Enable
instance autohealing and use health checks for both:

```text
API:    GET http://<instance>:3000/health/ready
Worker: GET http://<instance>:3001/health/ready
```

The worker readiness endpoint stays unavailable until both deadline loops complete
successfully. It becomes unavailable after a loop error or stale heartbeat and recovers
after the next successful pass.

Production env must include:

```bash
NODE_ENV=production
PORT=3000
WORKER_HEALTH_PORT=3001
DATABASE_URL=postgresql://...
JWT_SECRET=<64-or-more-hex-characters>
ADMIN_USER_IDS=<comma-separated-operator-user-uuids>
CORS_ORIGINS=https://anomaly-detector.ru,https://ops.anomaly-detector.ru
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
REFRESH_REUSE_GRACE_SECONDS=10
SESSION_ABSOLUTE_TTL_DAYS=90
SESSION_RETENTION_DAYS=7
AUTH_BODY_LIMIT_BYTES=65536
AUTH_RATE_LIMIT_MAX=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
SHUTDOWN_GRACE_SECONDS=20
TRUST_PROXY=true
TRUSTED_PROXY_CLIENT_IP_HEADER=x-forwarded-for
TRUSTED_PROXY_CLIENT_IP_POSITION=first
COOKIE_SECURE=true
```

Leave `ADMIN_USER_IDS` empty to disable the read-only operator overview. When enabled, use immutable user UUIDs from the intended operators' profiles. Build and serve `adminapp` only from the separately protected `ops.anomaly-detector.ru` host; never include it in the player `webapp` output. Backend authorization and identical `404` responses remain mandatory behind the edge check.

Yandex Application Load Balancer places the source client address first in
`X-Forwarded-For`. Validate this in the production-like smoke test before relying on IP
budgets, and keep backend ports reachable only from the load balancer and health checks.

Despite its historical name, `AUTH_BODY_LIMIT_BYTES` is a global API request
body limit and runs before route validation or authentication work.

`AUTH_RATE_LIMIT_*` remains only a per-process backstop. Attach Smart Web Security with
an Advanced Rate Limiter profile to the load balancer before exposing auth routes. Scope
rules independently to register, login, refresh, and logout.

Keep secrets in Lockbox and materialise them only at instance startup into a root-owned,
mode `0600` runtime env file outside the repository. Never put secret values in instance
metadata, committed Compose files, build arguments, logs, or shell history.

Before provisioning, validate the template without printing a resolved secret-bearing
configuration:

```bash
BACKEND_IMAGE=cr.yandex/<registry_ID>/anomaly-detector-backend:<commit_SHA> \
BACKEND_ENV_FILE=/dev/null \
docker compose \
  -f deploy/yandex/backend-runtime.compose.yaml.example \
  config --quiet
```

Generate `JWT_SECRET` with `openssl rand -hex 32`; that command creates 32 random bytes encoded as 64 hex characters. Do not use the placeholder from `.env.example`, repeated characters, or human phrases.

### Application Load Balancer

Create an HTTPS listener using Certificate Manager, an HTTP router for
`api.<site-domain>`, and a backend group targeting API port `3000`. Enable WebSocket on
the route used by `/api/realtime/ws` and set connection and idle timeouts above the
client heartbeat/reconnect window. The load balancer must never target worker port
`3001`.

Attach Smart Web Security and Advanced Rate Limiter to the API virtual host before DNS
is switched. Enable access logs with redaction and alerts for elevated `4xx`, `5xx`, and
backend latency. Use `https://api.anomaly-detector.ru` as both `VITE_API_URL`
and `VITE_OAUTH_API_URL`, and the exact `https://anomaly-detector.ru` origin in
`CORS_ORIGINS`.

## Support Mailbox

Use one real mailbox, `support@anomaly-detector.ru`, rather than forwarding to a
personal address. The mailbox is hosted by REG.RU and its MX records are configured.

1. Verify inbound and outbound delivery with unrelated mail providers.
2. Obtain the exact SPF and DKIM values from the active REG.RU mail service and add
   them to the domain without copying or guessing values from another provider.
3. Verify that both SPF and DKIM pass on delivered messages.
4. Add a DMARC policy in monitoring mode, review reports, then tighten it.
5. Confirm the responsible operator, access recovery, and retention procedure for
   support and personal-data requests.
6. Confirm the contractual personal-data processing terms and data location of the
   active REG.RU mail service before public launch.

## Managed PostgreSQL

Use Yandex Managed Service for PostgreSQL **18** for production data. Do not accept the provider's default version implicitly: the committed schema uses native `uuidv7()`, which requires PostgreSQL 18+.

Operational defaults:

- Use the `PRODUCTION` environment for real production data.
- Keep the database private in the same cloud network as the Compute instance group.
- Configure security groups for PostgreSQL access, including port `6432` for the allowed source.
- Use SSL for public internet connections.
- Take a backup before destructive schema or data operations.

Apply Prisma migrations from a protected operator environment with production env configured:

```bash
bun run --cwd backend prisma:deploy
```

Do not run `prisma migrate dev` in production and do not hand-write Prisma migration SQL.

## Maintenance Cleanup Timer

Production must run `maintenance:cleanup` daily; setting `SESSION_RETENTION_DAYS` alone does not delete rows. The task removes stale sessions, expired login and registration anti-abuse buckets, unfinished OAuth transactions, one-time realtime tickets after their TTL, and waiting rooms older than 24 hours. `auth:sessions:cleanup` remains a backwards-compatible alias for existing deployments. Use a separate private Serverless Container from the same immutable backend image in **task** runtime mode. This keeps the public API process monolithic while giving the timer a one-shot command that exits non-zero on failure.

Create the cleanup container and deploy its revision. The image `WORKDIR` is already `/app/backend`, so the command can call the existing cron runner directly:

```bash
yc serverless container create --name <project>-maintenance-cleanup

yc serverless container revision deploy \
  --container-name <project>-maintenance-cleanup \
  --image cr.yandex/$REGISTRY_ID/<project>-backend:<immutable-tag> \
  --runtime task \
  --command bun \
  --args src/cron.ts,maintenance:cleanup \
  --cores 1 \
  --memory 256MB \
  --execution-timeout 60s \
  --service-account-id <cleanup_runtime_service_account_ID> \
  --environment DATABASE_URL='<production_database_url>',JWT_SECRET='<production_jwt_secret>',CORS_ORIGINS=https://anomaly-detector.ru,COOKIE_SECURE=true,SESSION_ABSOLUTE_TTL_DAYS=90,SESSION_RETENTION_DAYS=7
```

Configure the cleanup revision with the same production `DATABASE_URL`, `JWT_SECRET`, session TTL, retention, network, and Lockbox policy as the API revision. Prefer Lockbox or the console instead of putting real secrets into shell history. Do not make the cleanup container public.

Create a narrowly scoped service account for the timer, grant it invocation access only to the cleanup container, and schedule the task daily at 03:00 UTC. Yandex timer expressions have six fields and use UTC:

```bash
yc iam service-account create --name <project>-maintenance-cleanup-trigger
TRIGGER_SA_ID=$(yc iam service-account get \
  --name <project>-maintenance-cleanup-trigger \
  --format json | jq -r .id)
CLEANUP_CONTAINER_ID=$(yc serverless container get \
  --name <project>-maintenance-cleanup \
  --format json | jq -r .id)

yc serverless container add-access-binding \
  --name <project>-maintenance-cleanup \
  --service-account-id "$TRIGGER_SA_ID" \
  --role serverless-containers.containerInvoker

yc serverless trigger create timer \
  --name <project>-maintenance-cleanup-daily \
  --cron-expression '0 3 ? * * *' \
  --invoke-container-id "$CLEANUP_CONTAINER_ID" \
  --invoke-container-service-account-id "$TRIGGER_SA_ID" \
  --retry-attempts 3 \
  --retry-interval 30s
```

After deployment, invoke the private cleanup container once with an IAM token and verify HTTP 200 plus `X-Task-Exit-Code: 0`. Then confirm `yc serverless trigger get --name <project>-maintenance-cleanup-daily` reports an active trigger. After the first scheduled window, inspect the cleanup container's invocation logs and require a recent `Cron maintenance:cleanup removed ... stale sessions, ... expired abuse buckets, ... OAuth transactions, ... realtime tickets, and ... expired waiting rooms.` entry; absence of a recent successful entry is an operational failure, not proof that there were zero stale records.

## Real-Time Pub/Sub

Keep the Yandex deployment path monolithic by default: the API container should own HTTP routes, auth, persistence, and WebSocket endpoints, while the worker is only a second process for authoritative deadlines. Do not split chat, notifications, or presence into microservices unless the product has a concrete operational reason.

When the backend runs as one container instance, WebSocket connection state can stay inside that process. If the container is horizontally scaled and users connected to different instances must receive the same chat, presence, collaboration, or live-notification events, add Yandex Managed Service for Valkey as a Redis-compatible Pub/Sub broker.

Each backend instance should publish domain events to Valkey and subscribe to the channels it needs to deliver events to its own local WebSocket connections. Keep Valkey out of baseline local setup and ordinary request/response APIs; add it only for cross-instance real-time fanout.

## Static Webapp And Website

The current production baseline serves the built webapp and proxies the API
through Caddy on one Yandex VM. It also runs the API, worker, and Docker
PostgreSQL on that VM. Immutable release directories, a database dump before
migrations, retained rollback artifacts, container-internal health checks, and
public HTTPS checks protect this baseline. It is operational, but it is not the
target production-like topology: there is no instance-group/ALB failover,
Managed PostgreSQL recovery, Lockbox delivery, Cloud Logging alerting, or edge
WAF validation yet. Track that migration in
[#21](https://github.com/Karikatun/anomaly-detector/issues/21) and distributed
edge/application protection in
[#19](https://github.com/Karikatun/anomaly-detector/issues/19).

After a release has passed container-internal and public health checks, retain
exactly two application backend images on the VM:

- the image used by the active Compose configuration;
- the immediately preceding image referenced by the retained rollback Compose
  configuration.

Remove older `anomaly-detector-backend:<commit>` images, dangling images, and
unused Docker build cache. Keep the active PostgreSQL and Caddy images,
PostgreSQL volumes, the current and rollback Compose files, the corresponding
release directories, and the latest pre-migration database dump. Resolve and
inspect the two retained image references before deleting explicitly listed
older tags; do not use a broad `docker system prune --volumes`.

After cleanup, require all of the following:

- both retained backend image references pass `docker image inspect`;
- API, worker, and PostgreSQL containers remain healthy;
- public `GET https://api.anomaly-detector.ru/health/ready` returns
  `{"status":"ok"}`;
- `docker builder prune` reports no remaining unused build cache;
- root filesystem usage and free space are recorded for the release report.

Use
[`deploy/yandex/Caddyfile.example`](../deploy/yandex/Caddyfile.example) as the
source configuration: set `ANOMALY_WEBAPP_ROOT` and `ANOMALY_ADMIN_ROOT` to the
absolute directories that contain the deployed `webapp/dist` and
`adminapp/dist` contents. Set `ANOMALY_ADMIN_USER` and the Caddy-generated
`ANOMALY_ADMIN_PASSWORD_HASH` only in the Caddy process environment. Generate
the hash interactively with `caddy hash-password` so the plaintext is not added
to shell history. Validate with `caddy validate`, then reload Caddy. The file
owns the browser CSP, HSTS, clickjacking protection, content-type protection,
referrer policy, permissions policy, SPA fallbacks, operator Basic Auth, API
proxy, and `www` redirect. Keep these controls in the serving layer; HTML
`<meta>` tags are not an equivalent replacement.

Backend security events are emitted as single-line JSON with
`"channel":"security"`, a generated request ID, route, method, stable reason,
outcome, and timestamp. They intentionally exclude credentials, tokens,
realtime tickets, login names, and raw request bodies. Route these stdout
records into Cloud Logging and configure alerts at minimum for:

- any sustained `exceptional_condition` events;
- repeated `refresh_token_reused` events;
- repeated `realtime_ticket_issue_budget` events;
- sharp increases in `authentication_rejected`,
  `authorization_rejected`, or `PAYLOAD_TOO_LARGE`.

Retain the request ID in API responses and log search results so an incident can
be correlated without recording sensitive request data.

### Current Monitoring Baseline

The current single-VM production baseline sends Linux host and Unified Agent
health metrics to Yandex Monitoring through the
`anomaly-detector-monitoring` service account. The agent is pinned to the
installed release and its automatic latest-version installer is disabled so a
VM reboot cannot introduce an unreviewed agent update.

Operator dashboard:

- `Anomaly Detector — Production Operations`
- `https://monitoring.yandex.cloud/folders/b1gd0r9jgets6d8stahp/dashboards/anomaly-detector-production-operations`
- current live panels: root/PostgreSQL-volume free space, available/total RAM,
  VM CPU, load average, Unified Agent errors/lost metrics, and VM network
  receive/transmit rate.

Current alert:

- `P0: production disk space low`
- query: root filesystem free bytes from Unified Agent;
- `Warning` below `3,000,000,000` bytes;
- `Alarm` below `2,000,000,000` bytes;
- evaluation window `5m`, delay `30s`, and missing metric selector state
  `No data`.

The intended notification recipient is `support@anomaly-detector.ru`, but
Yandex Monitoring does not accept an arbitrary mailbox as an email-channel
recipient. The address must belong to a Yandex Cloud user that has at least the
`monitoring.viewer` role for this folder and has enabled Monitoring for email in
the account notification settings. Until that account is created or connected,
the alert remains visible in Monitoring but does not notify a person.

Do not treat the dashboard as the complete P0 observability contract yet. The
current application does not publish the following metrics, so truthful graphs
and alerts cannot be configured for them:

- API availability, `5xx` rate, and request latency;
- worker last successful cycle timestamp;
- overdue Tender count;
- container restart count;
- PostgreSQL connection count;
- WebSocket reconnect rate;
- auth throttling and exceptional security-event counts;
- active, completed, and early-finished match counts.

Close this gap with one operational metrics endpoint scraped by Unified Agent
in Prometheus format. Instrument the owning application and worker paths rather
than deriving business state from fragile log text. Caddy or the API request
boundary should own HTTP status/latency metrics; the worker health module should
own its last-success timestamps; the Tender persistence boundary should own
overdue and match-state counts; realtime should own reconnects; auth/security
events should increment stable reason-labelled counters. Add container and
PostgreSQL runtime collectors separately. Only then create the remaining
mandatory alerts: API unavailable, worker stale, growing `5xx`, and any overdue
Tender.

Deploy `webapp` and fully prerendered `website` output as static websites in Yandex Object Storage. Keep `adminapp` out of public website buckets: in the current VM topology Caddy serves it from the protected operator hostname. Once `website` uses SSR/on-demand rendering or Astro server islands, that surface needs an Astro adapter and must move to a Serverless Container runtime instead of static hosting. When server islands appear on cached pages or rolling deploys, generate a stable key with `astro create-key` and configure `ASTRO_KEY` as a secret in both build and runtime environments. Never commit it, expose it as `PUBLIC_*`, print it in logs, or bake it into static output.

Use shared CDN caching only for anonymous, public-equivalent website responses. Auth-dependent or personalized routes and server islands must use `private` or `no-store`, or a deliberately supported `Vary: Cookie`/`Authorization` strategy. `ASTRO_KEY` is not a cache privacy boundary.

Build locally or in CI:

```bash
VITE_API_URL=https://api.anomaly-detector.ru \
VITE_OAUTH_API_URL=https://api.anomaly-detector.ru \
bun run build:webapp
VITE_API_URL=https://api.anomaly-detector.ru bun run build:adminapp
PUBLIC_WEBSITE_URL=https://anomaly-detector.ru bun run build:website
```

The webapp and adminapp API values are embedded at build time and must point to the
Application Load Balancer custom host. `VITE_API_URL` owns ordinary requests;
`VITE_OAUTH_API_URL` owns the browser-visible OAuth start request. Rebuild after
either origin changes, then verify that the generated main JavaScript bundle
contains the production API origin for both paths and does not contain
`http://localhost:3000`.

`PUBLIC_WEBSITE_URL` is also embedded at build time and must be the public
canonical origin of the website; without it, the generated pages intentionally
omit canonical and `og:url` metadata. Add `PUBLIC_WEBAPP_URL` only when the
public website intentionally links to the authenticated webapp.

Before uploading, create a Yandex Object Storage static access key for a service account and configure the AWS CLI with it. Yandex's Object Storage docs recommend `aws configure` with the static key and `ru-central1` as the region.

```bash
aws configure
# AWS Access Key ID: <static access key id>
# AWS Secret Access Key: <static secret key>
# Default region name: ru-central1
```

Upload built assets to public website buckets:

```bash
aws --endpoint-url=https://storage.yandexcloud.net/ s3 cp --recursive webapp/dist/ s3://<webapp-bucket>/
aws --endpoint-url=https://storage.yandexcloud.net/ s3 cp --recursive website/dist/ s3://<website-bucket>/
```

Do not add `adminapp/dist` to these uploads. Copy it into the immutable VM release directory referenced by `ANOMALY_ADMIN_ROOT`, then verify that the operator hostname returns `401` without Basic Auth before testing application login.

Configure Object Storage static website hosting with `index.html` as the home page. For the React SPA, also use `index.html` as the error document or configure equivalent CDN routing so route refreshes do not break client-side routing.

Example website settings file:

```json
{
  "index": "index.html",
  "error": "index.html"
}
```

Apply it with:

```bash
yc storage bucket update --name <webapp-bucket> --website-settings-from-file <path-to-website-settings.json>
```

Object Storage static website hosting requires public read access to the bucket objects and object list. Do not put secrets in frontend build output or static website buckets.

## CDN And Domains

For production `webapp`, `website`, and public media, put Yandex Cloud CDN in front of Object Storage when the product needs lower latency, custom cache behavior, HTTPS/domain management, or protection controls.

Authenticated browser traffic needs custom webapp and API hosts under the same registrable domain, for example `app.example.com` and `api.example.com`. Point the API host only to the Application Load Balancer; do not expose the VM or backend ports directly.

Cloud CDN can use an Object Storage bucket as an origin. Create a CDN resource, attach the public domain, configure caching rules, and point DNS to the CDN load balancer with a `CNAME` record. Do not use `ANAME` for CDN distribution domains.

Use immutable asset filenames from Vite/Astro builds and long cache headers for hashed assets. Keep `index.html` cache short enough for releases to roll out quickly.

## Object Storage And Media

Yandex Object Storage is S3-compatible. Use it for durable uploads, generated files, public media, and downloadable assets.

Recommended production setup:

- One bucket per environment and purpose when practical, for example `<project>-prod-media`, `<project>-prod-webapp`, and `<project>-prod-website`.
- Use service-account static access keys for S3-compatible SDKs and upload tools.
- Use `https://storage.yandexcloud.net` as the Object Storage endpoint.
- Use `ru-central1` as the S3 SDK region unless the current Yandex docs say otherwise.
- Store public immutable media behind Cloud CDN.
- Keep private files private and serve them through short-lived presigned URLs after backend permission checks.
- Do not put emails, names, customer IDs, or sensitive data in bucket names, object keys, metadata, or tags.

The backend storage service in this template is S3-compatible but currently named around the DigitalOcean default. If Yandex Cloud is selected for production storage, configure a provider-specific storage pass before launch: make the S3 signing region/provider endpoint explicit, set a Yandex CDN/public base URL, and validate presigned PUT/GET behavior against Object Storage.

## Image Optimization

Yandex Object Storage and Cloud CDN store and deliver images. For image optimization:

- First consider Yandex Cloud Marketplace Image Resizer when the product only needs fixed-size variants generated after upload.
- For app-owned variants, generate thumbnails/responsive sizes in the backend, a worker, Cloud Functions, or a dedicated container, then store the generated files in Object Storage.
- For dynamic URL-based transformations, consider a dedicated Thumbor/imgproxy-style service and put Cloud CDN in front of it.
- Do not add image-processing dependencies or a dynamic image service until the product actually needs optimized variants.

## Validation

Before touching cloud resources, run the smallest relevant local checks for active surfaces:

```bash
bun run typecheck
bun run test
bun run build
```

After deployment:

- verify API `/health/live` and `/health/ready` through `https://api.<site-domain>` on the Application Load Balancer;
- verify worker `/health/live` and `/health/ready` from the private instance-group health-check path and confirm the worker port is unreachable from the public internet;
- verify browser auth only from allowed `CORS_ORIGINS`;
- verify all cookie-backed auth writes reject missing or untrusted browser `Origin` headers;
- verify the webapp and API use same-site custom domains and that a reload restores the cookie-backed session in a browser with third-party cookies blocked;
- verify through the Application Load Balancer that register returns `Set-Cookie`, refresh receives that cookie, `/me` receives the bearer `Authorization` header, logout clears the cookie, and the next refresh returns 401;
- verify Managed PostgreSQL connectivity and that Prisma migrations applied exactly once;
- verify the private maintenance cleanup timer is active and its most recent scheduled invocation completed with task exit code `0`;
- verify `webapp` route refreshes load the SPA fallback instead of a broken 404 page;
- verify `website` static assets load from the production domain;
- verify public media loads through the Cloud CDN domain when storage is active;
- verify private file links expire and require backend authorization when private storage is active.

## Current Upstream Documentation

- Yandex Cloud CLI quickstart: https://yandex.cloud/en/docs/cli/quickstart
- Yandex Cloud CLI reference: https://yandex.cloud/en/docs/cli/cli-ref/
- Compute Cloud Docker Compose: https://yandex.cloud/en/docs/compute/tutorials/docker-compose
- Compute instance groups: https://yandex.cloud/en/docs/compute/concepts/instance-groups/
- Instance group autohealing: https://yandex.cloud/en/docs/compute/concepts/instance-groups/autohealing
- Application Load Balancer: https://yandex.cloud/en/docs/application-load-balancer/
- Application Load Balancer route management and WebSocket: https://yandex.cloud/ru/docs/application-load-balancer/operations/manage-routes
- Serverless Containers task runtime: https://yandex.cloud/en/docs/serverless-containers/operations/update-runtime
- Serverless Containers timer trigger: https://yandex.cloud/en/docs/serverless-containers/operations/timer-create
- Smart Web Security Advanced Rate Limiter: https://yandex.cloud/en/docs/smartwebsecurity/concepts/arl
- Yandex Container Registry quickstart: https://yandex.cloud/en/docs/container-registry/quickstart
- Yandex Managed Service for PostgreSQL: https://yandex.cloud/en/docs/managed-postgresql/
- Managed PostgreSQL connection pre-configuration: https://yandex.cloud/en/docs/managed-postgresql/operations/connect/
- Yandex Managed Service for Valkey: https://yandex.cloud/en/docs/managed-redis/
- Connecting to a Yandex Valkey cluster: https://yandex.cloud/en/docs/managed-valkey/operations/connect/clients
- Yandex Object Storage: https://yandex.cloud/en/docs/storage/
- Object Storage static website hosting: https://yandex.cloud/en/docs/storage/operations/hosting/setup
- Object Storage AWS CLI: https://yandex.cloud/en/docs/storage/tools/aws-cli
- Uploading objects to Object Storage: https://yandex.cloud/en/docs/storage/operations/objects/upload
- Yandex Cloud CDN overview: https://yandex.cloud/en/docs/cdn/concepts/
- Yandex Monitoring dashboards: https://yandex.cloud/en/docs/monitoring/concepts/visualization/
- Yandex Monitoring alerts: https://yandex.cloud/en/docs/monitoring/concepts/alerting/alert
- Yandex Unified Agent: https://yandex.cloud/en/docs/monitoring/concepts/data-collection/unified-agent/
- Yandex Cloud Marketplace Image Resizer: https://yandex.cloud/en/marketplace/products/yc/image-resizer
- Thumbor on Yandex Cloud: https://yandex.cloud/en/docs/marketplace/tutorials/thumbor
