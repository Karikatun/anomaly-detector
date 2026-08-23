# Аудит приватной аналитики Public MVP Journey

Дата: 2026-08-23
Этап: implementation, без production-изменений.
Срез: issue #42; shared contracts, public website, player webapp, analytics API,
PostgreSQL, daily cleanup, concealed operator projection, adminapp и prepared
Yandex Cloud configuration.

## Scope and protected invariant

Основной инвариант: до отдельного согласия посетитель не получает связанный
идентификатор, а продукт сохраняет только несвязанный агрегированный
`landing_view`. После согласия один 30-дневный first-party identifier связывает
только пять allowlisted шагов MVP; отказ и отзыв ничего не блокируют и удаляют
identifier с raw events. Ни normal API, ни operator view не проецируют
посетителя, аккаунт, login, email, полный IP, URL или игровые данные.

Trust boundaries:

- anonymous landing → strict source contract → safe source category и
  `human`/`known_bot` aggregate без visitor row;
- affirmative choice → random UUID command → domain-separated HMAC token и
  HMAC-only PostgreSQL keys → HttpOnly cookie только для `/api/analytics`;
- public/player browser → dedicated `ANALYTICS_ORIGINS` → allowlisted linked
  event; public origin не получает CORS к auth/operator routes;
- journey token → row/advisory lock → idempotent event и adjacent transition
  aggregate;
- `ADMIN_USER_IDS` → concealed operator boundary → только 7/30/90-day aggregate
  projection;
- daily private maintenance → expired 30-day journey/raw-event cascade и
  13-month aggregate retention.

Акторы: посетитель без выбора, посетитель с согласием, посетитель с отказом или
отзывом, зарегистрированный игрок, known bot, обычный пользователь,
allowlisted operator и атакующий, подделывающий UA/source/event/command/token.

## Critical user journey and evidence IDs

`CUJ-42-01`: новый посетитель открывает public landing без analytics identifier,
видит равноправный выбор, добровольно разрешает аналитику, переходит в
регистрацию и tutorial, завершает lesson, подтверждает Recovery Email, затем
возвращается на landing и отзывает согласие. Успех: продуктовый путь не
блокируется ни отказом, ни сбоями analytics; raw journey удалён после revoke, а
operator видит только агрегаты.

| ID | Шаг или критерий | Статус | Evidence |
| --- | --- | --- | --- |
| `UXC-42-01` | До выбора нет unique cookie/journey/event | PASS | PostgreSQL integration + browser cookie assertion |
| `UXC-42-02` | Initial panel даёт равноправные allow/necessary actions | PASS | rendered 1440×900, 1024×768, 390×844; equal bounds, keyboard и axe |
| `UXC-42-03` | Consent создаёт только 30-day HttpOnly API-scoped cookie | PASS | route tests + cross-origin Chromium journey |
| `UXC-42-04` | Refusal/revoke удаляет identifier и не блокирует CTA/tutorial | PASS | Chromium consent/refusal/revoke scenarios + PostgreSQL revoke test |
| `UXC-42-05` | Пять allowlisted funnel events и adjacent transitions идемпотентны | PASS | contracts, PostgreSQL out-of-order/concurrency и browser instrumentation |
| `UXC-42-06` | Admin видит только 7/30/90 aggregates, sources и excluded bots | PASS | concealed API integration, strict schema, adminapp rendered review |
| `UXC-42-07` | Password reset не обращается к analytics/third party | PASS | isolated Chromium reset journey and origin/request capture |
| `UXC-42-08` | Raw 30d / aggregate 13mo cleanup воспроизводим | PASS | cleanup integration + named cron test |
| `UXC-42-09` | Production activation и legal parity | BLOCKED | `ANALYTICS_ENABLED=false`; issues #2 and #31 |

Browser-safety boundary: использовались изолированные test users и локальная
PostgreSQL; screenshot содержит только синтетические aggregate counts. Cookie,
token, login, email, password и реальные персональные данные в screenshots,
логах и audit-документ не включались.

## Acceptance criteria

1. Funnel ограничен `landing_view → tutorial_cta → registration_complete →
   tutorial_complete → recovery_email_confirmed`; произвольное событие strict
   contract отклоняет.
2. До выбора записывается только daily aggregate; visitor row, raw event и
   cross-surface identifier отсутствуют.
