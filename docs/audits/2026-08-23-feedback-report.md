# Аудит продуктовой обратной связи

Дата: 2026-08-23
Этап: implementation, без production-изменений.
Срез: issue #41; shared contracts, authenticated intake, PostgreSQL,
операторская очередь, daily cleanup, player webapp, adminapp и privacy copy.

## Scope and protected invariant

Основной инвариант: авторизованный игрок может добровольно отправить только
ограниченный Error или Suggestion и получает публичный номер. Исходный текст и
технический контекст после приёма неизменяемы, обычный игрок не может читать или
перебирать отчёты, а оператор имеет только узкий allowlisted workflow с
идемпотентными командами, optimistic version и неизменяемым audit trail.

Trust boundaries:

- authenticated player и trusted client address → strict intake contract →
  HMAC-only account/IP budgets в owning PostgreSQL transaction;
- browser context → enum route template, exact build SHA, coarse device/browser
  и safe error ID без полного URL, raw IP, cookie, token или игрового состояния;
- optional reply email и optional account linkage → разные явные согласия;
  Account Email и Recovery Email автоматически не переиспользуются;
- player receipt → только публичный номер; normal player read/list route
  отсутствует;
- `ADMIN_USER_IDS` operator → concealed admin boundary → только take, resolve,
  reject, record GitHub number и delete contact;
- daily private maintenance → 180 дней для active и 30 дней для
  resolved/rejected/transferred report с каскадным удалением команд и audit.

Акторы: анонимный посетитель, авторизованный игрок, другой игрок, оператор из
allowlist, support без operator capability, trusted proxy и атакующий с
поддельным IP header, report ID или повторённым command ID.

## Acceptance criteria

1. Меню открывает добровольную форму Error/Suggestion с предупреждением не
   передавать пароли, коды, токены, приватные Tender-данные и иные секреты.
2. Strict contract принимает только bounded source fields и безопасный
   технический контекст; attachments, logs, full URL, raw IP, cookies и
   произвольные private fields отклоняются.
3. Reply email и linkage текущего аккаунта включаются раздельно; ни один
   защищённый email не подставляется автоматически.
4. В одной PostgreSQL transaction применяются лимиты 5 принятых reports на
   account и 20 на HMAC trusted-IP за rolling 24 hours вместе с insert.
5. Игрок получает только публичный номер и не имеет My Reports, list/read или
   object-ID access к чужому либо собственному source после отправки.
6. Operator queue скрыта за authentication и `ADMIN_USER_IDS`; неавторизованный
   и неразрешённый доступ получают одинаковый concealed 404.
7. Пять разрешённых operator commands используют `commandId`,
   `expectedVersion`, row/advisory locks и same-transaction audit; исходные поля
   report не редактируются.
8. Удаление контакта не удаляет source; удаление аккаунта снимает только
   optional linkage. Retention удаляет весь report и дочерние records.
9. Автоматической публикации в GitHub и email-уведомления нет: оператор может
   сохранить только проверенный номер уже созданного issue.
10. Player, operator, privacy, concurrency, retention и representative browser
    paths закреплены contract, unit, PostgreSQL и Playwright tests.

## Threat review

