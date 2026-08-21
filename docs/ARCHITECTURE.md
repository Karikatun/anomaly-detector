# Product Modules Architecture

Anomaly Detector uses shared contracts, a modular-monolith backend, one player CSR browser app (`webapp`), one isolated operator CSR app (`adminapp`), and one Astro static public site (`website`). The operator app is read-only by default and exposes only explicitly listed audited commands for mail policy and Feedback Report workflow. The runnable mobile app lives on the `mobile` branch and extends the same product contracts when mobile work is active.

The approach is **progressive DDD-lite**. Product contexts get explicit ownership and dependency direction without forcing every context to have every layer. Add a `domain` directory only when the feature has real policies, calculations, or state transitions. Do not add empty layers, generic/base repositories, CQRS, event sourcing, or extra services as architecture decoration.

## Contracts

`packages/contracts` is the source of truth for API payloads, DTOs, and error shapes. New endpoints should start with Zod schemas in contracts. The backend then uses those schemas for request validation, while browser consumers use them in their narrow API clients.

Do not hand-copy API shapes into clients. When a contract changes, validate producer and consumers in one pass: backend route/service and webapp API client/form. On the `mobile` branch, include the mobile API client/form in that same pass.

## Backend

Backend product contexts live under `src/modules/<context>` and follow this flow:

```text
transport -> application -> domain/ports -> infrastructure -> DTO
```

- `src/index.ts` is the API runtime entrypoint.
- `src/worker.ts` is the long-running worker entrypoint. It owns polling schedules for due Tender advancement and scheduled Room starts; the product modules expose one-shot operations and do not create runtime timers.
- `src/cron.ts` is the one-shot scheduled-job entrypoint. Add concrete tasks to its registry and deploy scheduled jobs only for named product tasks.
- `src/runtime.ts` owns shared env loading, Prisma creation, and runtime cleanup for all backend entrypoints.
- `src/app.ts` is the composition root. It owns the Hono app, CORS, secure headers, error handling, module construction, route mounting, and OpenAPI output.
- `src/env.ts` validates environment variables with Zod.
- `src/db.ts` creates the Prisma client.
- `src/modules/auth/index.ts` is the auth module's public boundary and golden path. Its route factory captures dependencies in closures; request context contains only the authenticated principal.

Backend module ownership:

```text
modules/<context>/
  index.ts          # only cross-context import boundary
  transport/        # Hono, HTTP validation and representation
  application/      # use cases, permissions, transactions, orchestration
  domain/           # optional pure policies, transitions and calculations
  infrastructure/   # Prisma and external provider adapters
```

Transport must not import Prisma. Application and domain must not import Hono, Prisma, environment configuration, or provider SDKs. Infrastructure implements context-specific ports; repositories expose product operations rather than generic CRUD. Cross-context collaboration goes through public `index.ts` APIs or explicit application ports such as auth's `ProjectUser` and `LogoutCleanup`, never through another context's internals.

Tender owns the meaning of its persisted state and audit events. Profile receives
completed-match summaries through its `CompletedTenderSummaryReader`; Room
receives participant-specific phase, ruleset, completion, and forfeit state
through its `TenderLifecycleReader`. The implementations are composed from the
Tender persistence boundary in `src/app.ts`. Profile and Room must not query or
decode Tender JSON state or audit payloads directly.

Tender's public `index.ts` is a composition boundary: it selects the in-memory
or Prisma adapter and exports transport/realtime entry points, but owns no game
rules. Command and timeout orchestration lives in the application service and
depends only on `TenderStore` plus callback/clock/seed ports. Stable policy
blocks live in `domain/` (access-slot resolution, Contract eligibility, phase
timing, scoring and winner resolution), while participant/audit/read-model
projection lives in application projection modules. Policy tests import neither
Prisma, Hono nor realtime code.

Production source dependencies must remain acyclic. Transport and realtime
depend on the application-owned `TenderModule` port, never on their context's
public index. `bun run architecture:check` builds the production import graph
(excluding tests and generated clients), rejects cycles and Tender self-imports,
and prevents Profile/Room from reading Tender Prisma models directly.

Room's application service accepts a complete `RoomRepository` contract plus
required identity, placement, Tender lifecycle and clock ports. Production
capabilities are never optional to simplify a test double: the in-memory test
adapter and Prisma adapter pass the same repository contract suite. Prisma Room
queries share one members include and one `toRoomRecord` projection, so adding a
field or changing serialization has a single infrastructure owner. The injected
clock owns both `serverTime` and scheduled-start calculations.

Routes stay thin and translate HTTP into application calls and application failures into the stable API error shape. Do not put business rules into Hono handlers, UI clients, or child components.