3. Consent создаёт HMAC-only 30-day journey и HttpOnly, SameSite=Lax,
   API-path cookie; necessary/revoke удаляет связанный row/events и cookie.
4. Email, login, account/user ID, game state, full IP, fingerprint, ad ID,
   arbitrary URL/referrer/UTM не входят в request или persistence.
5. Source сохраняется только как `direct`, `referral`, `campaign` или `unknown`;
   campaign допускается только build/runtime allowlist.
6. Known crawlers отделены от human funnel; operator view показывает их только
   отдельным aggregate count.
7. Operator route требует authentication и exact allowlist, скрыт одинаковым
   404, не входит в OpenAPI и не имеет raw-event drilldown.
8. Repeated/out-of-order events, duplicate/conflicting grant command, revoke
   race, expiry и cleanup fail closed или остаются idempotent.
9. Landing/client analytics отсутствуют в disabled build, а backend не монтирует
   routes при `ANALYTICS_ENABLED=false`.
10. Яндекс Метрика, Google Analytics, advertising pixel и session replay не
    подключаются.

## Threat review

| Boundary | Attacker, path and impact | Control and evidence |
| --- | --- | --- |
| Pre-consent landing | Сайт создаёт скрытый identifier или принимает PII | Только strict `{campaign, referrerDomain}`; store делает aggregate upsert без journey; contract/PostgreSQL/browser tests |
| Consent token/cookie | Token читается JS, утекает другим API или живёт бессрочно | HMAC token, HMAC-only DB keys, HttpOnly/SameSite/API path/30d, no-store; route and browser cookie evidence |
| Dedicated CORS | Public origin вызывает auth/operator mutation | Separate `ANALYTICS_ORIGINS` only for analytics path; public→analytics credentials PASS, public→auth origin absent |
| Event replay/order | Retry удваивает шаги или переходы | Unique `(journeyId, kind)`, journey lock, `createMany skipDuplicates`, adjacent reconciliation; PostgreSQL parallel/out-of-order test |
| Revoke race | Event сохраняется после отзыва | Revoke/event share journey advisory lock; delete cascade; post-revoke write returns false |
| Source ingestion | UTM/referrer содержит PII или создаёт high-cardinality storage | Browser extracts hostname, strict bounded domain, campaign regex+allowlist; DB stores enum category only |
| Bot classification | Known crawler искажает human conversion | Bounded UA token classifier and separate traffic class; admin projection excludes known bots from human steps |
| Operator projection | Operator восстанавливает visitor/account | Concealed allowlist route + strict aggregate-only schema; no ID/raw dimension or drilldown |
| Retention | Raw journey/events или aggregates живут дольше contract | 30-day `expiresAt`, cascade delete, 13-month aggregate cutoff, named idempotent cron |
| Reset/recovery | Analytics получает reset token или recovery code | Client sends event enum only after successful owning mutation; reset page request capture proves zero analytics calls |

## Actor and resource matrix

| Operation | Undecided / necessary | Consented player | Ordinary user / operator |
| --- | --- | --- | --- |
| Record landing | Unlinked aggregate only | То же aggregate без token read | Known bot идёт в отдельный class |
| Grant linked journey | Только explicit allow | Idempotent command, 30-day cookie | Нет account-based grant |
| Record linked event | Без cookie silently ignored | Allowlisted enum, once per journey | Нельзя передать user/account/source fields |
| Revoke | Constant necessary choice, no unique ID | Journey/raw events deleted | Support/operator bypass отсутствует |
| Read raw journey/event | Нет route | Нет route | Нет operator route |
| Read aggregates | Нет player route | Нет player route | Только allowlisted operator, 7/30/90 days |

## Concurrency, replay and recovery

| Scenario | Expected persisted outcome | Evidence |
| --- | --- | --- |
| Same consent command/payload | Один journey, стабильный token/expiry | Parallel PostgreSQL integration |
| Same command, changed normalized source | Safe conflict, второй journey не создаётся | PostgreSQL conflict test |
| Duplicate/parallel event | Один raw kind и один aggregate increment | Unique constraint + journey lock integration |
| Out-of-order adjacent events | Каждый существующий соседний transition считается один раз | Out-of-order integration |
| Event concurrent with revoke | Lock serializes; после delete event не принимается | Shared lock design + post-revoke test |
| Expired journey | Status undecided, linked event ignored, cron deletes row/events | TTL and cleanup integration |
| Analytics/API unavailable | CTA, registration, tutorial и recovery mutation продолжаются | Client catches failure + refusal/browser journeys |
| Cron retry/restart | Repeat delete is safe, current rows remain | `deleteMany` boundary and cron tests |

