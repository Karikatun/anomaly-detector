# Аудит Recovery Code

Дата: 2026-08-22
Этап: implementation, без production-изменений.
Срез: issue #39; shared contracts, auth application/transport, PostgreSQL
persistence, transactional outbox, профиль и публичное восстановление игрока.

## Scope and protected invariant

Основной инвариант: ровно восемь высокоэнтропийных Recovery Code показываются
владельцу один раз, в persistence попадают только HMAC-производные, а успешное
применение одного кода атомарно уничтожает весь набор и остальные recovery
credentials.

Trust boundaries:

- authenticated password-account с активным Recovery Email → первая
  одноразовая выдача;
- current password + код активного Recovery Email → перевыпуск набора;
- anonymous login + Recovery Code → password reset или начало замены
  недоступного Recovery Email;
- owning PostgreSQL transaction → HMAC-сравнение, durable budgets,
  session/token/challenge revocation, email uniqueness/policy и outbox;
- one-time API response → локальные copy, .txt и print без query cache, URL,
  email, analytics и operator projection.

Акторы: анонимный посетитель, владелец password-account, владелец Yandex
identity, другой игрок, оператор/support, почтовый провайдер и атакующий с
известным login.

## Acceptance criteria

1. Выдаётся ровно восемь уникальных 128-bit кодов; plaintext возвращается только
   в response команды выдачи или перевыпуска.
2. Профиль даёт copy, .txt, print, acknowledgement и явно предупреждённый skip,
   но не блокирует tutorial/gameplay.
3. Обычное чтение защиты возвращает только not_issued, available или consumed;
   raw code, hash и canonical key отсутствуют.
4. Один код с login меняет пароль или подтверждает право на новый Recovery
   Email; адрес проходит Approved Mail Service, email-code confirmation и
   24-hour cooling-off.
5. Successful consume в одной transaction отзывает все sessions, links, mail
   codes, recovery tokens и оставшиеся Recovery Code.
6. Перевыпуск требует current password и код активного Recovery Email; старый
   набор уничтожается атомарно.
7. Missing/invalid login/code, exhausted budget, Yandex-only и absent account
   неразличимы до successful proof; operator/support bypass отсутствует.

## Threat review

| Boundary | Threat and impact | Control and evidence |
| --- | --- | --- |
| Public login/code | Enumeration и brute force чужого account | Uniform accepted, dummy constant-time HMAC compare, HMAC-only login/IP keys, durable 3/hour + 5/day login и 10/hour + 30/day IP budgets |
| Budget → password hash | Неограниченный Argon2 DoS | Budget резервируется в PostgreSQL до expensive hash; unit test доказывает, что exhausted path не вызывает hasher |
| Code → persistence | Plaintext или replay после утечки БД | Domain-separated HMAC derivatives, constant-time compare, set-level consumed state и удаление remaining rows |
| Parallel consume/reissue | Две winning operations или partial revocation | Per-user advisory lock, owning transaction, unique active set/challenge/replacement constraints и PostgreSQL concurrency tests |
| Email replacement | Код переносит чужой или заблокированный адрес | Current policy и uniqueness внутри transaction; старый binding жив до new email code; success включает cooling-off |
| API/UI/cache | Raw code остаётся в normal state, URL или artifacts | Strict one-time response; local component state; mutation gcTime 0 + reset; POST body only; auth E2E отключает screenshot/trace/video; DOM redaction asserted |
| Outbox/deletion | Код отменённого flow приходит или остаётся в БД | Queued mail cancellation/redaction в owner transaction; deletion cleans set, challenge, replacement и credentials; leased-mail residual не делает code valid |

## Actor and resource matrix

| Operation | Anonymous | Own password session | Yandex / outsider / operator |
| --- | --- | --- | --- |
| Read state | 401 | Own bounded status без raw codes | Provider-managed или только собственный account; operator projection нет |
| Issue | 401 | Только после active Recovery Email, один набор | Capability/bypass отсутствует |
| Reissue | 401 | Current password + active Recovery Email code | Capability/bypass отсутствует |
| Password/email recovery | Login + one valid code; generic failure | Допустим без session | Yandex/absent/invalid неразличимы; operator route нет |
| Raw values/hash/budget keys | Нет доступа | Plaintext только в one-time response | Нет в player/operator API |

## Concurrency, replay and recovery

| Scenario | Expected persisted outcome | Evidence |
| --- | --- | --- |
| Duplicate/parallel issue | Один active set; duplicate не показывает новый plaintext | PostgreSQL integration |
| Parallel/replayed consume | Один success; весь set consumed, sessions отозваны | PostgreSQL integration |
| Reissue | Password + mail code создают один новый set; old set невалиден | PostgreSQL integration |
| Email outbox conflict | Code не consumed, sessions/budgets/replacement не изменены | Forced identity-conflict rollback test |
| Standard email replacement | Success уничтожает Recovery Code set | PostgreSQL integration |
| Restart/deletion | Hash-only state восстанавливается; deletion удаляет set/challenges/replacement и redacts queued mail | Fresh adapter + deletion integration |

## Persistence and rollout