For the approved Public MVP Journey, ownership is split by policy rather than by
screen:

- `auth` owns Account Email uniqueness, Yandex ID email synchronisation,
  Recovery Email state, password reset, Recovery Code, sessions and recovery
  anti-abuse policy;
- a transactional-mail context owns Approved Mail Service versions,
  provider-specific canonicalisation, operator publication commands, outbox and
  the REG.RU delivery adapter; auth requests messages through a narrow port and
  never imports the SMTP provider;
- an analytics context owns consent-scoped journey events, retention and
  aggregate projections; it never consumes security telemetry as product data;
- a feedback context owns Feedback Report intake, retention and operator
  workflow; it never publishes directly to GitHub or reuses Account Email;
- the admin context authorises the operator and composes safe projections, but
  does not become a generic CRUD owner for auth, mail, analytics or feedback.

These are target boundaries for the MVP slices. The Approved Mail Service policy
is implemented in the `mail` module; the other contexts are created only when
their vertical slice is implemented. The ADRs do not justify empty folders or
placeholder services.

## Runtime Shape And Real-Time

The default runtime shape is a modular monolith: one backend codebase, one database, shared contracts, and clear feature boundaries inside the repository. The backend can expose separate API, worker, and cron entrypoints while still sharing Prisma schema, env validation, services, and contracts. Do not add queues, brokers, or extra infrastructure until the product has a concrete need that the monolith cannot meet clearly.

The current production baseline is a Yandex Cloud VM running separate API and worker containers from the same immutable backend image, plus PostgreSQL and Caddy. The target managed topology and migration conditions are documented in [YANDEX_CLOUD.md](YANDEX_CLOUD.md). Keep API, worker, and cron as entrypoints of the same backend workspace; add infrastructure only for a concrete runtime need. Transactional email uses a PostgreSQL outbox drained by the existing worker runtime rather than a new service. Named cron cleanup removes expired recovery credentials, consent-scoped analytics events, feedback content and terminal outbox records according to their owning retention policies.

Tender phase delivery starts in the same backend service. A single instance can keep an in-memory registry of its own WebSocket connections. Once the backend runs multiple instances, in-memory fanout is no longer enough: participants in one Tender may connect to different instances. At that point, add managed Redis-compatible Pub/Sub so each instance can publish compact domain-event identifiers and deliver them to its local sockets.

Use Yandex Managed Service for Valkey only when horizontal scaling and cross-instance WebSocket delivery are actually required; it is not part of the current single-VM baseline or local setup.

Valkey Pub/Sub is only a fanout mechanism. Keep durable Tender state and audit-relevant events in PostgreSQL, publish compact event identifiers only after commits, and make clients recover by reconnecting and refetching the authorized API view after missed realtime messages.

## Auth

Auth v1 is custom JWT-based auth:

- Passwords use `Bun.password.hash/verify` with Argon2id.
- Access tokens are short-lived JWTs signed and verified with `jose`.
- Refresh tokens are opaque random tokens; only the current and immediately previous SHA-256 hashes are stored in PostgreSQL.
- Browser routes under `/api/auth/*` keep the refresh token only in an HttpOnly cookie and never return it in JSON. Local HTTP uses `SameSite=Lax`; HTTPS production uses `Secure` and `SameSite=None` so browser auth works across separate webapp/API origins.
- Native routes under `/api/auth/token/*` never read or set cookies and explicitly exchange refresh tokens in JSON/body payloads. The `mobile` branch stores those tokens through its native adapter.

Refresh-token rotation updates the credential atomically inside one logical session, preserving already-issued access tokens for other tabs. The immediately previous refresh credential is accepted only during a short race-tolerance window; replay after that window revokes the session as potentially compromised. `/api/auth/me` checks both the JWT and the active database session, including its absolute lifetime.

The approved recovery extension keeps email separate from identity. Yandex ID's
provider subject is immutable and matching email never merges accounts. New
password-account email, replacement and reset are separate atomic operations
with hashed one-time credentials, distributed attempt budgets, explicit expiry
and session revocation. Support and operator routes have no capability to set an
Account Email or bypass a recovery factor.

## Frontend

The browser surfaces have explicit product roles. `website` is the public, indexable Astro site on `anomaly-detector.ru`. `webapp` is the interactive player application on `app.anomaly-detector.ru` and owns authentication, profile, rooms, Tender, tutorial, history, rules, feedback and legal routes. `adminapp` is a separately built operator surface on `ops.anomaly-detector.ru`, protected at the edge and again by backend allowlisting; it must never be published as part of the player or public website. The current deployment still serves webapp from the root host until the coordinated migration in ADR 0014 is released.