## Persistence and rollout

Миграция `20260822235143_add_privacy_aware_analytics` добавляет
`AnalyticsJourney`, `AnalyticsEvent` и `AnalyticsDailyAggregate`: unique HMAC
journey/command keys, one event kind per journey, cascade raw-event deletion и
bounded aggregate identity. Backfill не нужен. Все 29 migrations применились на
изолированной PostgreSQL test database; migration создана Prisma, а не
отредактирована вручную.

Disabled rollout безопасен: binaries/schema могут быть развернуты при
`ANALYTICS_ENABLED=false`, player routes/operator projection отсутствуют, а
static clients не монтируют analytics без build flags. Production enablement:
issue #2 legal/data map/Russian storage → issue #31 split-domain release →
backup/restore point → migration → exact-SHA backend/webapp/website/adminapp →
real-domain CORS/CSP/cookie/revoke/cleanup checks → operator aggregate evidence.
Push, deploy, DNS, legal publication и production data collection в этом срезе
не выполнялись.

## UX pilot and rendered inspection

UX pilot: RUN. Primary CTA: равноправные «Разрешить аналитику» и «Только
необходимые»; server acceptance — response consent endpoint и появление/удаление
HttpOnly cookie. Failure path прямо сообщает, что выбор можно сделать позже и
не мешает игре.

Rendered walkthrough actual website/adminapp:

- 1440×900, 1024×768 и 390×844: иерархия consent panel, equal actions,
  no horizontal overflow, 48px controls, focus order и readable copy;
- allow, necessary и revoke states проверены в реальном cross-origin flow;
- operator screen на трёх viewport показывает funnel, transitions, sources,
  known bots и daily data без visitor dimension;
- Axe не нашёл violations после исправлений; keyboard focus проверен для
  consent actions, window controls и scrollable daily region;
- входящих Agentation-аннотаций не было; реальное user study и полный
  screen-reader walkthrough не запускались.

Findings:

- `UXF-42-01`, blocking behavioral — component CSS показывал одновременно
  undecided/necessary/allowed panels. Исправлено в owning component selector
  `[hidden]`; before screenshot воспроизвёл три action groups, after evidence —
  ровно один соответствующий state.
- `UXF-42-02`, blocking accessibility — mobile operator daily table имела
  horizontal scroll, но region не получал keyboard focus. Добавлены named
  focusable region semantics и regression test; повторный axe/render PASS.
- `TECH-42-01`, blocking reliability — полный Chromium gate обнаружил
  `net::ERR_ABORTED` у fire-and-forget event после регистрации и двойной запуск
  нативной формы через `submit` плюс `onClick`. Удалён второй submit, фоновая
  отправка перенесена в стабильный auth-owner и использует `sendBeacon` с
  безопасным `fetch` fallback; regression доказывает одну регистрацию и один
  завершённый event request, исходный двухпользовательский Tender снова PASS.

Одноразовый CUJ/evidence experiment: `ADOPT` — 2 новых недублирующих findings,
2/2 приняты и исправлены, пропусков/дублированных ID после completeness review
нет. Дополнительное время и ручные замечания после handoff: `NOT MEASURED`;
текущий handoff — первый цикл.

## Findings and residual risk

Independent security/spec review текущего diff не выявил конкретных P0–P2.
Остаточные риски:

- production activation BLOCKED issues #2/#31: действующая privacy/legal copy
  ещё честно говорит, что analytics не включена;
- real-domain credentialed CORS, CSP, cookie delivery и reverse-proxy/header-log
  redaction не проверялись; prepared config покрыт только local tests;
- UA bot classification best-effort и spoofable; public aggregate endpoint
  нуждается в production-like abuse/performance baseline и edge policy до
  большого трафика;
- rotation `JWT_SECRET` инвалидирует active analytics cookies, а недоступные
  journey rows удалятся cron не позднее исходного 30-day expiry;
- daily cleanup schedule, backup/restore и production rollback ещё не
  отрепетированы;