Миграция 20260822171435_add_recovery_codes добавляет RecoveryCodeSet,
RecoveryCode, RecoveryCodeReissueChallenge и RecoveryCodeEmailReplacement с
cascade foreign keys, unique ownership/message constraints и
deadline/canonical indexes. Все 26 migrations применяются на чистой PostgreSQL
18 базе; backfill не нужен.

Production rollout остаётся отдельной операцией: owner-gated issue #36 →
backup/restore point → prisma migrate deploy → API/worker из одного exact image
→ контролируемая выдача, перевыпуск и применение без сохранения code response в
access logs/traces.

## UX pilot and rendered inspection

UX pilot: RUN. Primary journey — один раз показать и сохранить восемь кодов;
secondary journey — без session восстановить пароль или недоступную почту.
Отказ или откладывание не блокирует gameplay.

Rendered walkthrough actual app проверил оба публичных режима:

- 1440×900: полная иерархия и CTA без overflow;
- 1024×768: после compact-height коррекции панель и footer внутри viewport;
- 390×844: tabs, labels, fields и CTA без horizontal/vertical overflow;
- accessibility tree содержит heading, labelled tablist/tabpanels, labels и
  нативный keyboard order;
- one-time sheet проверен в Playwright без screenshot/trace/video: восемь кодов,
  .txt, print, acknowledgement, warning и DOM redaction.

Первый render 1024×768 имел vertical overflow; height-responsive коррекция
уменьшила gaps/padding, повторная geometry показала 608 px высоты панели и no
overflow. Входящих Agentation-аннотаций не было. Реальное user study и полный
screen-reader walkthrough не запускались.

## Findings and residual risk

До коммита найдены и исправлены:

- P1: public password recovery делал Argon2 до durable budget. Бюджет перенесён
  перед hash и закреплён unit test;
- responsive: панель обрезалась на 1024×768; compact-height layout устранил
  overflow без изменения mobile/desktop hierarchy;
- quality gate: dev-only Agentation мог блокировать обычные E2E. Обычный
  Playwright не монтирует audit overlay, UX audit mode сохраняет его;
- E2E race: public recovery открывался до завершения guest-session bootstrap и
  ленивой загрузки маршрута. Сценарий синхронизирован по response и полной
  готовности route, затем прошёл вместе со всеми 22 auth tests.

Остаточные риски:

- production access logs, proxy traces и browser extension/cache boundary не
  проверены на реальном one-time response; deployment должен доказать redaction;
- владелец явно выносит plaintext в clipboard/.txt/print — это целевой
  user-held boundary, не server-side storage;
- Argon2 остаётся bounded operational cost в пределах durable quotas;
- live REG.RU receipt, SPF/DKIM/DMARC и provider alerting — owner-gated #36;
- production migration, backup/restore, rollback и exact-SHA CI не выполнялись;
- Active DAST: NOT RUN; production не атакован, boundary покрыт negative
  contract/PostgreSQL/browser tests.

## Validation

- Primary signal: PASS — 107/107 PostgreSQL integration tests, 1059 assertions.
- Backend unit: PASS — 217/217, 862 assertions.
- Shared contracts: PASS — 36/36; targeted contract/profile/public API 20/20.
- Webapp unit: PASS — 163/163, 520 assertions.
- Fresh migration: PASS — 26/26 migrations on PostgreSQL 18.
- Targeted browser: PASS — Recovery Code 2/2; full auth file 22/22.
- Rendered behavior: PASS — 1440×900, 1024×768 и 390×844.
- Full browser suite: PASS — 41/41 Playwright scenarios.
- Full repository gate: PASS — bun run check:push, включая dependency audit,
  Gitleaks, secret hygiene, lint, Prisma, typecheck, architecture, all
  tests/builds, Docker readiness и DB-backed auth smoke.
- Static/security: PASS — dependency audit 0 vulnerabilities; Gitleaks/secret
  hygiene без утечек; Semgrep, Trivy config и exact smoke image без findings.

## Audit checklist

- Shared contract/API: REQUIRED, PASS — schemas, routes, consumers и
  private-field rejection.
- Auth/permissions/privacy: REQUIRED, PASS — auth-only issue/reissue,
  non-enumerating public use, HMAC-only persistence и one-time projection.
- State/async/recovery: REQUIRED, PASS — duplicate, parallel consume, replay,
  reissue, outbox conflict, restart, standard replacement и deletion.
- Prisma/persistence: REQUIRED, PASS локально; production restore BLOCKED.
- Module dependency: REQUIRED, PASS — architecture check.
- UI/rendered/accessibility/form purpose: REQUIRED, PASS для tested flow;
  real-user и full screen-reader study NOT RUN.
- Images/icons: N/A — новые изображения и иконки не добавлялись.
- Public website/SEO: N/A — website не менялся.
- Secrets/dependencies/source: REQUIRED, PASS.
- Docker/IaC/exact image: REQUIRED, PASS локально; production exact image BLOCKED.
- Performance: REQUIRED, PASS для bounded abuse path; production capacity
  evidence BLOCKED до release.
- Legal/support copy: REQUIRED, PASS — operator/support bypass отсутствует.
- Release/production/network: BLOCKED — нужны отдельное разрешение, issue #36,
  backup/restore, exact SHA и post-deploy evidence.