The webapp follows these client rules:

- TanStack Query owns server state.
- TanStack Form owns form state.
- Zod schemas come from `@anomaly-detector/contracts`.
- `src/platform/api` owns endpoint-agnostic fetch, base URL handling, response parsing, and the shared API error.
- `src/features/<context>` owns endpoint paths, schemas, server-state adapters, providers, and product UI for that context.
- Routes and `src/main.tsx` are thin composition files and import features through their public `index.ts`. Lazy route components may use explicit `features/<context>/public/*` entry points so unrelated screens do not collapse into one browser chunk.
- `src/components/ui` and `src/platform` never import product features. Features may use platform code and UI primitives; cross-feature imports must use the target feature's public index.

### Client Interaction State Ownership

Server-authoritative workflows must keep four kinds of state distinct:

1. **Server view**: the latest authorized representation returned by the API.
   TanStack Query owns its cache and invalidation.
2. **Local selection**: reversible input that exists only in the current form or
   component until the user explicitly saves or submits it.
3. **Server draft**: mutable work persisted by the backend but not yet final,
   scored, revealed, or treated as a submitted action.
4. **Accepted command result**: an action the authoritative backend has applied
   and exposed through a newer server view or an explicit stable receipt.

Components must not describe a local request completion as server acceptance.
When a request has an ambiguous outcome, refetch the authoritative view and
determine whether the command's result is present before offering a retry. A
retry must not create an accidental duplicate action.

The owning feature coordinates the command lifecycle:

```text
ready -> submitting -> accepted
                    -> validation error
                    -> conflict -> refetch -> ready or accepted
                    -> connection loss -> reconnect -> refetch -> recovered
                    -> deadline -> refetch -> authoritative timeout result
```

- Pages and phase shells compose status, navigation, and feature panels; they do
  not duplicate business rules already owned by contracts or the backend.
- Feature panels own reversible selection and presentation-specific state. They
  do not repair an invalid upstream server view with fallback business logic.
- Shared hooks may encapsulate transport and recovery mechanics, but must not
  become universal service locators or hide product decisions.
- Realtime messages accelerate invalidation and delivery. They are not a second
  source of truth; reconnect recovery always refetches the authorized API view.
- During reconnect or an unresolved command outcome, commands that could spend
  resources or finalize a choice stay disabled. Read-only exploration may remain
  available when it cannot expose stale or private information incorrectly.
- A mode change does not save, clear, or submit a consequential selection unless
  the product explicitly defines and communicates that behavior.

The Tender page follows the humble-object boundary: React owns composition,
refs and visual overlay state, while command exclusivity, resume eligibility,
turn-focus decisions and stale-error visibility live in a pure page controller.
The completed-match component renders a pure audit presentation model for
ranking, winners and rating entries. These seams are tested without mounting
the full page; realtime and multiplayer recovery remain protected by E2E.

New i18n messages use semantic keys that name feature, state and role (for
example, `tender.completed.summary.title`). Existing `*.copy.NNN` keys form a
frozen allowlist in the i18n source audit and are renamed only when their owning
screen is changed. The audit rejects any new numeric catalog key, so the legacy
baseline can decrease but cannot grow.

Tender is the reference implementation for this contract: the server owns
hidden state, deadlines, ruleset selection, validation, scoring, and phase
advancement; the client owns only authorized presentation and reversible input.
Use the state matrix in [UX_CHECKLIST.md](UX_CHECKLIST.md) when changing such a
flow.

Auth in `src/features/auth` is the client golden path: its API adapter owns auth endpoints and refresh/retry, its provider exposes only auth behavior, and pages never receive a universal API service locator. Future providers should receive narrow context APIs such as `BillingApi` or `NotificationsApi` from composition.

Do not create a new form, query, auth, or API abstraction until the existing pattern stops solving the current problem.

`website` prerenders to static HTML by default. Keep the landing and other anonymous public content static until a real request-specific requirement justifies an Astro runtime adapter. SEO-critical content must be present in initial HTML, including title, description, canonical URL, social preview metadata, and the actual public product copy. The public site does not own player authentication or duplicate interactive game flows from `webapp`.

The website sends the visitor to the app with a bounded tutorial continuation
intent. It may count unrelated aggregate views without client identity. A
30-day first-party journey identifier and cross-surface funnel events require a
separate affirmative analytics choice; refusal is a fully supported path. The
password-reset page loads neither this analytics client nor third-party
resources.

