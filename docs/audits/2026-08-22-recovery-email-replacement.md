# Аудит замены Recovery Email

Дата: 2026-08-22
Этап: implementation, без production-изменений.
Срез: issue #38, ветка `dev`; shared contracts, auth application/transport,
PostgreSQL persistence, Approved Mail Service policy, transactional outbox и
профиль игрока.

## Scope and protected invariant

Основной инвариант: активный Recovery Email остаётся единственным действующим
адресом, пока владелец password-аккаунта не подтвердит независимые одноразовые
коды со старого и нового адресов. Ни пароль без доступа к старой почте, ни одна
частично подтверждённая сторона, ни конкурентная команда не должны перенести
владение адресом.

Точки входа и trust boundaries:

- current password и новый адрес из player webapp → strict shared contract →
  auth application;
- старый binding и новый адрес → current Approved Mail Service policy →
  отдельные provider value и canonical key;
- owning PostgreSQL transaction → два HMAC code hash, независимые сроки и
  попытки, HMAC-only abuse budgets, binding и transactional outbox;
- authenticated session → own-user masked projection; только initiating session
  получает управляющие действия;
- успешная замена → отзыв остальных sessions, очистка существующего challenge,
  удаление replacement и security notification на старый адрес.

Акторы: анонимный посетитель, владелец в initiating session, тот же владелец в
другой session, владелец Yandex identity, другой пользователь, оператор,
почтовый провайдер и атакующий с украденными login/password.

## Acceptance criteria

1. Start требует current password, активный старый Recovery Email и новый адрес
   из текущей опубликованной Approved Mail Service policy.
2. Старый и новый факторы имеют отдельные masked state, message ID, HMAC hash,
   15-минутный срок, пять попыток и factor-specific resend invalidation.
3. До атомарного подтверждения обеих сторон старый binding не изменяется.
4. Финальная transaction повторно проверяет Account Email/Recovery Email
   uniqueness без раскрытия владельца и сериализуется с изменениями mail policy.
5. Success оставляет текущую session активной, отзывает остальные, удаляет
   существующий Recovery Email challenge и возвращает явный bounded result.
6. Replay, partial/parallel confirmation, expiry, provider block/deprecation,
   restart, outbox conflict, cancellation и account deletion fail closed.
7. Yandex-managed account, другая session и operator/support не могут начать,
   подтвердить, отменить или вручную одобрить replacement.

## Threat review

| Boundary | Threat and impact | Control and evidence |
| --- | --- | --- |
| Session/password → start | Украденная или новая session закрепляет адрес без старой почты | `requireAuth`, current-password verification и повторное сравнение password hash внутри transaction; оба email-фактора обязательны |
| Address → canonical owner | Alias collision или раскрывающий конфликт переносит чужой адрес | Canonicalization только из опубликованной policy, общие `account-email` advisory locks, обе ownership-таблицы и safe conflict |
| Policy read → binding commit | Оператор переводит сервис в `deprecated`/`blocked` между pre-check и commit | Auth transaction использует тот же mail-policy advisory lock, что publication/status command, затем перечитывает current version; новый адрес требует `approved`, старый — delivery-allowed |
| Code/outbox → replay | Код читается из БД, повторяется или остаётся валидным после resend/cancel | Отдельные domain-separated HMAC hashes, TTL, пять попыток, stable purpose, queued-only cancellation и удаление replacement в owning transaction |
| Parallel factors → partial commit | Два confirm либо confirm/cancel оставляют новый binding с одной стороной | Per-user/old/new sorted advisory locks; binding меняется только после обеих valid factors в одной transaction |
| Session authority | Другая session управляет pending replacement | Persisted `requestingSessionId`; read-only masked state для остальных; mutations получают `403` без object ID input |
| Persistence → API/UI | Утечка полного адреса, canonical key, code/hash или чужого состояния | Own-user route, server-side masking, strict response schema и browser assertion об отсутствии raw values |
| Deletion/failure | Удалённый account оставляет адрес или письмо; outbox failure даёт partial state | Cascades и owner transaction очищают replacement/binding/challenge; queued mail redacted; forced outbox conflict откатывает оба фактора и budgets |

## Actor and resource matrix

| Operation | Anonymous | Initiating password session | Other own session | Yandex / outsider / operator |
| --- | --- | --- | --- | --- |
| Read replacement | `401` | Own masked old/new state, `canManage=true` | Own masked read-only state | Yandex получает provider-managed state; outsider — только свой account; operator projection отсутствует |
| Start | `401` | Current password + active old binding + approved new service | Может начать только при отсутствии pending replacement и только для своего account | Yandex отклонён; чужой user ID не принимается; operator command отсутствует |
| Resend/confirm/cancel | `401` | Только собственный pending replacement и initiating session | `403` для mutation | Нет bypass или capability |
| Private values/code/budget keys | Нет доступа | Не возвращаются | Не возвращаются | Не входят в player/operator API |

## Concurrency, replay and recovery

| Scenario | Expected persisted outcome | Evidence |
| --- | --- | --- |
| Partial confirmation | Старый binding не меняется; отдельно виден masked factor status | PostgreSQL integration + shared contract |
| Resend old/new | Меняется только выбранный message/hash/expiry; прежний code invalid | PostgreSQL restart/resend integration |
| Пять попыток/expiry/replay | Factor остаётся invalid; завершённый replacement повторно не потребляется | PostgreSQL integration |
| Два accounts выбирают один new canonical key | Один complete, второй получает safe conflict и сохраняет старый binding | Parallel PostgreSQL integration |
| Provider deprecated/blocked | Deprecated разрешает старую доставку, но не новый binding; blocked останавливает обе стороны | Current-policy projection и transaction-safe policy recheck tests |
| Outbox conflict | Replacement и все budget writes откатываются | Forced second-message identity conflict integration |
| Cancel после partial confirm | Только initiating session удаляет pending replacement; старый binding остаётся | Multi-session PostgreSQL integration |
| Account deletion | Оба queued factor messages redacted, replacement/binding удалены | PostgreSQL integration |

