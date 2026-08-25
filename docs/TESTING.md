# Testing

## Repository quality gates

- `bun run check:commit` — быстрый локальный gate: tracked secret hygiene, lint, Prisma validation, typecheck, architecture, script/contracts/backend unit/webapp tests.
- `bun run check:push` — dependency audit, full-history Gitleaks и полный `check`: все тесты, production build, backend Docker smoke и Playwright E2E.
- `bun run check` — полный локальный поведенческий gate без сетевого dependency audit.
- `bun run preflight:split-domain` — отдельный воспроизводимый target/rollback gate для подготовленного разделения `anomaly-detector.ru` и `app.anomaly-detector.ru`.
- `bun run benchmark:local-abuse` — отдельный local-only benchmark для distributed abuse boundaries, Feedback, realtime cap и Argon/recovery; он создаёт invocation-scoped `*_test` PostgreSQL и публикует secret-free JSON только после удаления временного volume.
- `bun run acceptance:mvp --players 2|3|4` — отдельный local-only harness для контролируемого человеческого прогона Public MVP Journey и штатного Tender; протокол и границы результата описаны в [LOCAL_MVP_ACCEPTANCE.md](LOCAL_MVP_ACCEPTANCE.md).
- `pre-commit` отдельно сканирует staged Git index, поэтому проверяет именно содержимое будущего commit, а не игнорируемый локальный `backend/.env`.
- GitHub Actions повторяет secret hygiene и tooling contracts независимо от локальных hooks, которые можно обойти через `--no-verify`.
- `security-static` независимо запускает Gitleaks по Git-истории, Semgrep по versioned high-confidence правилам и Trivy по конфигурации; после Docker smoke Trivy проверяет собранный backend image.
- `security-dynamic.yml` запускает активный ZAP API scan только вручную или по расписанию, на временном backend и отдельной `_test` базе.

Для полной проверки нужны Bun, Docker и установленные Chromium и Firefox для версии Playwright из `webapp`.

The goal of this project's tests is to show future agents where behavior should be verified and how to keep E2E broad enough to protect valuable behavior without turning it into exhaustive matrices.

## Pyramid

- Contracts/unit: shared Zod schema matrices, env parsing, JWTs, password hashing, client API refresh/retry behavior, and token cleanup.
- Backend integration: refresh-token rotation and replay detection, auth guards, duplicate registration, concurrency, and stable error shapes through real routes and PostgreSQL.
- Webapp Playwright: valuable browser flows through a real backend and Vite UI.
- Mobile Maestro: lives on the `mobile` branch with the runnable Expo app.

Client E2E should cover valuable user journeys, including non-happy-path states that protect real product behavior, when they can stay stable. Important edge cases must be covered at some automated level; choosing integration, contract, or unit coverage instead of E2E is not permission to skip them. Negative validation matrices, combinatorial edge cases, concurrency, and pure rules belong in unit/integration tests.

### Public MVP Journey coverage

When the approved MVP slices are implemented, use one representative browser
journey for landing CTA → registration → tutorial completion → Recovery Email
offer and a separate reset-password journey. Keep the exhaustive security
matrix at contract/backend integration level:

- Account Email canonicalisation, uniqueness, Yandex sync without merge, and
  deleted-account reuse;
- code/token expiry, attempt budgets, atomic consume, resend invalidation,
  replacement requiring both factors, cooling-off cancellation and concurrent
  requests;
- Recovery Code issuance, hashing, one-time use and global session/recovery
  revocation;
- generic reset responses across missing, password, no-email, Yandex-only and
  rate-limited accounts;
- Approved Mail Service version conflicts, idempotent operator commands,
  last-known-good import, outbox retry/restart and blocked-provider behavior;
- analytics consent/refusal/revocation and retention without cross-use of
  security data;
- Feedback Report authorization, safe projection, rate limits, workflow
  concurrency and scheduled deletion.

Website acceptance separately inspects generated initial HTML, metadata,
structured data, robots/sitemap, links, assets and responsive rendering. A
successful website build does not prove the cross-domain continuation or that
private app routes are excluded from indexing.

## Choosing Test Level

Default to the highest useful behavioral boundary:

- Use E2E when the risk is user-visible and crosses client/backend boundaries: critical journeys, auth/session restore, persistence, navigation, high-risk regressions, and important empty/error states.
- Use backend integration for API/auth/persistence/contracts, stable error shapes, validation behavior, concurrency, and database-backed domain rules.
- Use contract/unit tests selectively for shared schema matrices, pure rules with many branches, env parsing, security/token helpers, password hashing, and client retry/cache/token cleanup behavior that would be brittle or expensive in E2E.

For TDD-first work, list the expected behavior and important edge cases before implementation, then write the first failing test at the boundary that best catches the regression. Important edge cases include validation boundaries, permission failures, expired sessions, empty data, duplicate or conflicting writes, retry/recovery paths, and persistence after refresh or restart.

Do not add E2E coverage just because a branch exists. Add it when it prevents a plausible product regression and can stay stable through explicit setup, stable selectors/test IDs, isolated test data, and deterministic assertions. Do not skip important edge cases just because they are not E2E-worthy; cover them through integration, contract, or unit tests. Keep exhaustive validation matrices and combinatorial edge cases out of E2E.

## UX Behavior Validation

For a new or behaviorally significant UI flow, select the applicable states from
[UX_CHECKLIST.md](UX_CHECKLIST.md) before implementation. The goal is not to
automate every visual variation; it is to prove the user-visible contract at the
highest practical boundary.

| Concern | Preferred evidence |
|---|---|
| Critical cross-layer journey | Playwright E2E through real backend and browser |
| Accepted command, persistence after refresh, reconnect recovery | Playwright E2E for the highest-risk representative flow |
| Authorization, deadline, conflict, duplicate command, stable error shape | Backend integration test through real routes and PostgreSQL |
| Pure validation and domain matrices | Contract or unit test |
| Client retry, cache, local draft and ambiguous-response reconciliation | Focused webapp test unless stable E2E adds materially more confidence |
| Hierarchy, spacing, responsive composition, visual prominence | Code review plus runtime inspection or screenshots |
| Keyboard, focus, labels and announcements | Focused component/runtime check; E2E when part of a critical journey |
| Public/private information boundary | Contract/backend test plus isolated-player E2E for the representative journey |

The representative server-authoritative flow should prove the distinctions
between local selection, server-saved draft, final submission, and accepted
server result whenever those states exist. It should also prove that an
ambiguous response or reconnect does not encourage a duplicate irreversible
command.

### Manual UX Review

Manual review is required when the primary risk is perception rather than a
machine-verifiable behavior. Record only evidence relevant to the changed flow:

- desktop and mobile portrait at supported viewport sizes;
- loading, empty, ready, disabled/waiting, submitting, accepted and relevant
  recovery states;
- timer, primary action, public/private labels and connection status visibility;
- readable hierarchy without horizontal scrolling of critical actions;
- keyboard focus and modal return focus;
- no browser console error, unhandled rejection, or failed request hidden by a
  visually plausible screen.

Use isolated browser contexts for competitive players. A player context must not
receive another player's private samples, strategy, thesis values, private
measurements, or draft. Exchange only room data needed to join the same flow.

Cosmetic UI details such as exact CSS classes, shadows, radius, or spacing values
do not need automated assertions. Use screenshots as review evidence, not as a
substitute for proving command acceptance, persistence, privacy, or recovery.

## Backend

```bash
docker compose version
docker info
docker compose up -d postgres
cp backend/.env.example backend/.env
bun run test
bun run test:contracts
bun run test:backend
bun run test:backend:integration
bun run test:webapp
bun run --cwd backend prisma:validate
bun run smoke:backend:docker
bun run security:gitleaks
bun run security:semgrep
bun run security:trivy:config
bun run security:trivy:image anomaly-detector-backend:smoke
```

Contract tests live in `packages/contracts/src/*.test.ts` and protect shared request/response/error schemas used by backend and webapp. Webapp unit tests live in `webapp/tests` and cover API refresh/retry behavior that would be too expensive and brittle to fully exercise in E2E. The `mobile` branch extends this same contract/testing model for Expo.

