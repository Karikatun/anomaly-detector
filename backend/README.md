# Backend

The backend owns the API, authentication, integrations, persistence, and server-side business logic. Web and mobile clients rely on the shared data contract in `packages/contracts`.

## Stack

- Bun
- Hono
- Prisma 7
- PostgreSQL
- Zod
- jose JWT
- TypeScript

## Commands

Run these from the repository root:

```bash
docker compose version
docker info
docker compose pull postgres
docker compose up -d postgres
cp backend/.env.example backend/.env
bun run --cwd backend dev
bun run --cwd backend typecheck
bun run --cwd backend test
bun run --cwd backend test:unit
bun run --cwd backend test:integration
bun run --cwd backend start:api
bun run --cwd backend start:worker
bun run --cwd backend start:cron -- noop
bun run --cwd backend smoke:docker
bun run --cwd backend prisma:validate
bun run --cwd backend prisma:generate
bun run --cwd backend prisma:migrate
bun run --cwd backend prisma:deploy
```

On Windows PowerShell, use `Copy-Item backend/.env.example backend/.env` instead of `cp`. Workspace aliases are also available from the repository root: `bun run dev:backend`, `bun run build:backend`, `bun run typecheck:backend`, and `bun run test:backend`.

`bun run test:integration` starts `postgres_test` from `../docker-compose.yml`, applies Prisma migrations to `anomaly_detector_test`, and runs DB-backed auth, operator-access, Room, Tender, and realtime tests. If Docker is managed separately, set `TEST_SKIP_DOCKER=1` and `TEST_DATABASE_URL`. The test database name must end with `_test` unless `TEST_ALLOW_NON_TEST_DATABASE=1` is set intentionally.

`bun run smoke:docker` builds the backend Docker image, starts it against `postgres_test`, waits for `/health/ready`, and removes only the smoke container it created.

## Env

Copy `backend/.env.example` to `backend/.env` for local development. The example `DATABASE_URL` matches the Docker Compose `postgres` service documented in [../docs/LOCAL_DATABASE.md](../docs/LOCAL_DATABASE.md): database `anomaly_detector`, user `superuser`, password `superpassword`, host port `54329`.

`bun run dev` performs a port preflight before starting the API and worker. It gracefully stops stale listeners owned by this backend workspace on `PORT` and `WORKER_HEALTH_PORT` (defaults `3000` and `3001`). It refuses to stop a listener whose process belongs to another workspace, so a port collision remains visible instead of terminating an unrelated application.

The example `TEST_DATABASE_URL` matches the Docker Compose `postgres_test` service: database `anomaly_detector_test`, user `superuser`, password `superpassword`, manual host port `54330`. Automated runners may replace the port with a repository-derived value so parallel checkouts do not collide.

Keep an explicit username and password in Prisma connection URLs even on local native PostgreSQL installs. Peer-auth style URLs without a user can make Prisma schema-engine commands such as `migrate dev`, `migrate deploy`, and `db push` fail with an unhelpful generic engine error.

`JWT_SECRET` must be at least 32 characters locally. Production accepts the 64-or-more-character hexadecimal output of `openssl rand -hex 32`; do not use the `.env.example` placeholder, repeated characters, or human phrases.

`ADMIN_USER_IDS` is an optional comma-separated allowlist of immutable user UUIDs for the separate operator application. Empty means that nobody has access. The backend returns the same `404 NOT_FOUND` to anonymous and ordinary authenticated users and does not publish operator routes in OpenAPI. Obtain an operator UUID from that user's profile and configure it only in backend runtime env; changing a login or display name does not change access. The separate Caddy-host is an additional edge boundary, not a replacement for this backend check.

The operator overview remains read-only. Approved Mail Service policy has the only currently implemented mutation surface: `GET /api/operations/mail-policy` reads its safe projection, while `/import`, `/publish`, and `/status` accept narrow audited commands. Import never publishes automatically. Every command requires a recent authenticated session, an allowlisted operator UUID, an optimistic version precondition, and an idempotent `commandId`; source or suspicious-removal failure retains the last-known-good policy.