## Persistence and rollout

`20260822155719_add_recovery_email_replacement` добавляет отдельную replacement
table с cascade foreign keys, unique user/session/message constraints, old/new
HMAC-factor fields и deadline/canonical indexes. Все 25 migrations применены на
чистой PostgreSQL 18 базе перед полным integration-набором; backfill не нужен.

Production release остаётся отдельной операцией: owner-gated issue #36 → backup
и restore point → `prisma migrate deploy` → API/worker из одного exact image →
реальная доставка на старый и новый controlled mailbox → rollback evidence.

## UX pilot and rendered inspection

UX pilot: RUN. Цель игрока — безопасно заменить активный адрес, отдельно понять
состояние старого и нового факторов и в любой момент отказаться без потери
старой защиты. Primary CTA — «Заменить почту»; серверно принятым результатом
считается только completed response после обеих сторон.

Rendered walkthrough локального API/UI проверил ready/start/pending, отдельные
code dialogs, resend, completed, cancel и read-only other-session states:

- 1440×900: active card и primary CTA;
- 1024×768: start dialog и два factor blocks;
- 390×844: factor blocks и actions складываются без horizontal overflow;
- закрытие dialog очищает email/password/code и возвращает keyboard focus;
- UI показывает только masked addresses; console errors/warnings отсутствуют.

Входящих Agentation-аннотаций не было. Axe и полный screen-reader walkthrough
не запускались; semantics, labels, focus return и mobile input purpose проверены
напрямую. Автоматизированный Playwright отдельно доказывает поведение, но не
подменяет human usability study.

## Findings and residual risk

Pre-commit review нашёл P1 TOCTOU: первоначальный вариант проверял current mail
policy до auth transaction, поэтому status мог измениться перед binding update.
Исправление вынесло общий policy advisory lock в один infrastructure seam и
повторяет canonicalization/approval внутри owning transaction. Failing test для
`deprecated` стал green; старый binding сохраняется.

Остаточные риски:

- уже leased/физически отправляемое SMTP-письмо нельзя отозвать; его code
  становится недействительным вместе с replacement, а delivery outcome остаётся
  честным;
- Recovery Code и password-reset tokens относятся к следующим issues; текущая
  реализация отзывает все существующие sessions и Recovery Email challenge;
- live REG.RU receipt, SPF/DKIM/DMARC и provider alerting остаются owner-gated
  issue #36;
- production migration, backup/restore, rollback и exact-SHA CI не выполнялись;
- Active DAST: NOT RUN — атаки на production запрещены, auth boundary покрыта
  negative contract/PostgreSQL/browser tests.

## Validation

- Primary signal: PASS — 101/101 PostgreSQL integration tests, 983 assertions,
  включая явное ожидание policy status command на advisory lock owner transaction.
- Targeted contract/API/UI: PASS — auth contract 12/12, profile API 4/4,
  focused backend unit 14/14 и replacement Playwright 1/1.
- Backend unit: PASS — 216/216, 859 assertions.
- Webapp unit: PASS — 161/161, 518 assertions.
- Fresh migration: PASS — 25/25 migrations on PostgreSQL 18.
- Architecture/lint/typecheck: PASS.
- Rendered behavior: PASS — 1440×900, 1024×768 и 390×844.
- Full browser suite: PASS — 39/39 Playwright scenarios.
- Full repository gate: PASS — `bun run check:push`, включая dependency audit,
  Gitleaks, secret hygiene, lint, typecheck, architecture, все tests/builds,
  Docker readiness и DB-backed auth smoke.
- Static/security: PASS — dependency audit: 0 vulnerabilities; Gitleaks: 413
  commits, no leaks; Semgrep: 320 targets, 0 findings; Trivy config: 0
  misconfigurations; exact `anomaly-detector-backend:smoke` image: 0 OS и 0
  application vulnerabilities.

## Audit checklist

- Shared contract/API: REQUIRED, PASS — producer/routes, strict schemas и web
  consumers; private-field rejection.
- Auth/permissions/privacy: REQUIRED, PASS — actor matrix, own-only routes,
  current password, initiating-session authority и masked projection.
- State/async/recovery: REQUIRED, PASS — duplicate, replay, expiry, resend,
  parallel completion, cancellation, policy change, restart и rollback.
- Prisma/persistence: REQUIRED, PASS локально — generated migration, clean
  PostgreSQL 18, concurrency and deletion tests; production restore BLOCKED.
- Module dependency: REQUIRED, PASS — public mail seam и architecture check.
- UI/rendered/accessibility/form purpose: REQUIRED, PASS для tested flow and
  viewports; real-user and full screen-reader study NOT RUN.
- Images/icons: N/A — новые изображения или смысловые иконки не добавлялись.
- Public website/SEO: N/A — website не менялся.
- Secrets/dependencies/source: REQUIRED, PASS — secret hygiene, dependency
  audit, Gitleaks и Semgrep без findings.
- Docker/IaC/exact image: REQUIRED, PASS локально — readiness/DB-backed auth
  smoke и Trivy exact smoke image без findings; production exact image BLOCKED
  до release.
- Performance: N/A — bounded own-user transaction вне gameplay hot path;
  отдельной latency hypothesis нет.
- Legal/support copy: N/A — legal/support contract не менялся.
- Release/production/network: BLOCKED — отдельное разрешение, issue #36,
  backup/restore, exact SHA и post-deploy evidence нужны позднее.