| Boundary | Threat and impact | Control and evidence |
| --- | --- | --- |
| Intake body | Секреты или избыточное состояние попадают в persistent report | Strict discriminated schemas, bounded strings, allowlisted route/context enums, forbidden-key contract tests и явное предупреждение в UI |
| Account/IP budget | Spam, обход лимита или race создают лишние reports | HMAC account/IP keys, trusted-proxy address resolver, sorted advisory locks и budget update вместе с insert; parallel PostgreSQL tests |
| Receipt/object ID | IDOR раскрывает source, contact или linked account | Public number — единственная player projection; GET/list player routes отсутствуют; negative route tests |
| Admin boundary | Обычный игрок или support меняет очередь | Bearer authentication, exact `ADMIN_USER_IDS`, concealed 404 и отсутствие admin routes в OpenAPI |
| Operator replay | Повтор или параллельные команды повреждают state/audit | HMAC command fingerprint, unique `commandId`, report lock, `expectedVersion`, idempotent replay и conflict tests |
| Rejection/contact data | Private operator reason или reply email дублируется в audit/command records | Raw contact/reason остаются в operator-only report; command хранит HMAC fingerprint, audit — только безопасный факт операции |
| External publication | Report автоматически утекает в GitHub или email | Нет adapter/worker для публикации; команда принимает только numeric GitHub issue; notification email в срез не входит |
| Retention/deletion | PII и source живут дольше contract или теряется audit раньше report | Daily cleanup удаляет active после 180 дней и terminal/transferred после 30; child command/audit cascade; boundary tests |

## Actor and resource matrix

| Operation | Anonymous | Authenticated player | Allowlisted operator |
| --- | --- | --- | --- |
| Submit report | 401 | Strict bounded intake, 5/account и 20/IP | Через player route только как обычный игрок |
| Read/list report | Нет route | Нет route, включая собственный receipt | Bounded protected queue |
| Take/resolve/reject | Concealed 404 | Concealed 404 | Narrow command + version + audit |
| Record GitHub issue | Concealed 404 | Concealed 404 | Только numeric issue, без auto publish |
| Delete reply contact | Concealed 404 | Нет read/mutation capability | Отдельная narrow command, source остаётся |
| Edit source или назначить автора | Нет | Нет | Нет команды/API |

## Concurrency, replay and recovery

| Scenario | Expected persisted outcome | Evidence |
| --- | --- | --- |
| Parallel account submissions | Не более пяти reports за rolling day | PostgreSQL budget integration |
| Parallel accounts behind one IP | Не более двадцати reports за rolling day | PostgreSQL trusted-IP integration |
| Same command ID and payload | Один state transition и один audit event | Operator integration |
| Same command ID, different payload | Safe command conflict, source/state не меняются | Operator integration |
| Stale/parallel versions | Один winner, остальные получают version conflict | Row-lock PostgreSQL integration |
| Contact deletion | Reply email становится `null`, source и public number сохраняются | Operator integration |
| Account deletion | Optional linked user становится `null`, report живёт до retention | Foreign-key behavior and integration |
| Maintenance restart/retry | Повтор cleanup безопасен; только records за cutoff удаляются | Cleanup integration и idempotent `deleteMany` |

## Persistence and rollout

Миграция `20260822224206_add_feedback_reports` добавляет `FeedbackReport`,
`FeedbackOperatorCommand` и `FeedbackAuditEvent`, nullable linkage к user с
`ON DELETE SET NULL`, unique public/command IDs и индексы очереди/retention.
Backfill не нужен. Все 28 migrations применились на чистой PostgreSQL 18 базе.

Production rollout остаётся отдельной операцией: backup/restore point →
`prisma migrate deploy` → backend → adminapp/webapp из одного exact SHA →
private daily `maintenance:cleanup` → проверка concealed operator access,
trusted-proxy address и retention log. Откат выполняется предыдущими binaries;
additive tables остаются неиспользуемыми, destructive down-migration не нужна.
Push, deploy, production data и внешние GitHub/email действия в срезе не
выполнялись.

## UX pilot and rendered inspection

UX pilot: RUN. Primary journey: меню → добровольный Error/Suggestion → safe
receipt. Postpone возвращает игрока и не блокирует tutorial или gameplay.

Rendered walkthrough actual app:

- 1440×900: форма имеет ясную иерархию, отдельное предупреждение и один primary
  submit;
- 1024×768: sections и operator-independent player flow остаются читаемыми без
  horizontal overflow;
- 390×844: поля, category controls, optional consent и receipt складываются в
  одну колонку без обрезания;
- real authenticated browser journey проверил validation, submitting,
  acceptance, copyable public number, safe request payload и postpone;
