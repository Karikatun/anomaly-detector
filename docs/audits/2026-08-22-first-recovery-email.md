# Аудит первой Recovery Email

Дата: 2026-08-22
Этап: implementation, без production-изменений.
Срез: issue #37, ветка `dev`; auth application/transport/persistence,
Approved Mail Service, transactional outbox, shared contract, профиль игрока и
Prisma migration.

## Scope and protected invariants

Основной инвариант: владелец password-аккаунта добровольно подтверждает первый
Recovery Email, но новая сессия с украденными login/password не может лишить
прежние сессии права отменить добавленный фактор. Recovery Email не является
логином, Account Email или способом объединить аккаунты.

Точки входа и trust boundaries:

- текущий password и новый адрес из player webapp → bounded shared contract →
  auth application;
- непроверенный адрес → опубликованная Approved Mail Service policy → отдельные
  provider value и canonical key;
- owning auth transaction → Recovery Email challenge/binding, HMAC anti-abuse
  buckets и transactional mail outbox;
- outbox worker → HMAC-derived code → REG.RU SMTP adapter;
- private address, canonical key, code derivative и session-authority snapshot →
  masked own-user projection → профиль;
- отмена или удаление аккаунта → очистка challenge/binding и отзыв относящихся
  к риску сессий.

Акторы: анонимный посетитель, владелец password-аккаунта в прежней сессии,
владелец в новой сессии, владелец Yandex identity, другой аутентифицированный
пользователь, оператор, почтовый провайдер и атакующий с украденными
login/password.

## Acceptance criteria

1. Первая привязка доступна только password-аккаунту, требует текущий password
   и адрес из опубликованной Approved Mail Service policy.
2. Код действует 15 минут, имеет не более пяти попыток, инвалидируется новым
   запросом и не хранится открыто в challenge или outbox.
3. Account, canonical-email и trusted-IP budgets хранят только HMAC keys и
   потребляются атомарно с challenge/outbox.
4. Финальная uniqueness проверяется в одной PostgreSQL transaction одновременно
   с Account Email и Recovery Email; конфликт не раскрывает владельца.
5. Успешное подтверждение создаёт 24-часовой cooling-off. Только точный набор
   сессий, существовавших до запроса, может отменить его; более новые сессии
   отзываются при отмене.
6. Профиль возвращает только masked address и bounded state. Yandex-managed
   account не получает локальные recovery controls.
7. Resend, expiry, five attempts, duplicate/concurrent confirm/cancel, provider
   block, restart, outbox rollback, session authority и account deletion имеют
   PostgreSQL-backed regression evidence; добровольный отказ не блокирует игру.

## Threat review

| Boundary | Threat | Concrete path and impact | Control and evidence |
| --- | --- | --- | --- |
| Session/password → start | Spoofing, elevation | Использовать чужой access token или устаревший password hash для закрепления адреса | `requireAuth`, current-password verification и повторное сравнение ожидаемого hash внутри owning transaction; Yandex identity и существующий binding отклоняются |
| Address → policy/canonical key | Tampering, account collision | Применить неподтверждённые alias-правила либо привязать неподдерживаемый сервис | Domain lowercase/IDNA; canonicalization flags и immutable policy version берутся из опубликованной записи; unlisted/blocked адрес не начинает привязку |
| Challenge/outbox → recipient | Information disclosure, replay | Считать код из БД, логов или outbox и повторно использовать его | Код domain-separated HMAC от random message ID и секрета, вычисляется worker только перед отправкой; challenge хранит другой keyed hash, outbox не содержит code; TTL, пять попыток, resend и atomic consume покрыты тестами |
| Abuse budgets | Denial of service, mail spam | Распределённо слать коды по одному account/address/IP либо искать адреса по сырым keys | Семь HMAC-only PostgreSQL buckets, отсортированные advisory locks и одна transaction с owner operation; наружу выходит bounded 429 |
| Account Email / Recovery Email ownership | Spoofing, race | Два аккаунта одновременно подтверждают один canonical key или Yandex account занимает Recovery Email | Общий `account-email` advisory lock, повторная проверка обеих таблиц и unique Recovery Email index; параллельный тест даёт одного владельца и один safe conflict |
| Session authority → cancel | Elevation, repudiation | Новая сессия злоумышленника отменяет защиту либо избегает отзыва | Challenge и binding сохраняют точный snapshot active session IDs; только ID из snapshot может cancel, после чего все более новые active sessions отзываются |
| Outbox lease → cancel/resend | Race, misleading state | Owner operation помечает уже отправляемое SMTP-письмо отменённым и конфликтует с результатом worker | Только `queued` row может перейти в `owner_operation_cancelled`; `leased` остаётся собственностью worker и завершает реальный outcome. Challenge обновляется/удаляется в той же auth transaction, поэтому код из уже in-flight письма недействителен |
| Persistence → API/UI | Information disclosure, IDOR | Получить полный адрес, canonical key, code/hash или состояние другого account | Routes не принимают user ID и используют authenticated principal; server projection маскирует адрес; strict contract отвергает private fields; browser test проверяет отсутствие raw email/code |
| Account deletion | Recovery failure, linkability | Оставить binding/challenge или связать освобождённый адрес с удалённым account | Одна transaction очищает challenge, binding, identities и sessions, сбрасывает Account Email и обезличивает user; integration проверяет outbox cleanup и отсутствие recovery rows |