`COOKIE_SECURE=false` is appropriate for local HTTP; production requires `COOKIE_SECURE=true` with exact HTTPS origins in `CORS_ORIGINS`. Production also requires `WEBAPP_ORIGIN`: one origin-only HTTPS URL for the player application, included in `CORS_ORIGINS`. Production browser auth uses `SameSite=None; Secure` refresh cookies, so wildcard, empty, HTTP, or path-bearing CORS origins are invalid. Every cookie-backed auth write (`register`, `login`, `refresh`, and `logout`) also requires a trusted `Origin` in production cookie mode.

When enabling Yandex ID or VK ID, set both provider credentials and `OAUTH_CALLBACK_BASE_URL` to the public API origin, for example `https://api.example.com`. The server derives the provider callback as `/api/auth/oauth/<provider>/callback`; it never accepts a callback URL from the browser. The browser-supplied post-login `webappOrigin` must exactly match `WEBAPP_ORIGIN`; another CORS-allowed surface such as the operator app cannot become an OAuth return target. The Yandex application must grant email-address access: the backend requests `login:email`, validates the bounded `default_email` response, and synchronises it on every Yandex sign-in. The immutable provider subject remains the identity. Matching email never links or merges accounts, and a conflict does not block the already-linked Yandex sign-in. Only the masked protection projection is returned to the player.

Auth writes are protected by `AUTH_BODY_LIMIT_BYTES` and a bounded in-process fixed-window limiter. `TRUST_PROXY=false` uses the direct Bun connection address. Behind the documented Yandex Application Load Balancer path, set `TRUST_PROXY=true`, use `x-forwarded-for` as `TRUSTED_PROXY_CLIENT_IP_HEADER`, and select the first value. Before horizontally scaling, keep shared PostgreSQL auth buckets and add an edge/WAF layer for request-rate protection.

`REFRESH_TOKEN_TTL_DAYS` is the sliding credential lifetime, while `SESSION_ABSOLUTE_TTL_DAYS` limits the total logical session lifetime. `REFRESH_REUSE_GRACE_SECONDS` tolerates a short concurrent refresh race; replaying the immediately previous credential after that window revokes the logical session. Keep the grace window short (the default is 10 seconds). Run `maintenance:cleanup` daily to delete revoked, sliding-expired, and absolute-expired rows after `SESSION_RETENTION_DAYS`; the same task removes expired abuse buckets, unfinished OAuth transactions, one-time realtime tickets, and waiting rooms older than 24 hours. `auth:sessions:cleanup` remains a backwards-compatible alias for the same maintenance task.

Yandex Object Storage env is optional. Leave `YANDEX_STORAGE_*` blank until the product needs uploads, media, exports, or downloads. When storage is active, configure the complete group in `backend/.env` and follow [../docs/STORAGE.md](../docs/STORAGE.md).

## Runtime Entrypoints

The backend is one workspace with one Prisma schema and one Dockerfile, but it has separate runtime entrypoints:

- API: `bun run start:api`, backed by `src/index.ts`.
- Worker: `bun run start:worker`, backed by `src/worker.ts`. It is the only owner of polling schedules for due Tender phases, scheduled Room starts, and the PostgreSQL transactional-mail outbox. `bun run dev` starts both API and worker locally; production runs them as separate processes. The worker serves internal `/health/live` and `/health/ready` endpoints on `WORKER_HEALTH_PORT` or `PORT + 1`; readiness requires recent successful passes from the two base loops and, when SMTP is enabled, the mail-delivery loop.
- Cron: `bun run start:cron -- <task>`, backed by `src/cron.ts`. Available tasks are `noop`, `db:ping`, `maintenance:cleanup`, and the backwards-compatible `auth:sessions:cleanup` alias.

All entrypoints use `src/runtime.ts` for env loading, Prisma creation, and cleanup, so backend services can be shared without duplicating Prisma schema or database setup.