- labels, email input purpose, keyboard semantics, live error/status и Axe WCAG
  2 A/AA, 2.1 A/AA, 2.2 AA прошли без violations.

Входящих Agentation-аннотаций не было. Реальное user study и полный
screen-reader walkthrough не запускались. Rendered artifacts находятся только
в ignored `.scratch` и в commit не входят.

## Findings and residual risk

Independent security/spec review текущего diff не выявил конкретных P0–P2.
До завершения уточнён contract: feedback operator commands по ADR 0011 не
требуют recent authentication; защита обеспечивается authentication,
`ADMIN_USER_IDS`, narrow commands, idempotency/version и audit. Private reject
reason исключён из command/audit duplication через HMAC fingerprint.

Остаточные риски:

- production access logs, database encryption-at-rest и trusted-proxy mapping
  не проверялись на реальной инфраструктуре;
- legal/privacy owner должен подтвердить revision 1.1 до production release;
- optional receipt email и 13-месячные anonymous monthly aggregates не
  реализованы; сейчас после retention не остаётся report-derived aggregate;
- daily cleanup, backup/restore и production rollback ещё не отрепетированы;
- Active DAST: NOT RUN; production не атакован, boundary покрыт negative
  contract/PostgreSQL/browser tests.

## Validation

- Primary signal: PASS — real authenticated browser отправил только approved
  fields, получил copyable public number и смог отложить форму без блокировки
  tutorial.
- Full `check:push`: PASS — dependency/secret gates, lint, Prisma validation,
  typecheck, architecture, all unit/integration/browser tests, builds, Docker
  readiness и DB-backed smoke.
- Tests: PASS — 43 shared contracts, 12 adminapp, 223 backend unit, 167 webapp
  unit, 3 website, 123 PostgreSQL integration и 43/43 Playwright scenarios.
- Fresh migration: PASS — 28/28 migrations на PostgreSQL 18.
- Rendered behavior: PASS — 1440×900, 1024×768, 390×844 и mobile receipt.
- Supply-chain/security: PASS — dependency audit 0 vulnerabilities, Gitleaks
  417 commits/0 leaks, secret hygiene, Semgrep и Trivy без blocking findings.
- Active DAST: NOT RUN — только isolated scheduled/manual target разрешён
  policy; production endpoint не сканировался.

## Audit checklist

- Shared contract/API: REQUIRED, PASS — strict schemas, producer, player/admin
  consumers, bounded projections и error paths.
- Auth/permissions/privacy/object ID: REQUIRED, PASS — actor matrix, 401/404,
  no player reads, concealed admin access и safe projections.
- State/async/recovery: REQUIRED, PASS — duplicate command, replay, stale/parallel
  version, retryable ambiguous error, contact deletion и cleanup restart.
- Prisma/persistence: REQUIRED, PASS локально; production backup/restore BLOCKED.
- Module/platform dependency: REQUIRED, PASS — architecture check.
- UI behavior/rendered/accessibility/form purpose: REQUIRED, PASS для tested
  flow; real-user/full screen-reader study NOT RUN.
- Images/icons: N/A — новые изображения и смысловые иконки не добавлялись.
- Public website/SEO: N/A — website не менялся.
- Secrets/dependencies/source: REQUIRED, PASS — audit, Gitleaks, secret hygiene,
  Semgrep и versioned source gates.
- Docker/IaC/exact image: REQUIRED, PASS локально — Docker readiness, DB-backed
  smoke и Trivy; production exact image BLOCKED.
- Backup/storage/cleanup: REQUIRED, PASS для retention integration; production
  schedule и restore drill BLOCKED.
- Legal/privacy copy: REQUIRED, implementation PASS; owner approval BLOCKED до
  release.
- Release/production/network: BLOCKED — отдельное разрешение, exact SHA/CI,
  deploy, trusted proxy, backup/restore и post-deploy evidence нужны позднее.
