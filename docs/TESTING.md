# Testing

## Repository quality gates

- `bun run check:commit` — быстрый локальный gate: tracked secret hygiene, lint, Prisma validation, typecheck, architecture, script/contracts/backend unit/webapp tests.
- `bun run check:push` и `bun run check` — полный gate: все тесты, production build, backend Docker smoke и Playwright E2E.
- `pre-commit` отдельно сканирует staged Git index, поэтому проверяет именно содержимое будущего commit, а не игнорируемый локальный `backend/.env`.
- GitHub Actions повторяет secret hygiene и tooling contracts независимо от локальных hooks, которые можно обойти через `--no-verify`.
- `security-static` независимо запускает Gitleaks по Git-истории, Semgrep по versioned high-confidence правилам и Trivy по конфигурации; после Docker smoke Trivy проверяет собранный backend image.
- `security-dynamic.yml` запускает активный ZAP API scan только вручную или по расписанию, на временном backend и отдельной `_test` базе.

Для полной проверки нужны Bun, Docker и установленный Chromium для версии Playwright из `webapp`.

The goal of this project's tests is to show future agents where behavior should be verified and how to keep E2E broad enough to protect valuable behavior without turning it into exhaustive matrices.

## Pyramid

- Contracts/unit: shared Zod schema matrices, env parsing, JWTs, password hashing, client API refresh/retry behavior, and token cleanup.
- Backend integration: refresh-token rotation and replay detection, auth guards, duplicate registration, concurrency, and stable error shapes through real routes and PostgreSQL.
- Webapp Playwright: valuable browser flows through a real backend and Vite UI.
- Mobile Maestro: lives on the `mobile` branch with the runnable Expo app.

Client E2E should cover valuable user journeys, including non-happy-path states that protect real product behavior, when they can stay stable. Important edge cases must be covered at some automated level; choosing integration, contract, or unit coverage instead of E2E is not permission to skip them. Negative validation matrices, combinatorial edge cases, concurrency, and pure rules belong in unit/integration tests.

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

`bun run security:zap` is an active security test, not a normal local smoke. It
creates and later destroys only its isolated `_test` database, filters the
account-delete operation from the generated OpenAPI document, and writes
token-redacted reports under `.scratch/security/zap/`. Never change its target
to a shared or production environment.

`.github/workflows/ci.yml` runs static security, typecheck, deployment/script tests, contract tests, webapp client tests, backend tests, image vulnerability scanning, and the webapp Playwright smoke flow on pushes to `main` and `master` plus pull requests.

## Локальные игроки для ручной проверки

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

Playwright is configured in `webapp/playwright.config.ts`.

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