Primary keys use database-generated UUIDv7 values in PostgreSQL (`@default(dbgenerated("uuidv7()")) @db.Uuid`). Use UUIDv7 consistently for new primary keys and foreign-key references that point at them; do not introduce new `cuid()`, `uuid()`, `serial`, or `bigserial` IDs into this repository. PostgreSQL 18+ is required anywhere the backend schema is applied so IDs are generated consistently through Prisma, raw SQL, imports, and future non-Prisma writers.

## Deployment

Production deployment uses Yandex Cloud. Start with the shared [release entrypoint](../docs/DEPLOYMENT.md) and follow [the Yandex Cloud runbook](../docs/YANDEX_CLOUD.md).

## Auth API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `GET /api/auth/account-protection`
- `POST /api/auth/account-protection/recovery-email/start`
- `POST /api/auth/account-protection/recovery-email/resend`
- `POST /api/auth/account-protection/recovery-email/confirm`
- `POST /api/auth/account-protection/recovery-email/cancel`
- `POST /api/auth/account-protection/recovery-email/replacement/start`
- `POST /api/auth/account-protection/recovery-email/replacement/resend`
- `POST /api/auth/account-protection/recovery-email/replacement/confirm`
- `POST /api/auth/account-protection/recovery-email/replacement/cancel`
- `POST /api/auth/logout`
- `POST /api/auth/token/register`
- `POST /api/auth/token/login`
- `POST /api/auth/token/refresh`
- `POST /api/auth/token/logout`
- `GET /openapi.json`
- `GET /health/live`
- `GET /health/ready`

The remaining approved but not yet implemented Public MVP extensions are specified in
ADRs 0005–0016 and [the MVP plan](../docs/MVP_IMPLEMENTATION_PLAN.md). They add
user-held Recovery Code, password reset, consent-scoped funnel analytics and
Feedback Report intake. Do not add env keys or advertise endpoints in this
README until their implementation and contracts exist; when they do, document
every new key here, in `.env.example`, the Yandex runbook and production setup
without exposing values.

`GET /api/auth/account-protection` exposes only the current account's bounded
protection state. A Yandex-managed address is masked by the server; conflict and
unavailable states contain no address. The full provider value and the separate
canonical uniqueness key remain private persistence fields. Domains are
lowercased and IDNA-normalised. Dot, plus-tag, and local-part case rules are
applied only from the published service policy; an unlisted Yandex address is
still retained as a provider attribute without inventing alias rules or making
it eligible for local recovery delivery.

A password account can voluntarily start its first Recovery Email protection
through the four recovery-email commands above. The first request verifies the
current password and a published Approved Mail Service policy, sends a 15-minute
code with at most five confirmation attempts, and activates only after a
24-hour cooling-off period. Only sessions that existed when the request was
created may cancel it; cancellation revokes newer sessions. The API returns only
the masked address and bounded state. The full provider value, canonical key,
HMAC code derivative and HMAC abuse-budget keys remain private persistence
fields. Yandex-managed accounts cannot enter this password flow.

An active Recovery Email is replaced only after the owner re-enters the current
password and independently confirms 15-minute codes sent to the old and new
masked addresses. Each factor has its own five-attempt counter and resend
identity. The old binding remains authoritative until one PostgreSQL transaction
verifies both factors, rechecks the current Approved Mail Service policy and
uniqueness, updates the binding, revokes every other session, clears outstanding
Recovery Email challenges and queues a security notification. `deprecated`
services remain valid for delivery to the old address but cannot become the new
binding; `blocked` services fail closed. Only the initiating session can manage
or abandon a pending replacement, and no support/operator override exists.