Backend tests live next to backend code and verify auth behavior through services and routes. The integration runner starts `postgres_test`, applies migrations, and runs register/login/refresh/logout/guard/error-shape scenarios. By default, the test database port is derived from the absolute repository path so parallel checkouts do not collide, and `TEST_DATABASE_URL` is derived from that port. Set `POSTGRES_TEST_PORT` and `TEST_DATABASE_URL` only when a fixed test database is required. Local database startup, credentials, and reset behavior are documented in [LOCAL_DATABASE.md](LOCAL_DATABASE.md).

The integration and Docker smoke runners refuse database names that do not end with `_test` unless an override is set intentionally. This protects `anomaly_detector` development data from test writes.

The Docker smoke test builds the backend image, starts it against `postgres_test`, waits for `/health/ready`, and removes only the smoke container it created. The image remains under `anomaly-detector-backend:smoke` long enough for the following Trivy image scan.

Operational metrics use focused unit tests for Prometheus formatting, bounded
labels, `5xx` observation through the error handler, worker staleness, reconnect
classification and mail transitions. Tender aggregate counts are also exercised
against PostgreSQL by the Tender integration suite. Docker smoke is the runtime
boundary: the public API port must return `404` for `/metrics`, while the
separately loopback-published collector port must return the aggregate
`anomaly_detector_api_up` series. Never weaken that isolation to simplify a
scrape test.

`bun run security:zap` is an active security test, not a normal local smoke. It
creates and later destroys only its isolated `_test` database, filters the
account-delete operation from the generated OpenAPI document, and writes
token-redacted reports under `.scratch/security/zap/`. Never change its target
to a shared or production environment.

`.github/workflows/ci.yml` runs static security, typecheck, deployment/script tests, contract tests, webapp client tests, backend tests, image vulnerability scanning, and the webapp Playwright smoke flow on pushes to `main` and `master` plus pull requests.

## Локальные игроки для ручной проверки

Для контролируемого прогона с реальными группами используйте
[local-only acceptance harness](LOCAL_MVP_ACCEPTANCE.md), а не стабильные
учётные записи ниже. Harness создаёт чистый invocation-scoped test volume;
участники регистрируют disposable accounts через реальный UI, а volume целиком
удаляется до сохранения обезличенной сводки.

После запуска локального backend подготовьте две стабильные синтетические учётные записи:

```bash
bun run seed:test-users
```

Скрипт безопасно повторяется: он создаёт отсутствующих игроков и проверяет пароль уже существующих.

| Вид | Логин | Пароль |
| --- | --- | --- |
| Десктоп | `testPlayer1` | `test1234` |
| Мобильный web | `testPlayer2` | `test1234` |

Эти данные предназначены только для локальной разработки и ручного browser-аудита. Не используйте их в production.

## Webapp E2E

Playwright is configured in `webapp/playwright.config.ts`. The default command
runs the critical browser journeys in both Chromium and Firefox; use
`--project=chromium` or `--project=firefox` only for narrow diagnosis.

First-time setup:

```bash
docker compose version
docker info
cp backend/.env.example backend/.env
bun run --cwd webapp e2e:install
bun run e2e:webapp
```

If `docker compose version` or `docker info` fails, install/start Docker first by following [LOCAL_DATABASE.md](LOCAL_DATABASE.md). Do not replace this with native PostgreSQL for new users.

The webapp E2E flow:

- starts `docker compose up -d postgres_test` unless `E2E_SKIP_DOCKER=1` is set;
- chooses repository-derived ports by default, and automatically moves to the nearest free ports if those are already occupied;
- generates the Prisma client and applies migrations;
- uses `TEST_DATABASE_URL` as the primary database URL, then passes that value to the backend as `DATABASE_URL` inside the test run;
- starts the backend on `E2E_BACKEND_PORT`, which defaults to a repository-derived port;
- starts the deadline worker after migrations and stops only that worker when Playwright finishes;
- starts Vite on `E2E_WEB_PORT`, which defaults to a repository-derived port;
- stops its `postgres_test` compose project and removes the test volume after the run unless `E2E_KEEP_DOCKER=1` is set;
- runs the browser authentication journey: contract-backed registration/profile validation, transient session recovery, retryable logout/profile failures, protected profile, logout, and login;
- verifies that lobby refresh uses a read-only request, exposes stale/error state, and recovers on demand;
- runs a two-player Tender journey through all five rounds and the final model, including real-time phase transitions.