## Actor and resource matrix

| Operation/resource | Anonymous | Password owner, old session | Password owner, new session | Yandex owner / outsider / operator |
| --- | --- | --- | --- | --- |
| Read protection | `401` | Только собственный masked state | Только собственный masked state | Yandex получает только provider-managed state; outsider — только свой account; operator override отсутствует |
| Start / resend / confirm | `401` | Own account после password/code и budgets | Может работать только со своим account; не получает чужой object ID | Yandex flow отклоняется; outsider не адресует другой account; operator command отсутствует |
| Cancel pending/cooling | `401` | Разрешено только session ID из pre-request snapshot | `403`, даже при знании password | Yandex/outsider/operator не получают capability |
| Full provider/canonical value, code/hash, budget key | Нет доступа | Нет доступа через API/UI | Нет доступа через API/UI | Нет player/operator projection; только private DB fields |
| Active Recovery Email | Нет | Read-only masked state; replacement относится к следующему срезу | То же own-user состояние | Не является login/linking input |

## Concurrency, replay and recovery

| Scenario | Expected persisted outcome | Evidence |
| --- | --- | --- |
| Duplicate start | Один challenge/outbox; следующий start получает safe pending conflict | PostgreSQL transaction, per-user advisory lock и unique user row |
| Resend | Новый message ID/hash/expiry; прежний code больше не подтверждает | Restart integration и queued-outbox cancellation assertion |
| Пять неверных попыток / expiry | Следующее confirm остаётся invalid; resend после budget window создаёт новый bounded challenge | PostgreSQL integration |
| Два accounts подтверждают один address | Один binding; проигравший сохраняет challenge и получает одинаковый safe conflict | Параллельный PostgreSQL integration test |
| Confirm одновременно с cancel | Только один сериализованный outcome; partial binding/challenge отсутствует | Per-user/key advisory locks и parallel integration |
| Outbox conflict | Challenge и все семь budget writes откатываются вместе | Forced message-identity conflict integration |
| Worker уже leased письмо при cancel | Cancel не подменяет in-flight SMTP outcome; worker завершает leased row, а связанный code уже недействителен | Отдельный outbox lease/cancel/accept integration test |
| Новая session пытается cancel | `403`; прежняя session cancel удаляет binding/challenge и отзывает новые sessions | Multi-session integration test |
| Requester выходит из account до cancel | Logout не передаёт authority другой session; только ID из исходного snapshot остаются допустимыми | PostgreSQL logout/session-authority integration test |
| Account deletion | Challenge/binding удалены; queued message redacted/terminal; дальнейшее восстановление не связывает account | Account deletion integration |

## Persistence and rollout

`20260822152327_add_first_recovery_email` сгенерирована `prisma migrate dev` из
декларативной schema и добавляет отдельные challenge/binding tables, foreign
keys с cascade, unique user/message/canonical indexes и deadline indexes. На
чистой PostgreSQL 18 базе успешно применены все 24 migrations, после чего
прошёл полный DB-backed набор.

Порядок production release: issue #36 подтверждает реальный REG.RU/DNS/mailbox
контур → backup и restore point → `prisma migrate deploy` → API и worker из
одного exact image → password account start/receipt/confirm/cancel smoke без
сохранения code или полного адреса в evidence. Таблицы новые, поэтому backfill
не требуется. Production migration, backup/restore и rollback не выполнялись в
этом implementation-срезе.

## UX pilot and rendered inspection

UX pilot: RUN. Основной сценарий: владелец видит добровольное предложение,
может закрыть форму без потери доступа к уроку/игре, подтверждает masked address,
видит cooling-off и может отменить его из прежней сессии.

Отдельно от автоматизации выполнен rendered walkthrough настоящего локального
API/UI:

- 1440×900 и 1024×768: карточка сохраняет иерархию профиля, CTA и dialog не
  обрезаются;
- 390×844: controls складываются в одну колонку без horizontal clipping;
  start, pending-code dialog и cooling-off остаются читаемыми;
- полные address/password/code очищаются после success или «Сделать позже»;
  профиль показывает только mask;
- keyboard/focus: закрытие start/code/cancel dialog возвращает focus на
  релевантное действие либо protection section;
- browser console: ошибок и предупреждений не обнаружено.