The `mail` context now exposes a narrow internal requester for exactly three
templates: Account Email confirmation, password recovery and security
notification. Callers create it from the owning Prisma transaction; the module
does not expose an unbound requester, so the product state change and logical
mail request commit or roll back together. The existing worker drains the
request through the protected REG.RU SMTP adapter. Delivery remains
disabled by default. Confirmation codes are derived only at delivery from a
domain-separated HMAC and are never stored in the outbox payload. Logical
request fingerprints are keyed HMAC values, and
accepted or terminal rows immediately redact the recipient and secret-bearing
template payload. `MAIL_SMTP_ENABLED`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`,
`MAIL_SMTP_TLS_MODE`, `MAIL_SMTP_USERNAME`, `MAIL_SMTP_PASSWORD`,
`MAIL_SMTP_FROM`, `MAIL_SMTP_REPLY_TO`, `MAIL_SMTP_TIMEOUT_MS`,
`MAIL_SMTP_MAX_ATTEMPTS`, `MAIL_SMTP_RETRY_BASE_SECONDS`,
`MAIL_SMTP_CIRCUIT_FAILURE_THRESHOLD`, `MAIL_SMTP_CIRCUIT_OPEN_SECONDS`,
`MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE`, `MAIL_SMTP_LEASE_SECONDS`,
`MAIL_SMTP_WORKER_INTERVAL_MS` and `MAIL_OUTBOX_RETENTION_DAYS` are documented
with safe empty/default values in `.env.example`; production secret placement,
verification and recovery procedures live in the Yandex runbook. The configured
lease must be longer than the SMTP timeout.

Личная игровая статистика доступна авторизованному пользователю через `GET /api/profile/statistics`. Сервер рассчитывает её по завершённым совместимым партиям и журналу принятых игровых действий; формулы закреплены в [../docs/GAME_DESIGN_BRIEF.md](../docs/GAME_DESIGN_BRIEF.md).

Passwords are hashed through `Bun.password` with Argon2id. Access tokens are short-lived JWTs through `jose`. Initial refresh tokens are random; rotated successors are opaque, domain-separated HMAC values derived with the server secret so concurrent uses of the same credential receive the same successor. Only current and immediately previous SHA-256 hashes are stored in the database. Refresh atomically rotates the credential inside the same logical session, so another browser tab's still-valid access token is not revoked. Reuse of the previous credential after the short race-tolerance window revokes that session as potentially compromised.

## Architecture

`src/index.ts` only starts the API server. `src/runtime.ts` loads env and creates the Prisma client for API, worker, and cron entrypoints. `src/app.ts` is the composition root. Product contexts live under `src/modules/<context>` and expose only `index.ts` across context boundaries. Auth is the golden path: `transport` owns Hono/HTTP, `application` owns use cases and ports, optional `domain` code stays pure, and `infrastructure` owns Prisma and token/password adapters. Route factories capture dependencies in closures; request context contains only the authenticated principal. Run `bun run architecture:check` to enforce these dependency rules. `src/db.ts` normalizes managed PostgreSQL URLs that use `sslmode=require` so the Prisma PostgreSQL adapter uses libpq-compatible TLS handling.

The storage service lives in `src/storage` and wraps Yandex Object Storage through S3-compatible SDK calls. Product-specific upload routes should validate ownership and permissions, then delegate object key generation, presigned upload/download URLs, public CDN URL construction, and deletion to that service.

Prisma migration SQL is not written by hand. Change `prisma/schema.prisma`, then run `bun run prisma:migrate`.

## Current Upstream Documentation

For backend framework, ORM, auth, validation, and runtime questions, consult the current upstream documentation linked here first. This README describes this backend's conventions; upstream docs are authoritative for API behavior.

- [Bun docs](https://bun.sh/docs)
- [Hono docs](https://hono.dev/docs)
- [Hono Zod OpenAPI example](https://hono.dev/examples/zod-openapi)
- [Prisma docs](https://www.prisma.io/docs)
- [Prisma migrations](https://www.prisma.io/docs/orm/prisma-migrate)
- [PostgreSQL docs](https://www.postgresql.org/docs/)
- [Zod docs](https://zod.dev/)
- [jose documentation](https://github.com/panva/jose)
- [Docker Compose docs](https://docs.docker.com/compose/)
- [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- [Yandex Object Storage docs](https://yandex.cloud/en/docs/storage/)
- [Yandex Object Storage S3 API](https://yandex.cloud/en/docs/storage/s3/)