If a future website route needs authenticated or personalized data, define its privacy and caching contract before implementation. Shared CDN caching is only for anonymous, public-equivalent HTML; personalized responses use `private` or `no-store` unless a reviewed `Vary` strategy proves otherwise.

## Testing

Backend unit/integration tests verify contracts and auth behavior at the owning layer. Webapp E2E uses Playwright and starts a real backend + Vite through `webServer`. Mobile E2E lives on the `mobile` branch.

Client E2E protects valuable cross-layer player journeys and representative recovery states; it is not the place for exhaustive validation matrices. Keep negative payloads, password/JWT/session rules, concurrency, and stable error-shape checks in contract, unit, or backend integration tests.

Run `bun run architecture:check` as part of every validation ladder. The dependency-free checker reports forbidden static imports as `path:line`, has fixture tests for each rule family, and runs in CI. File length is deliberately not an architecture rule; ownership and dependency direction are.

## Prisma

Do not hand-write Prisma migration SQL. Change `backend/prisma/schema.prisma`, then use:

```bash
bun run --cwd backend prisma:migrate
```

The repository uses database-generated UUIDv7 primary keys (`@default(dbgenerated("uuidv7()")) @db.Uuid`) instead of ORM-generated `cuid()`/`uuid()`. That keeps ID generation consistent for Prisma Client, direct SQL, imports, and background workers, but it also means the schema requires PostgreSQL 18+.

Treat UUIDv7 as a repository-level rule, not a one-off model detail. New primary keys should use database-generated UUIDv7, and foreign keys that reference those IDs should use `@db.Uuid` so the type stays native all the way through PostgreSQL and Prisma.

For production, apply already-created migrations:

```bash
bun run --cwd backend prisma:deploy
```

## Local Infrastructure

Local PostgreSQL is provided by Docker Compose, not by a native database install. The development service uses `postgres:18-alpine`, exposes `anomaly_detector` on host port `54329`, and stores data in the `postgres_18_data` volume. The test service uses the same image with database `anomaly_detector_test`; automated runners set `POSTGRES_TEST_PORT` to a repository-derived port when they need isolation. PostgreSQL 18 is intentional here because the backend schema relies on the native `uuidv7()` database function.

Keep `docker-compose.yml`, `backend/.env.example`, `.env.example`, and [LOCAL_DATABASE.md](LOCAL_DATABASE.md) aligned when changing local database names, ports, credentials, image tags, or volume paths.

## Storage

Persistent files and media belong in Yandex Object Storage, not in an application container filesystem. The backend owns storage access through `src/storage`, including safe object keys, presigned uploads/downloads, public CDN URL construction, and object deletion. Product features that use uploads store ownership and retention metadata in PostgreSQL when permissions, deletion, audit, or private access matter. Detailed provider and security decisions live in [STORAGE.md](STORAGE.md) and [YANDEX_CLOUD.md](YANDEX_CLOUD.md).

For image optimization, generate app-owned variants in the backend, a worker, or a dedicated bounded job, then store those variants in Object Storage and serve public variants through the configured CDN.

## Current Upstream Documentation

For framework and API questions, consult the current upstream documentation linked here first. This document describes repository conventions; upstream docs are authoritative for tool behavior.

The following resources are non-normative engineering references. Use them to
name and compare an already-observed design problem, not as a checklist that
requires introducing every pattern or abstraction:

- [Martin Fowler](https://martinfowler.com/) for discovering relevant material
  about architecture, refactoring, delivery, and software design. A specific
  article may influence a project decision only after it has been read in full
  and checked against the current problem and repository constraints. The
  reviewed shortlist, project applications, and limitations live in
  [ENGINEERING_REFERENCES.md](ENGINEERING_REFERENCES.md).
- [Patterns.dev](https://www.patterns.dev/) for JavaScript, React, rendering,
  and performance patterns.
- [Catalog of Refactorings](https://refactoring.com/catalog/) for established
  refactoring vocabulary.

- [Bun docs](https://bun.sh/docs)
- [Hono docs](https://hono.dev/docs)
- [Hono Zod OpenAPI example](https://hono.dev/examples/zod-openapi)
- [Prisma docs](https://www.prisma.io/docs)
- [PostgreSQL docs](https://www.postgresql.org/docs/)
- [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- [Yandex Object Storage docs](https://yandex.cloud/en/docs/storage/)
- [Yandex Managed Service for Valkey docs](https://yandex.cloud/en/docs/managed-redis/)
- [Zod docs](https://zod.dev/)
- [jose documentation](https://github.com/panva/jose)
- [TanStack Query React docs](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [TanStack Router docs](https://tanstack.com/router/latest/docs/overview)