Useful env:

```bash
TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:<test-port>/anomaly_detector_test?schema=public"
POSTGRES_TEST_PORT=<test-port>
E2E_BACKEND_PORT=<backend-port>
E2E_WEB_PORT=<web-port>
E2E_SKIP_DOCKER=1
E2E_KEEP_DOCKER=1
```

By default, Playwright computes `POSTGRES_TEST_PORT` from the absolute repository path and refuses to run against a database that does not use the `_test` suffix. This prevents E2E from accidentally writing to development or production data. Use `DATABASE_URL` only as a low-level override; `TEST_DATABASE_URL` is the documented test entry point.

Playwright artifacts live in `webapp/e2e/.artifacts/` and are not committed. For interactive debugging:

```bash
bun run --cwd webapp e2e:ui
```

### Split-domain preflight

Run the complete local preflight from the repository root:

```bash
bun run preflight:split-domain
```

It first checks the route-derived Caddy policy, backend origin/OAuth contracts,
release-build guards and generated public links. It then builds the current
`webapp`/`website` and runs Chromium twice behind an isolated edge on distinct
`*.anomaly-detector.localhost` hosts with an ephemeral local TLS certificate:

- target: public-root `404`, every registered legacy deep-link temporary
  redirect with path/query and `Cache-Control: no-store`,
  player SPA reload, public/player CSP, exact CORS, API callback + player OAuth
  error return, app-host legal URLs, and a `Secure; HttpOnly; SameSite=None`
  host-only refresh cookie restricted to `/api/auth`;
- rollback: root-host SPA/deep-link reload, root CORS/OAuth return,
  previous app and untrusted-origin CORS rejection, secure refresh/logout,
  app-to-root recovery redirect and unchanged API-host cookie scope.

The OAuth transport contract additionally mocks successful target and rollback
callbacks, checks their secure host-only auth cookie, and rejects an in-flight
callback from the previous origin before transaction side effects. Real provider
code exchange remains an owner gate.

Each profile gets a unique Compose project, dynamically resolved ports and its
own static/result directories under `webapp/e2e/.artifacts/`; the runner removes
ambient database, Compose, URL, port and skip/keep overrides before starting.
Docker daemon selectors are also removed, and the runner fails closed unless
the resulting active context uses a local Unix socket; that verified socket is
then pinned as `DOCKER_HOST` for the complete child run. Its teardown can
therefore remove only that invocation's local `_test` volume. The final
release builds use a separate OS temporary directory, clear owner-gated
analytics flags, verify fixed production origins and reject localhost,
`0.0.0.0`, IPv6/IPv4 loopback and named `.localhost` origins, then delete the
test-only artifacts automatically.

The TanStack Router bundle contains its own exact `http://localhost` fallback
literal for browsers without an origin; the scanner permits that known
non-endpoint string. Release validators still make both configured API origins
exact production values, while any localhost path/port or other loopback host
remains rejected.

The isolated edge reads route families, redirect destinations/status/cache
policy and headers from the versioned Caddy profiles, but it is not the Caddy
parser and does not prove public DNS/TLS, provider-side OAuth registration or
live production headers; those remain release-owner checks.

## Mobile Maestro E2E

The default branch intentionally does not contain the runnable Expo app or Maestro runner. Use the `mobile` branch for mobile E2E setup, dev-client guidance, stable React Native `testID` selectors, and `bun run --cwd mobile e2e:maestro:audit`.

## Current Upstream Documentation

For testing questions, consult the current upstream documentation linked here first. This document describes this repository's testing contract; upstream docs are authoritative for runner behavior.

- Playwright intro: https://playwright.dev/docs/intro
- Playwright `webServer`: https://playwright.dev/docs/test-webserver
- Playwright `baseURL`, traces, screenshots, and video: https://playwright.dev/docs/test-use-options
- Playwright CLI and browser install: https://playwright.dev/docs/test-cli and https://playwright.dev/docs/browsers
- Docker Compose: https://docs.docker.com/compose/
- PostgreSQL Docker Official Image: https://hub.docker.com/_/postgres
