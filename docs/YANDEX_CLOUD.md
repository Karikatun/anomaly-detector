# Yandex Cloud Production

Anomaly Detector uses this runbook for its Russian public test and production
environment. The first release validates the Public MVP Journey; begin with a
controlled cohort before expanding acquisition, even though the public landing is
indexable.

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

## Public Hosts

Current pre-migration routing:

- Webapp: `https://anomaly-detector.ru`.
- API and WebSocket: `https://api.anomaly-detector.ru`.
- Redirect only: `https://www.anomaly-detector.ru` to `https://anomaly-detector.ru`.
- Support: `support@anomaly-detector.ru`; do not publish legal/support pages until
  inbound and outbound delivery has been verified.

Approved Production MVP routing from ADR 0014:

- Public website: `https://anomaly-detector.ru`.
- Player webapp: `https://app.anomaly-detector.ru`.
- API and WebSocket: `https://api.anomaly-detector.ru`.
- Operator app: `https://ops.anomaly-detector.ru`.
- Redirect only: `https://www.anomaly-detector.ru` to the public website.

Do not treat the target map as already deployed. Move it in one release with
address-specific redirects for old player routes and coordinated DNS/TLS, CDN,
CORS, OAuth callback/post-login origin, cookies, CSP, legal links, monitoring
and rollback. Verify authentication and the old deep links before switching
DNS.

The versioned Caddy and runtime examples are prepared for this target map, but
production remains on the pre-migration map until the owner completes the
coordinated cutover and verification. Do not reload only one prepared component.

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

Use `backend/Dockerfile` from the monorepo root as the Docker build path.

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

The worker readiness endpoint stays unavailable until every configured loop completes
successfully: the two deadline loops always run, and transactional mail adds a third loop
only when SMTP is enabled. It becomes unavailable after a loop error or stale heartbeat
and recovers after the next successful pass.

Production env must include:

```bash
NODE_ENV=production
PORT=3000
WORKER_HEALTH_PORT=3001
DATABASE_URL=postgresql://...
JWT_SECRET=<64-or-more-hex-characters>
ADMIN_USER_IDS=<comma-separated-operator-user-uuids>
CORS_ORIGINS=https://app.anomaly-detector.ru,https://ops.anomaly-detector.ru
WEBAPP_ORIGIN=https://app.anomaly-detector.ru
ANALYTICS_ENABLED=false
ANALYTICS_ORIGINS=
ANALYTICS_CAMPAIGN_ALLOWLIST=
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

ADR 0013 count overrides are optional. Omitting them keeps these versioned
defaults and fixed windows; do not tune them without production evidence:

```bash
ANTI_ABUSE_LOGIN_FAILURE_LIMIT=5              # 15 minutes
ANTI_ABUSE_LOGIN_IP_LIMIT=30                  # 15 minutes
ANTI_ABUSE_REGISTRATION_DEVICE_LIMIT=3        # 180 days
ANTI_ABUSE_REGISTRATION_IP_LIMIT=20           # 1 day
ANTI_ABUSE_RECOVERY_EMAIL_MINUTE_LIMIT=1
ANTI_ABUSE_RECOVERY_EMAIL_HOUR_LIMIT=3
ANTI_ABUSE_RECOVERY_EMAIL_DAY_LIMIT=5
ANTI_ABUSE_RECOVERY_EMAIL_IP_HOUR_LIMIT=20
ANTI_ABUSE_RECOVERY_LOGIN_HOUR_LIMIT=3
ANTI_ABUSE_RECOVERY_LOGIN_DAY_LIMIT=5
ANTI_ABUSE_RECOVERY_LOGIN_IP_HOUR_LIMIT=10
ANTI_ABUSE_RECOVERY_LOGIN_IP_DAY_LIMIT=30
ANTI_ABUSE_AUTHENTICATED_MUTATION_LIMIT=120   # 1 minute
ANTI_ABUSE_ROOM_JOIN_LIMIT=20                 # 1 minute
ANTI_ABUSE_TENDER_COMMAND_LIMIT=60            # 1 minute
ANTI_ABUSE_REALTIME_TICKET_LIMIT=10           # 1 minute
```

Recovery Email minute/hour/day settings apply independently to the account and
canonical address; its IP setting is hourly. Recovery-login settings are shared
by password-recovery requests and Recovery Code checks, with independent login
and trusted-IP hour/day buckets. Recovery Email hour, day and IP-hour limits
must be at least `2`, because one replacement reserves messages for both the
old and new address; the other limits may start at `1`. Values greater than
`1_000_000` fail startup. Budget keys are domain-separated HMACs under
`JWT_SECRET`, never raw login/email values. A coordinated `JWT_SECRET` rotation
moves every budget into a fresh HMAC namespace, including the 180-day
registration-device and recovery day windows, and separately changes JWT/token
cryptography. Treat it as a security rollout with explicit compatibility and
recovery evidence; never rotate the auth secret merely to clear budgets.

For the first release that converts the legacy unkeyed SHA-256 keys of the
one-minute Room, Tender, authenticated-mutation and realtime budgets to HMAC,
do not run old and new API revisions at the same time. Stop every old API
process, wait at least 60 seconds for the longest affected legacy window, and
only then start the new revision. Rollback uses the same stop, wait and start
sequence in reverse. PostgreSQL cannot translate the existing rows because the
raw identity was intentionally never stored; overlapping revisions would use
two independent namespaces and temporarily double those allowances. Record the
controlled downtime and the 60-second drain in release and rollback evidence.

Recovery Email has not yet been released to production. Before its first
cutover, verify that no active bucket from an older cost model exists:

```sql
SELECT count(*)
FROM auth_abuse_buckets
WHERE scope LIKE 'rec_email_%'
  AND expires_at > now();