- Active DAST: NOT RUN; production не атакован.

## Validation

- Primary signal: PASS — isolated Chromium доказал pre-consent absence,
  consent, CTA, registration, refusal и revoke; tutorial/recovery events и
  reset-page exclusion также прошли.
- Targeted contracts/unit: PASS — strict schema, env, route, client, adminapp,
  website, cron и deployment-CSP tests.
- PostgreSQL: PASS — grant conflict/idempotency, event concurrency/order,
  revoke, bot projection и retention; concealed operator integration.
- Rendered behavior: PASS — 1440×900, 1024×768, 390×844, keyboard и axe для
  public panel и operator overview.
- Full `check:push`: PASS — dependency audit, tracked-secret hygiene, gitleaks
  по 419 commits, lint, Prisma validation, typecheck, architecture, 32 deploy,
  20 tooling, 46 contracts, 14 adminapp, 232 backend unit, 130 PostgreSQL
  integration, 170 webapp unit, 4 website, все builds, Docker/DB smoke и 45
  Chromium scenarios.
- Active DAST: NOT RUN — policy разрешает только isolated scheduled/manual
  target; production endpoint не сканировался.

## Audit checklist

- Shared contract/API: REQUIRED, PASS — strict producer и website/webapp/admin
  consumers, invalid fields и bounded operator query.
- Auth/permissions/privacy/object ID: REQUIRED, PASS — no pre-consent ID,
  aggregate-only operator projection, concealed 404 и dedicated CORS boundary.
- State/async/recovery: REQUIRED, PASS — duplicate/conflict/replay/order/revoke,
  expiry, failure-no-block и cleanup retry.
- Prisma/persistence: REQUIRED, PASS локально; production backup/restore
  BLOCKED.
- Module/platform dependency: REQUIRED, PASS — architecture check.
- UI behavior/rendered/accessibility: REQUIRED, PASS — real flow, three
  viewports, keyboard, axe и before/after findings.
- Form field/input purpose: N/A — text/password/email input не добавлялись.
- Images/icons: N/A — новые изображения и смысловые иконки не добавлялись.
- Public website: REQUIRED, PASS — conditional initial HTML/build, links,
  responsive rendering and first-party CSP.
- Secrets/dependencies/source: REQUIRED, PASS — dependency audit без найденных
  уязвимостей, tracked-secret hygiene PASS, gitleaks 419 commits/no leaks.
- Docker/IaC/exact image: REQUIRED из-за prepared Caddy/env; local config test
  и Docker/DB smoke PASS; vulnerability scan exact release image BLOCKED до
  появления разрешённого release SHA.
- Backup/storage/cleanup: REQUIRED, PASS retention integration; production
  timer/restore drill BLOCKED.
- Legal/privacy copy: REQUIRED, implementation fail-closed PASS; owner approval
  and production copy BLOCKED issues #2/#31.
- Performance/abuse: REQUIRED, bounded storage design PASS; production-like
  load/poisoning thresholds BLOCKED issue #19.
- Release/production/network: BLOCKED — нет разрешения на push/deploy, exact
  release SHA/CI, backup/restore и post-deploy evidence.

Primary signal status: PASS — consent/refusal/revoke и полный linked funnel доказаны isolated PostgreSQL и Chromium evidence.
Secondary signal status:
- PASS — strict contracts, unit, integration, rendered desktop/tablet/mobile, keyboard и axe.
- PASS — полный `check:push`: dependencies/secrets/gitleaks, lint/typecheck/architecture, 32 deploy, 20 tooling, 46 contracts, 14 adminapp, 232 backend unit, 130 PostgreSQL, 170 webapp unit, 4 website, builds, Docker/DB smoke, 45 Chromium.
- BLOCKED — legal approval, production activation, exact-domain CORS/log/cleanup/rollback evidence.
Security audit status: consent/cookie/CORS/admin/retention scope; доказанных P0–P2 нет, production abuse и log-redaction остаются coverage gaps.
Active DAST status: NOT RUN — production не атакован; active scan требует отдельного isolated target.
Residual risk: analytics выключена до #2/#31; real-domain и production abuse/operations evidence ещё не собрано.
Commit: task-scoped Conventional Commit содержит этот audit; exact SHA указан в handoff, чтобы не создавать второй документационный commit.
