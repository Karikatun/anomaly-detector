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

`ADMIN_USER_IDS` is an optional comma-separated allowlist of immutable user UUIDs for the separate read-only operator application. Empty means that nobody has access. The backend returns the same `404 NOT_FOUND` to anonymous and ordinary authenticated users and does not publish the route in OpenAPI. Obtain an operator UUID from that user's profile and configure it only in backend runtime env; changing a login or display name does not change access. The separate Caddy-host is an additional edge boundary, not a replacement for this backend check.

`COOKIE_SECURE=false` is appropriate for local HTTP; production requires `COOKIE_SECURE=true` with exact HTTPS origins in `CORS_ORIGINS`. Production browser auth uses `SameSite=None; Secure` refresh cookies, so wildcard, empty, HTTP, or path-bearing CORS origins are invalid. Every cookie-backed auth write (`register`, `login`, `refresh`, and `logout`) also requires a trusted `Origin` in production cookie mode.

When enabling Yandex ID or VK ID, set both provider credentials and `OAUTH_CALLBACK_BASE_URL` to the public API origin, for example `https://api.example.com`. The server derives the provider callback as `/api/auth/oauth/<provider>/callback`; it never accepts a callback URL from the browser. The post-login `webappOrigin` must exactly match an origin in `CORS_ORIGINS`.

Auth writes are protected by `AUTH_BODY_LIMIT_BYTES` and a bounded in-process fixed-window limiter. `TRUST_PROXY=false` uses the direct Bun connection address. Behind a trusted proxy, set `TRUST_PROXY=true` together with the provider's authoritative `TRUSTED_PROXY_CLIENT_IP_HEADER`; use `TRUSTED_PROXY_CLIENT_IP_POSITION=last` only when the provider appends the client to a comma-separated chain. DigitalOcean App Platform uses `do-connecting-ip`; the documented Yandex Application Load Balancer path uses the first `X-Forwarded-For` value. Before horizontally scaling, keep shared PostgreSQL auth buckets and add an edge/WAF layer for request-rate protection.

`REFRESH_TOKEN_TTL_DAYS` is the sliding credential lifetime, while `SESSION_ABSOLUTE_TTL_DAYS` limits the total logical session lifetime. `REFRESH_REUSE_GRACE_SECONDS` tolerates a short concurrent refresh race; replaying the immediately previous credential after that window revokes the logical session. Keep the grace window short (the default is 10 seconds). Run `maintenance:cleanup` daily to delete revoked, sliding-expired, and absolute-expired rows after `SESSION_RETENTION_DAYS`; the same task removes expired abuse buckets, unfinished OAuth transactions, one-time realtime tickets, and waiting rooms older than 24 hours. `auth:sessions:cleanup` remains a backwards-compatible alias for the same maintenance task.

DigitalOcean Spaces env is optional. Leave `SPACES_*` blank until the product needs uploads, media, exports, or downloads. When storage is active, configure the complete Spaces group in `backend/.env` and follow [../docs/STORAGE.md](../docs/STORAGE.md).

## Runtime Entrypoints

The backend is one workspace with one Prisma schema and one Dockerfile, but it has separate runtime entrypoints:

- API: `bun run start:api`, backed by `src/index.ts`.
- Worker: `bun run start:worker`, backed by `src/worker.ts`. It is the only owner of polling schedules for due Tender phases and scheduled Room starts. `bun run dev` starts both API and worker locally; production runs them as separate processes. The worker serves internal `/health/live` and `/health/ready` endpoints on `WORKER_HEALTH_PORT` or `PORT + 1`; readiness requires recent successful passes from both polling loops.
- Cron: `bun run start:cron -- <task>`, backed by `src/cron.ts`. Available tasks are `noop`, `db:ping`, `maintenance:cleanup`, and the backwards-compatible `auth:sessions:cleanup` alias.

All entrypoints use `src/runtime.ts` for env loading, Prisma creation, and cleanup, so backend services can be shared without duplicating Prisma schema or database setup.

Primary keys use database-generated UUIDv7 values in PostgreSQL (`@default(dbgenerated("uuidv7()")) @db.Uuid`). Use UUIDv7 consistently for new primary keys and foreign-key references that point at them; do not introduce new `cuid()`, `uuid()`, `serial`, or `bigserial` IDs into this template. PostgreSQL 18+ is required anywhere the backend schema is applied so IDs are generated consistently through Prisma, raw SQL, imports, and future non-Prisma writers.

## Deployment

Production deployment for the backend uses DigitalOcean App Platform with DigitalOcean Managed PostgreSQL by default. Follow the shared runbook in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) instead of duplicating provider-specific steps here. The root `bun run deploy:do:specs` command generates concrete App Platform specs safely under `.scratch/deploy`; do not hand-substitute secrets or URLs into specs. If the user explicitly chooses Yandex Cloud, use [../docs/YANDEX_CLOUD.md](../docs/YANDEX_CLOUD.md).

## Auth API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/token/register`
- `POST /api/auth/token/login`
- `POST /api/auth/token/refresh`
- `POST /api/auth/token/logout`
- `GET /openapi.json`
- `GET /health/live`
- `GET /health/ready`

Личная игровая статистика доступна авторизованному пользователю через `GET /api/profile/statistics`. Сервер рассчитывает её по завершённым совместимым партиям и журналу принятых игровых действий; формулы закреплены в [../docs/GAME_DESIGN_BRIEF.md](../docs/GAME_DESIGN_BRIEF.md).

Passwords are hashed through `Bun.password` with Argon2id. Access tokens are short-lived JWTs through `jose`. Initial refresh tokens are random; rotated successors are opaque, domain-separated HMAC values derived with the server secret so concurrent uses of the same credential receive the same successor. Only current and immediately previous SHA-256 hashes are stored in the database. Refresh atomically rotates the credential inside the same logical session, so another browser tab's still-valid access token is not revoked. Reuse of the previous credential after the short race-tolerance window revokes that session as potentially compromised.

## Architecture

`src/index.ts` only starts the API server. `src/runtime.ts` loads env and creates the Prisma client for API, worker, and cron entrypoints. `src/app.ts` is the composition root. Product contexts live under `src/modules/<context>` and expose only `index.ts` across context boundaries. Auth is the golden path: `transport` owns Hono/HTTP, `application` owns use cases and ports, optional `domain` code stays pure, and `infrastructure` owns Prisma and token/password adapters. Route factories capture dependencies in closures; request context contains only the authenticated principal. Run `bun run architecture:check` to enforce these dependency rules. `src/db.ts` normalizes DigitalOcean Managed PostgreSQL URLs that use `sslmode=require` so the Prisma PostgreSQL adapter uses libpq-compatible TLS handling.

The storage service lives in `src/storage` and wraps DigitalOcean Spaces through S3-compatible SDK calls. Product-specific upload routes should validate ownership and permissions, then delegate object key generation, presigned upload/download URLs, public CDN URL construction, and deletion to that service.

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
- [DigitalOcean Spaces docs](https://docs.digitalocean.com/products/spaces/)
- [DigitalOcean Spaces CDN docs](https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/)