```

The expected count is `0`. If it is not zero, stop the release and design a
conservative migration or wait for those windows to expire. Do not mix the old
replacement cost with the new rule: one replacement atomically charges two
messages against the account hour/day and trusted-IP hour budgets.

Do not roll back to an intermediate image that exposes Recovery Email
replacement while charging those shared budgets only once per command. It
remains incompatible after active rows expire because every later replacement
would again undercount its two messages. Roll forward to a compatible image, or
block the complete `/api/auth/account-protection/recovery-email/*` contour at
the trusted ingress until a compatible revision is available. The original
pre-feature production image is an acceptable rollback target only after
verifying that these routes are absent. Record the route check and selected
rollback target in the release evidence.

This is the split-domain target configuration. Until the coordinated cutover,
the active production `WEBAPP_ORIGIN` and player entry in `CORS_ORIGINS` remain
the current root origin. `WEBAPP_ORIGIN` is mandatory in production, must be an
origin-only HTTPS URL, and must also appear in `CORS_ORIGINS`.

Keep `ANALYTICS_ENABLED=false` and both client build flags absent until issues
#2 and #31 close the legal-copy and split-domain gates. After approval, set
`ANALYTICS_ORIGINS=https://anomaly-detector.ru,https://app.anomaly-detector.ru`
and only safe reviewed slugs in `ANALYTICS_CAMPAIGN_ALLOWLIST`. The public root
must remain absent from general `CORS_ORIGINS`: it receives credentialed CORS
only on `/api/analytics/*`, while auth and operator routes continue to reject it.

When Yandex ID is enabled, keep the provider callback on the API host while the
post-login destination comes from `WEBAPP_ORIGIN`:

```bash
YANDEX_OAUTH_CLIENT_ID=<Lockbox-backed-client-id>
YANDEX_OAUTH_CLIENT_SECRET=<Lockbox-backed-client-secret>
OAUTH_CALLBACK_BASE_URL=https://api.anomaly-detector.ru
```

Register
`https://api.anomaly-detector.ru/api/auth/oauth/yandex/callback` at Yandex. The
domain split does not move this provider callback to either browser host.

In the Yandex OAuth application, grant access to the email address. The backend
requests the `login:email` scope and reads `default_email` from the bounded user
information response. Before public release, complete a real provider roundtrip
and verify all of the following on the exact release image:

- the consent screen grants email access and Yandex returns `default_email`;
- each Yandex sign-in refreshes the provider attribute while the immutable
  provider subject remains the only account identity;
- the profile shows only a masked address and application logs contain neither
  the address nor the provider response payload;
- an occupied canonical address produces the non-disclosing conflict state but
  does not block sign-in or merge accounts.

The published mail-service policy supplies only service-specific alias rules.
An unlisted Yandex address remains a provider attribute with an exact local part
and lowercase/IDNA domain, but is not thereby approved for local recovery
delivery. Do not add global dot removal, plus-tag stripping, or local-part case
folding.

Leave `ADMIN_USER_IDS` empty to disable the operator surface. When enabled, use immutable user UUIDs from the intended operators' profiles. The current implementation is read-only; the approved MVP adds only the audited commands listed in ADR 0011. Build and serve `adminapp` only from the separately protected `ops.anomaly-detector.ru` host; never include it in the player `webapp` output. Backend authorization and identical `404` responses remain mandatory behind the edge check.

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

Before provisioning, validate the Compose definition without printing a resolved secret-bearing
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
and `VITE_OAUTH_API_URL`. Before ADR 0014 migration, the webapp origin is
`https://anomaly-detector.ru`; after the coordinated migration it is
`https://app.anomaly-detector.ru`. The public root remains excluded from general
credentialed `CORS_ORIGINS`. Once issue #2 and #31 approve production analytics,
list it only in `ANALYTICS_ORIGINS`; the composition root applies that allowlist
exclusively to `/api/analytics/*`. Never enable credentialed wildcard CORS.

### Edge abuse-protection profile

Application budgets remain authoritative across API instances. Their versioned
defaults are listed with the optional runtime overrides above; this includes
auth and recovery, Room joins, Tender commands, authenticated mutations and
realtime-ticket issuance. The one-minute gameplay/generic budgets are keyed by
user for Room join, authenticated mutation and realtime ticket, and by user plus
Tender for Tender commands. Edge rules complement these PostgreSQL budgets;
they must reject abusive traffic before authentication or other expensive
application work and must not replace application authorization.

Create separate Smart Web Security and Advanced Rate Limiter rules for these
traffic classes instead of one global threshold:

| Traffic | Edge key and action | Required exception or check |
| --- | --- | --- |
| Password registration | trusted client address; observe, then limit or challenge | preserve legitimate shared-NAT registration and the application device/IP quotas |
| Password login | trusted client address; observe, then limit or challenge | do not reveal whether a login exists; benchmark Argon2id before setting the enforcement threshold |
| Refresh, logout, and OAuth start/callback | route-specific address budget | preserve normal multi-tab refresh races and allow the exact configured OAuth callback |
| General JSON API | trusted client address with a deliberately wider budget | use API protection rather than an HTML captcha response; do not add route-level limits to ordinary authenticated GET/polling without load evidence |
| `/api/realtime/tickets` | trusted client address plus the application user budget | preserve normal reconnect while bounding ticket churn |
| `/api/realtime/ws` handshake | trusted client address, including missing, malformed, expired, or used tickets | use API protection or a stable rejection; never return captcha HTML to a WebSocket client |
| `/health/live` and `/health/ready` | separate rule for the load-balancer health-check source | do not let public traffic consume the health-check allowance; worker health remains private |

Do not guess enforcement thresholds from the application budgets. Start every
edge rule in logging or observe-only mode, record normal browser login, shared
NAT, multi-tab refresh, mobile reconnect, and a complete 2–4-player Tender, then
set the narrowest threshold that preserves those flows with a documented burst.
Move one traffic class at a time to enforcement.

Before enforcement, verify all of the following without logging credentials,
cookies, authorization headers, room codes, or request bodies:

1. A request from a known external address has the same actual client address in
   Application Load Balancer/Smart Web Security evidence and in the backend's
   trusted-address handling; the proxy address must not become the budget key.
2. Bursts distributed across at least two API instances still receive stable
   application `429 RATE_LIMITED` responses with `Retry-After` when the
   PostgreSQL budget is reached.
3. Shared NAT, supported browsers, multi-tab refresh, mobile reconnect, and a
   complete Tender stay below both application and edge thresholds.
4. Room-code enumeration, Tender-command bursts, registration races, and valid
   or invalid WebSocket-ticket churn are rejected before sustained expensive
   work, with visible metrics and redacted security events.
5. Health checks remain available during abusive API traffic, and ordinary
   authenticated reads do not consume the application mutation budget.

Alert separately on edge rejects/challenges and application
`room_join_budget`, `tender_command_budget`,
`authenticated_mutation_budget`, and `realtime_ticket_issue_budget` events.
Record the rule owner, observation window, chosen thresholds, false-positive
response, and rollback command in the release evidence. Roll back a faulty rule
to observe-only mode; do not weaken the PostgreSQL budgets during recovery.

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

## Transactional Mailbox

The approved recovery flow uses a separate
`no-reply@anomaly-detector.ru` mailbox at REG.RU with
`Reply-To: support@anomaly-detector.ru`. The runtime implements the protected SMTP
adapter and PostgreSQL outbox, but keeps delivery disabled by default. Before enabling
it in production:

1. configure the exact SMTP host, TLS mode and credentials through production
   secrets and version every new env key in code, examples and this runbook;
2. verify SPF, DKIM and DMARC plus actual receipt at every Approved Mail Service;
3. drain a PostgreSQL transactional outbox through the existing worker with
   bounded retries, idempotent message identity and terminal failure state;
4. expose only aggregate SMTP acceptance/failure and outbox age to adminapp;
   do not log addresses, templates containing secrets, codes or reset URLs;
5. keep verification, recovery and security notices separate from support,
   marketing and gameplay messages;
6. document secret rotation, provider outage, circuit breaker, backlog recovery
   and rollback before production enablement.

Use these versioned settings. Obtain the exact host, port and TLS mode from the active
REG.RU mailbox instead of copying an unverified example. Only `implicit_tls` and
`starttls` are accepted; certificate verification and TLS 1.2 or newer are mandatory.
`MAIL_SMTP_LEASE_SECONDS` must be strictly greater than
`MAIL_SMTP_TIMEOUT_MS / 1000`, so a second worker cannot reclaim a message while
the first SMTP attempt is still waiting for its bounded response.

```bash
MAIL_SMTP_ENABLED=true
MAIL_SMTP_HOST=<verified-REG.RU-SMTP-hostname>
MAIL_SMTP_PORT=<verified-port>
MAIL_SMTP_TLS_MODE=<implicit_tls-or-starttls>
MAIL_SMTP_USERNAME=no-reply@anomaly-detector.ru
MAIL_SMTP_PASSWORD=<Lockbox-backed-secret>
MAIL_SMTP_FROM=no-reply@anomaly-detector.ru
MAIL_SMTP_REPLY_TO=support@anomaly-detector.ru
MAIL_SMTP_TIMEOUT_MS=10000
MAIL_SMTP_MAX_ATTEMPTS=5
MAIL_SMTP_RETRY_BASE_SECONDS=30
MAIL_SMTP_CIRCUIT_FAILURE_THRESHOLD=5
MAIL_SMTP_CIRCUIT_OPEN_SECONDS=300
MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE=60
MAIL_SMTP_LEASE_SECONDS=60
MAIL_SMTP_WORKER_INTERVAL_MS=1000
MAIL_OUTBOX_RETENTION_DAYS=30
```

The API and worker receive the same non-secret tuning values. Only the worker needs the
SMTP credential at runtime; keep it out of API/static-client environments when the
deployment mechanism can scope secrets per process. SMTP acceptance is recorded as
`Принято SMTP`, never as final inbox delivery. A response lost after `DATA` is an
ambiguous outcome: retry keeps one logical outbox row and a stable `Message-ID`, but SMTP
cannot guarantee that the recipient will never see a duplicate. Confirmation and reset
operations must therefore remain replay-safe when the same message is received twice.
The logical-request fingerprint is a domain-separated HMAC under the backend secret,
so a stored fingerprint cannot be used to brute-force a short confirmation code.
Queued and leased rows retain the recipient and template payload while awaiting
delivery. Credential mail becomes ineligible at its template `expiresAt`, and a
security notification becomes ineligible after seven days in the outbox. The worker
checks the deadlines immediately before starting SMTP delivery and terminalises an
overdue claimed row; the daily cleanup terminalises and redacts any remaining overdue
queued or leased row within the next 24 hours. SMTP-accepted and other terminal-failure
rows immediately replace recipient and payload with redacted values;
only safe operational metadata and attempt outcomes remain until terminal retention
removes the row. An SMTP request that started before its deadline may finish after a
concurrent cleanup, but its stale lease cannot overwrite the terminal database state,
and an expired credential remains unusable. Owner cancellation immediately redacts a
still-queued credential message. If the worker already leased it, the current outbox
contract allows the attempt and configured retries to continue only until the original
delivery deadline; the cancelled credential is already unusable, and terminal handling
or deadline cleanup redacts the row.

For provider outage or suspected credential compromise, set `MAIL_SMTP_ENABLED=false`
and restart only the worker. Queued rows remain in PostgreSQL. Rotate the credential in
Lockbox, verify TLS and a controlled message under issue #36, then re-enable the worker;
the global circuit breaker releases one probe after its cooldown before normal draining.
If backlog age or terminal failures keep growing, leave delivery disabled and diagnose
the provider/configuration rather than increasing retries. Do not extend credential
expiry or the seven-day security-notification limit to drain a backlog. Rollback uses
the previous immutable API/worker image after applying only backward-compatible
migrations; do not manually delete queued rows. The named retention cleanup applies
the deadlines and later removes terminal rows. Recovery and pending-mail cleanup is
one PostgreSQL transaction; it retries that whole unit at most three times only for
transaction conflicts (`P2034`, `40P01`, `40001`) and otherwise fails the cron task for
operator investigation.

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

Production must run `maintenance:cleanup` daily; setting retention values alone does not delete rows. The task removes stale sessions, expired login and registration anti-abuse buckets, unfinished OAuth transactions, one-time realtime tickets after their TTL, waiting rooms older than 24 hours, expired Feedback Reports (180 days for `new`/`in_review`, 30 days after terminal or transferred status), expired 30-day analytics journeys with their raw events, analytics daily aggregates older than 13 months, expired recovery challenges and reset credentials, pending credential mail at its own `expiresAt`, security notifications pending for seven days, and accepted or terminal mail outbox rows older than `MAIL_OUTBOX_RETENTION_DAYS`. A two-sided Recovery Email replacement keeps its still-valid side and redacts only the expired side's code derivative; the row is removed when both sides expire. Pending-mail redaction and recovery cleanup run in one PostgreSQL transaction. `auth:sessions:cleanup` remains a backwards-compatible alias for existing deployments. Use a separate private Serverless Container from the same immutable backend image in **task** runtime mode. This keeps the public API process monolithic while giving the timer a one-shot command that exits non-zero on failure.

`MAIL_OUTBOX_RETENTION_DAYS` defaults to 30 and is schema-bounded to at most 30.
That value is the terminal-metadata deletion-eligibility deadline; the next daily
cleanup removes eligible rows, so normal operation adds at most a 24-hour technical
window. Increasing the eligibility period requires a code and legal-policy change.

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
  --environment DATABASE_URL='<production_database_url>',JWT_SECRET='<production_jwt_secret>',CORS_ORIGINS=https://app.anomaly-detector.ru,WEBAPP_ORIGIN=https://app.anomaly-detector.ru,COOKIE_SECURE=true,SESSION_ABSOLUTE_TTL_DAYS=90,SESSION_RETENTION_DAYS=7,MAIL_OUTBOX_RETENTION_DAYS=30
```

Configure the cleanup revision with the same production `DATABASE_URL`, `JWT_SECRET`, session and outbox retention, network, and Lockbox policy as the API revision. It does not need SMTP credentials. Prefer Lockbox or the console instead of putting real secrets into shell history. Do not make the cleanup container public.

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

After deployment, invoke the private cleanup container once with an IAM token and verify HTTP 200 plus `X-Task-Exit-Code: 0`. Then confirm `yc serverless trigger get --name <project>-maintenance-cleanup-daily` reports an active trigger. After the first scheduled window, inspect the cleanup container's invocation logs and require a recent `Cron maintenance:cleanup removed ... stale sessions, ... expired waiting rooms; cleaned ... expired recovery artifacts and ... expired pending mail records; removed ... terminal mail outbox records, ... expired analytics aggregates.` entry; absence of a recent successful entry is an operational failure, not proof that there were zero stale records.

## Real-Time Pub/Sub

Keep the Yandex deployment path monolithic by default: the API container should own HTTP routes, auth, persistence, and WebSocket endpoints, while the worker is only a second process for authoritative deadlines. Do not split chat, notifications, or presence into microservices unless the product has a concrete operational reason.

When the backend runs as one container instance, WebSocket connection state can
stay inside that process. The current realtime hub detects committed Tender
changes from another API instance by re-reading each active authorized view
once per second. This provides eventual recovery during controlled transition
checks, but adds approximately one PostgreSQL view-read per socket per second;
do not treat it as the horizontally scaled production target.

Before adding API replicas with WebSocket traffic, record the active-socket and
PostgreSQL capacity baseline. Each backend instance should then publish compact
domain events to Valkey and subscribe to the channels it needs to deliver them
to local connections, or adopt another grouped fanout backed by equivalent
evidence. Keep Valkey out of baseline local setup and ordinary request/response
APIs.

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

### Host Security Audits

The lifecycle, cadence, and interpretation rules for Lynis, ssh-audit, Trivy,
perimeter, application, and recovery checks live in
[AUDIT_GUIDE.md](AUDIT_GUIDE.md). For the current single-VM baseline:

- run the primary ssh-audit externally against the actual public endpoint and
  review Yandex Security Groups separately; a localhost result does not prove
  the public boundary;
- run Lynis after substantial host/OS changes and on the documented periodic
  cadence, but triage findings individually instead of treating Hardening Index
  as a pass/fail security score;
- scan the exact immutable backend release image through the repository Trivy
  runner and compare the deployed API/worker image ID or digest with that
  artifact;
- never run ssh-audit `--dheat`, ZAP, load attacks, automatic hardening, package
  installation, or firewall/SSH/sysctl remediation against production without
  explicit approval and a recovery plan.

Production audit starts read-only. Record tool version, target, time, sanitized
result, coverage gaps, remediation owner, and rollback implications without
copying host details, credentials, keys, tokens, cookies, or private data into
ordinary logs or issues.

After a release has passed container-internal and public health checks, finish
the release with an explicit cleanup step. First resolve and record the active
and immediate-rollback Compose, image, release-directory, volume, and backup
references. Retain exactly two application backend images on the VM:

- the image used by the active Compose configuration;
- the immediately preceding image referenced by the retained rollback Compose
  configuration.

Remove only explicitly listed inactive resources:

- `anomaly-detector-backend:<commit>` images older than the active and
  immediate-rollback images;
- release directories older than the current and immediate-rollback release;
- dangling images and unused Docker build cache;
- unused non-data Docker volumes only after `docker volume inspect` confirms
  their purpose and `docker ps -a --filter volume=<volume>` confirms that no
  container references them.

Keep the active PostgreSQL and Caddy images, the PostgreSQL data volume, every
volume referenced by the active or rollback Compose configuration, the current
and rollback Compose files, the corresponding release directories, and the
latest pre-migration database dump. Never delete an unknown or data-bearing
volume merely because Docker reports it as unused. Delete disposable volumes
only by exact name; do not use `docker volume prune` or a broad
`docker system prune --volumes`.

After cleanup, require all of the following:

- both retained backend image references pass `docker image inspect`;
- every retained active/rollback volume passes `docker volume inspect`, and the
  PostgreSQL volume identity is unchanged;
- API, worker, and PostgreSQL containers remain healthy;
- public `GET https://api.anomaly-detector.ru/health/ready` returns
  `{"status":"ok"}`;
- `docker builder prune` reports no remaining unused build cache;
- root filesystem usage and free space are recorded for the release report.

Use
[`deploy/yandex/Caddyfile.example`](../deploy/yandex/Caddyfile.example) as the
source configuration: set `ANOMALY_WEBSITE_ROOT`, `ANOMALY_WEBAPP_ROOT`, and
`ANOMALY_ADMIN_ROOT` to separate absolute directories that contain the deployed
`website/dist`, `webapp/dist`, and `adminapp/dist` contents. Set
`ANOMALY_ADMIN_USER` and the Caddy-generated
`ANOMALY_ADMIN_PASSWORD_HASH` only in the Caddy process environment. Generate
the hash interactively with `caddy hash-password` so the plaintext is not added
to shell history. When Caddy receives this environment through Docker Compose,
declare the Caddy `env_file` entry with `format: raw` and store the bcrypt hash
with its original single `$` characters. Do not escape them as `$$`: a later
container recreation can otherwise change the value and reject the correct
Basic Auth password. Validate with `caddy validate`, then reload Caddy. The file
owns the browser CSP, HSTS, clickjacking protection, content-type protection,
referrer policy, permissions policy, the player-only SPA fallback, operator
Basic Auth, API proxy, and `www` redirect. The public root has no SPA fallback:
unknown paths return `404`. Only the fixed legacy player route families in the
file redirect to `https://app.anomaly-detector.ru` with their path and query.
They remain `temporary` with `Cache-Control: no-store` while immediate rollback
is open so a browser cannot retain a root → app redirect that would loop with
app → root rollback. The player host carries an `X-Robots-Tag` noindex policy.
Keep these controls in the serving layer; HTML `<meta>` tags are not an
equivalent replacement.

### Split-domain cutover and rollback

Treat the domain split as one release boundary. Before switching traffic:

1. retain the active Caddy file, backend env key names, static directories and
   checksums as the immediate rollback set;
2. stage the exact-release `website/dist`, `webapp/dist`, and `adminapp/dist` in
   separate immutable directories and verify that public artifacts contain no
   configured localhost/test endpoints, secrets, operator output, or private
   player data; review the documented TanStack `http://localhost` fallback
   literal separately;
3. make TLS and DNS for `app.anomaly-detector.ru` ready without changing the
   public root, then validate the prepared Caddy file against the staged paths;
4. during the controlled cutover, make the player host reachable, update the
   backend to `WEBAPP_ORIGIN=https://app.anomaly-detector.ru` and transitional
   exact CORS origins, switch the public root to `website`, then remove the old
   root from CORS so the steady state is only player plus operator origins;
5. verify fixed legacy redirects are temporary/non-cacheable and preserve URI,
   unknown-root `404`, player SPA reload,
   `www`, crawler policy, password auth, cookie refresh/logout, WebSocket
   reconnect, and both OAuth success/error returns before declaring success.

An OAuth callback started against the previous player origin is rejected before
its transaction is consumed or a session/account is created. During cutover,
treat that bounded `auth_error` as a safe retry signal; never accept the stale
origin merely to finish an in-flight provider round trip.

Rollback is coordinated in the reverse direction: restore the retained Caddy
file and root player artifact together with the previous `WEBAPP_ORIGIN` and
`CORS_ORIGINS`, reload API/Caddy, then prove root login, refresh, logout, OAuth
return, deep-link reload, API readiness, and unchanged PostgreSQL volume
identity. The split adds no migration; do not touch PostgreSQL or delete the
staged release while the rollback decision is open.

[`deploy/yandex/Caddyfile.split-domain-rollback.example`](../deploy/yandex/Caddyfile.split-domain-rollback.example)
is the versioned immediate-rollback shape: it restores the player SPA and
noindex policy on the root, keeps API/operator boundaries, and temporarily
returns requests from the staged app host to the root with path/query intact and
without caching. The target's matching no-store temporary redirects are part of
this recovery contract. Promote them to permanent only as a separate
owner-controlled Caddy change after the rollback window is explicitly closed.
It is a template for the retained pre-cutover roots and values, not evidence
that the live Caddy file or static checksums were captured.

Request-bound backend security events are emitted as single-line JSON with
`"channel":"security"`, a generated request ID, route, method, stable reason,
outcome, and timestamp. They intentionally exclude credentials, tokens,
realtime tickets, login names, and raw request bodies. Route these stdout
records into Cloud Logging and configure alerts at minimum for:

- any sustained `exceptional_condition` events;
- repeated `refresh_token_reused` events;
- repeated `realtime_ticket_issue_budget` events;
- any `mail_delivery_protection_activated` event with reason
  `delivery_budget_exhausted` or `delivery_circuit_open`;
- sharp increases in `authentication_rejected`,
  `authorization_rejected`, or `PAYLOAD_TOO_LARGE`.

Retain the request ID in API responses and log search results so an incident can
be correlated without recording sensitive request data.

The mail worker persists each transition once in PostgreSQL and uses an exclusive
lease so active workers do not claim the same row concurrently. Delivery to the log
sink is at least once: a crash after log emission but before PostgreSQL acknowledgement
may repeat the event. The record contains only channel, type, stable reason,
occurrence time and `transitionAt`; downstream routing must deduplicate by reason plus
`transitionAt`. Acknowledged rows older than 30 days are pruned lazily on a later
transition, while pending rows remain durable. During a continuously unavailable
sink, delivery-budget transitions can add at most one pending row per minute;
production needs a pending-age/cardinality alarm
or an explicitly accepted finite dead-letter policy before that becomes a capacity
risk. This local implementation has not been deployed. Its thresholds have not been
tuned under production load, and no Yandex Monitoring rule or notification channel
has been configured for it.

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
- transactional-mail protection-transition counts;
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
VITE_BUILD_SHA=<exact-40-character-release-sha> \
VITE_PUBLIC_LEGAL_OPERATOR_NAME='<public operator name>' \
VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT='<public operator name in dative case>' \
VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS='<public address for legal requests>' \
VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE='<approved Russian publication date>' \
bun run --cwd webapp build:release
VITE_API_URL=https://api.anomaly-detector.ru bun run build:adminapp
PUBLIC_WEBSITE_URL=https://anomaly-detector.ru \
PUBLIC_WEBAPP_URL=https://app.anomaly-detector.ru \
bun run build:website:release
```

The webapp and adminapp API values are embedded at build time and must point to the
Application Load Balancer custom host. `VITE_API_URL` owns ordinary requests;
`VITE_OAUTH_API_URL` owns the browser-visible OAuth start request.
`VITE_BUILD_SHA` must be the exact lowercase 40-character release commit and is
included only as safe technical context when a player submits a Feedback Report;
omit it rather than substituting a branch, short SHA or mutable tag.
`VITE_PUBLIC_LEGAL_OPERATOR_NAME`, `VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT`,
`VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS`, and
`VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE` are required for a webapp production
build; they render into the public legal pages, so they are not secrets. The date
must be the owner/legal-approved effective date for the exact published revisions,
not the build date guessed by automation. Store the actual values only in the
deployment environment, not in Git. Rebuild after either origin or legal value
changes, then verify that the generated main JavaScript bundle
contains the production API origin for both paths and does not contain
`http://localhost:3000`.

`PUBLIC_WEBSITE_URL` is embedded at build time and must be the public
canonical origin of the website; without it, the generated pages intentionally
omit canonical and `og:url` metadata. `PUBLIC_WEBAPP_URL` is the exact player
app origin used by the landing CTA and legal links; it must be set for a
production website build.

Before creating owner-supplied release artifacts, run
`bun run preflight:split-domain`. It builds test-only legal fixtures in an
isolated temporary directory, verifies them, and removes them automatically;
build owner artifacts separately afterward with the approved legal values and
exact release SHA shown above.

For the prepared ADR 0014 target, `PUBLIC_WEBSITE_URL` remains
`https://anomaly-detector.ru` and `PUBLIC_WEBAPP_URL` is exactly
`https://app.anomaly-detector.ru`. These build values do not prove that the
target routing is already deployed.

The prepared `build:release` guards reject all client analytics flags so an
ambient shell or `.env.production` cannot enable collection accidentally. Only
after issues #2 and #31 are accepted, change those guards and their tests in a
separate reviewed release, then add `VITE_ANALYTICS_ENABLED=true` to the complete
webapp command and enable the website client in the same exact-SHA release:

```bash
PUBLIC_WEBSITE_URL=https://anomaly-detector.ru \
PUBLIC_WEBAPP_URL=https://app.anomaly-detector.ru \
PUBLIC_ANALYTICS_API_URL=https://api.anomaly-detector.ru \
PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST='<reviewed-safe-slugs>' \
bun run build:website:release
```

Omitting these client variables is the supported disabled state: the landing
contains no consent panel or analytics script, the player client sends no funnel
event, and the backend routes remain absent while `ANALYTICS_ENABLED=false`.
Before activation verify consent, refusal and revoke in a real browser; confirm
the 30-day HttpOnly cookie is absent before consent and deleted on revoke; prove
the public origin cannot call auth/operator routes; run `analytics:cleanup`; and
check that the operator view exposes only 7/30/90-day aggregates.

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

The backend storage service is S3-compatible and configured through `YANDEX_STORAGE_*`. Before enabling production storage, set the Yandex signing region and provider endpoint explicitly, configure the CDN/public base URL when needed, and validate presigned PUT/GET behavior against Object Storage.

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
- verify `WEBAPP_ORIGIN` is the exact player origin, the public root is absent
  from CORS, and browser-supplied OAuth return origins other than the player
  origin are rejected;
- verify all cookie-backed auth writes reject missing or untrusted browser `Origin` headers;
- verify the webapp and API use same-site custom domains and that a reload restores the cookie-backed session in a browser with third-party cookies blocked;
- verify through the Application Load Balancer that register returns `Set-Cookie`, refresh receives that cookie, `/me` receives the bearer `Authorization` header, logout clears the cookie, and the next refresh returns 401;
- verify Managed PostgreSQL connectivity and that Prisma migrations applied exactly once;
- verify the private maintenance cleanup timer is active and its most recent scheduled invocation completed with task exit code `0`;
- verify `webapp` route refreshes load the SPA fallback instead of a broken 404 page;
- verify `website` static assets load from the public root, an unknown public
  path returns `404`, fixed legacy player routes redirect to the player host,
  and `www` redirects to the public root;
- verify the player host returns `X-Robots-Tag: noindex, nofollow, noarchive`
  while public canonical, robots, and sitemap values contain no player or
  operator surfaces;
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
- Smart Web Security rules: https://yandex.cloud/ru/docs/smartwebsecurity/concepts/rules
- Smart Web Security logging: https://yandex.cloud/en/docs/smartwebsecurity/operations/configure-logging
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