Playwright отдельно проверяет postpone → возврат к «Создать комнату», очистку
email/password, start → pending → confirm → cooling-off → cancel и отсутствие
raw email/code в body. Это rendered walkthrough и regression automation, а не
usability-исследование с реальными пользователями. Входящих Agentation-аннотаций
не было. Axe не запускался отдельно: существующая зависимость доступна, но
изменённые labels/dialog semantics и focus проверены напрямую; остаточный риск —
полный screen-reader walkthrough до release.

## Findings and residual risk

Pre-commit threat review обнаружил P1 race: первая реализация позволяла
`cancelTransactionalMail` перевести уже `leased` row в terminal/redacted, хотя
SMTP worker мог продолжить фактическую отправку. Failing PostgreSQL test
воспроизвёл ложную отмену. Исправление переименовало контракт в
`cancelQueuedTransactionalMail`: отменяется только ещё не взятое письмо, а
leased worker сохраняет ownership и записывает фактический delivery outcome.
Повторный тест и полный integration-набор прошли.

Остаточные риски:

- SMTP-письмо, уже leased или физически отправляемое в момент resend/cancel,
  нельзя отозвать; оно может дойти позже, но его code инвалидируется атомарным
  обновлением/удалением challenge и не подтверждает адрес;
- production REG.RU receipt, SPF/DKIM/DMARC и provider-block alerting остаются
  owner-gated issue #36;
- replacement, Recovery Code и password reset относятся к issues #38–#40;
- production migration, backup/restore и rollback smoke не выполнялись;
- Active DAST: NOT RUN. Изменённая auth/persistence граница проверена
  отрицательными contract/PostgreSQL/browser tests; атаки на production
  запрещены.

## Validation

- Primary signal: PASS — start/resend/confirm/cooling/active/cancel и
  session-authority сценарии прошли вместе с 93/93 PostgreSQL integration tests
  и 889 assertions.
- Targeted behavior: PASS — shared auth contract, auth/mail unit и web profile
  API tests.
- Fresh migration: PASS — 24/24 migrations на чистой PostgreSQL 18 базе.
- Browser behavior: PASS — целевой Playwright flow, fresh migration и
  production-like backend composition; 1/1, затем полный suite 38/38.
- Rendered behavior: PASS — 1440×900, 1024×768 и 390×844, focus и browser logs.
- Full repository gate: PASS — `bun run check:push`, включая lint, typecheck,
  architecture, builds, backend unit 216/216 (859 assertions), clean-migration
  integration 93/93 (889 assertions), Docker readiness/auth smoke и Playwright
  38/38.
- Static/security gates: PASS — dependency audit: 0 vulnerabilities; Gitleaks:
  412 commits, no leaks; Semgrep: 317 targets, 0 findings; Trivy config:
  0 misconfigurations; Trivy backend image: 0 OS и 0 application
  vulnerabilities.

## Audit checklist

- Shared contract/API shape: REQUIRED, PASS — strict request/response schemas,
  producer/routes и web consumer, negative private-field assertions.
- Auth/permissions/privacy: REQUIRED, PASS — actor matrix, own-only routes,
  current password, session snapshot, masked projection и Yandex exclusion.
- State change/async: REQUIRED, PASS — duplicate, resend, retry, expiry, replay,
  confirmation/cancellation race, worker lease и rollback.
- Prisma/persistence: REQUIRED, PASS локально — generated migration, clean
  PostgreSQL 18 и concurrency tests; production backup/restore BLOCKED.
- Module/platform dependency: REQUIRED, PASS — architecture check проверил 323
  source files, typecheck/build прошли.
- UI behavior: REQUIRED, PASS — user-visible Playwright flow.
- Visual/responsive/accessibility: REQUIRED, PASS для rendered viewports,
  labels/dialog focus; screen-reader/real-user usability NOT RUN до release.
- Form/input purpose: REQUIRED, PASS — `email`, `current-password`, numeric
  one-time code, autocomplete и independent server validation.
- Image/icon semantics: N/A — информативные изображения/иконки не добавлялись.
- Public website/SEO: N/A — public website не менялся.
- Secrets/dependencies/source: REQUIRED, PASS — staged/worktree secret checks,
  Gitleaks, dependency audit, Semgrep и Trivy без findings.
- Docker/IaC/exact image: REQUIRED, PASS локально — readiness и DB-backed auth
  smoke собранного image, Trivy OS/application 0; production exact image
  BLOCKED до release.
- Performance: N/A — bounded own-user/policy queries вне hot gameplay path;
  отдельной latency-гипотезы нет.
- Legal/support copy: N/A — legal/support contract не менялся.
- Release/production/network: BLOCKED — отдельное разрешение, exact SHA, CI,
  issue #36, backup и post-deploy evidence обязательны позднее.
