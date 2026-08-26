# Аудит восстановления пароля по одноразовой ссылке

Дата: 2026-08-23
Этап: implementation, без production-изменений.
Срез: issue #40; shared contracts, auth application/transport, PostgreSQL,
transactional outbox, публичная webapp-страница и production headers.

## Scope and protected invariant

Основной инвариант: password-account с активным Recovery Email возвращается
владельцу только по одноразовой 15-минутной ссылке. Запрос не раскрывает
существование или тип аккаунта, открытие ссылки ничего не меняет, а один
успешный POST атомарно меняет пароль, уничтожает остальные recovery credentials
и отзывает все сессии без автоматического входа.

Trust boundaries:

- анонимный login и client IP → strict contract → HMAC-only distributed budgets;
- Recovery Email и current Approved Mail Service policy → owning PostgreSQL
  transaction → password-reset credential и transactional outbox;
- случайный mail message ID + server secret → длинный URL token; в persistence
  остаётся только отдельная HMAC-производная токена;
- URL fragment → публичная reset page → немедленное удаление fragment из адреса;
- валидный token + новый пароль → Argon2 hash → атомарная revocation transaction;
- security notification → тот же outbox; фактическая отправка остаётся под
  current mail policy и provider circuit breaker.

Акторы: анонимный посетитель, владелец password-account, владелец Yandex
identity, другой игрок, оператор/support, почтовый провайдер и атакующий с
известным login или перехваченной ссылкой.

## Acceptance criteria

1. Unknown login, отсутствующий Recovery Email, Yandex-only, blocked service,
   exhausted login/IP budget и принятый запрос дают одинаковые `200 accepted`.
2. Login/IP budgets атомарны в PostgreSQL, используют только HMAC keys,
   ограничены часовым/суточным окном и не создают постоянную блокировку.
3. Ссылка действует 15 минут; raw token отсутствует в credential и outbox,
   новый запрос отменяет прежнее queued письмо и credential.
4. GET только показывает форму и очищает URL fragment; POST потребляет
   credential один раз и применяет общую password policy.
5. Страница задаёт `Referrer-Policy: no-referrer`, не монтирует Agentation и не
   обращается к аналитике или third-party origins.
6. Success в одной transaction отзывает все sessions, reset links, mail codes и
   Recovery Codes, меняет пароль, при безопасной delivery policy ставит
   security notification в outbox и не создаёт session.
7. Race, replay, expiry, password-policy failure, restart, deletion и оба вида
   outbox conflict fail closed без частичной смены владельца или доступа.

## Threat review

| Boundary | Threat and impact | Control and evidence |
| --- | --- | --- |
| Public login/IP | Enumeration и массовая рассылка | Uniform accepted response, общая transaction, HMAC-only keys, per-login 3/hour + 5/day и per-IP 10/hour + 30/day budgets |
| Token → storage | Утечка raw reset link из БД, admin projection или outbox | Domain-separated HMAC token derivation и token hash; outbox хранит только token-free base URL; API/admin не проецируют credential |
| Link → browser | Token попадает в access log, Referer, DOM или screenshot artifact | Token передаётся во fragment, fragment сразу заменяется чистым route, `no-referrer`, no third party; E2E отключает screenshot/trace/video и проверяет отсутствие token в DOM |
| GET/POST boundary | Почтовый preview или scanner меняет пароль | GET не вызывает mutation; password update существует только в explicit POST |
| Parallel/replay | Два пароля выигрывают либо ссылка работает повторно | Token hash lookup, sorted per-user/email advisory locks и одна transaction; PostgreSQL concurrency test даёт один `completed` |
| Password reset → access | Старые sessions или другие recovery credentials сохраняют контроль | Transaction отменяет queued credentials, consumes Recovery Code set, обновляет password hash и отзывает все sessions |
| Policy/provider | Заблокированный сервис получает новое recovery письмо | Request повторно читает current mail policy в owning transaction; worker отдельно проверяет policy перед SMTP; notification создаётся только when safe |
| Outbox/deletion | Сбой очереди оставляет новый пароль без обязательной revocation/notification | Credential, password, sessions, Recovery Codes и outbox входят в одну transaction; forced message-ID conflicts доказывают полный rollback |

## Actor and resource matrix

| Operation | Anonymous | Password-account owner | Yandex / outsider / operator |
| --- | --- | --- | --- |
| Request reset | Login + IP, всегда bounded `accepted` | То же; владение не доказывается ответом | Missing/Yandex/blocked неразличимы; operator bypass отсутствует |
| Open form | Любой обладатель URL fragment | GET не потребляет credential | Token не даёт чтения профиля или session |
| Complete reset | Token + password policy | Один success, затем явный sign-in | Invalid/replayed/expired token получает bounded `accepted`; operator route отсутствует |
| Read raw email/token/hash/budget key | Нет доступа | Нет normal API projection | Нет в operator aggregate |

## Concurrency, replay and recovery

| Scenario | Expected persisted outcome | Evidence |
| --- | --- | --- |
| New request | Предыдущий credential удалён, queued mail redacted, действует новый token | PostgreSQL integration |
| Two POST / replay | Один password hash выигрывает; второй и replay получают `accepted` | Parallel PostgreSQL integration |
| Expiry / invalid password | Invalid payload не потребляет token; expired token удаляется без смены password/session | Contract + PostgreSQL integration |
| API restart | Новый composition потребляет сохранённый hash один раз | Fresh app instance integration |
| Request outbox conflict | Budget, credential и mail write полностью откатываются | Forced conflict integration |
| Notification outbox conflict | Password, sessions, Recovery Codes, reset credential и queued mail остаются прежними | Forced conflict integration |
| Account deletion | Credential удалён cascade/owner cleanup, queued recovery mail redacted | Deletion integration |
| Mail ambiguity | Stable message ID и bounded retry сохраняют один logical outbox item | Existing transactional-mail restart/ambiguous integration |

## Persistence and rollout

Миграция `20260822213119_add_password_reset_credentials` добавляет одну active
credential на user, unique token hash/message ID, expiry index и cascade foreign
key. Backfill не нужен. Все 27 migrations применяются на чистой PostgreSQL 18
базе. Локальная development database имела исторический migration drift и не
сбрасывалась; migration создана и проверена только на изолированной test DB.

Production rollout остаётся отдельной операцией: owner-gated #36 → backup и
restore point → `prisma migrate deploy` → API/worker из одного exact image →
контролируемая реальная доставка → проверка access/referrer logs без token →
rollback evidence. В этом срезе push, deploy и DNS/SMTP mutations не выполнялись.

## UX pilot and rendered inspection

UX pilot: RUN. Primary journey: login → generic acceptance → ссылка → новый
пароль → явный sign-in. GET-копия прямо объясняет, что открытие ссылки ничего не
меняет, а success — что прежние сеансы завершены.

Rendered walkthrough actual app:

- 1440×900: ясная иерархия, один primary CTA и два secondary recovery links;
- 1024×768: panel полностью помещается в viewport;
- 390×844: request, reset и validation-error states без horizontal/vertical
  overflow, поля и CTA сохраняют touch-size и читаемый текст;
- URL после открытия fragment становится `/recover/password`, token отсутствует
  в DOM;
- labels, autocomplete, password purpose, alert/status semantics и keyboard
  order подтверждены browser test;
- Axe WCAG 2 A/AA, 2.1 A/AA и 2.2 AA не нашёл violations на request/reset.

Реальное user study и полный screen-reader walkthrough не запускались.

## Findings and residual risk

До коммита найден и исправлен behavioral defect: переход по reset fragment в
уже открытой вкладке был same-document navigation и не переключал React state.
`hashchange` теперь повторно читает bounded token и немедленно очищает адрес;
отдельный real-browser journey закрепляет путь.

Security review текущего diff не выявил конкретных P0–P2. Остаточные риски:

- production reverse-proxy/access logs и browser extensions не проверены на
  реальном домене; URL fragment по стандарту не отправляется серверу, но
  post-deploy evidence всё равно обязателен;
- SMTP acceptance, inbox receipt, SPF/DKIM/DMARC и provider alerting остаются
  owner-gated issue #36;
- при уже leased SMTP сообщении owner cancellation не может отменить физическую
  доставку, но credential к этому моменту уже невалиден;
- Argon2 для completion ограничен общим auth rate limit; token имеет достаточную
  энтропию, однако production abuse/performance evidence ещё не собрано;
- Active DAST: NOT RUN; production не атакован, boundary покрыт negative
  contract/PostgreSQL/browser tests.

## Validation

- Primary signal: PASS — 113/113 PostgreSQL integration tests, 1136 assertions.
- Targeted shared/mail/web tests: PASS — 20/20, 122 assertions.
- Targeted browser journey: PASS — request/reset/session-revocation/sign-in,
  keyboard order и Axe.
- Rendered behavior: PASS — 1440×900, 1024×768 и 390×844.
- Full `check:push`: PASS — lint, typecheck, architecture, 219 backend unit,
  113 PostgreSQL integration, 164 web unit и 42/42 browser E2E; production
  build и DB-backed Docker smoke также прошли.
- Supply-chain/security: PASS — dependency audit 0 vulnerabilities, Gitleaks
  415 commits/0 leaks, Semgrep 326 targets/0 findings, Trivy config 0 HIGH или
  CRITICAL misconfigurations и Trivy exact local image 0 HIGH/CRITICAL
  vulnerabilities.
- Active DAST: NOT RUN — по policy он выполняется только в изолированном
  scheduled/manual окружении, production endpoint в этом срезе не атакован.

## Audit checklist

- Shared contract/API: REQUIRED, PASS — strict request/completion schemas,
  producer/routes, web consumer и error paths.
- Auth/permissions/privacy: REQUIRED, PASS — non-enumerating request, HMAC-only
  persistence, actor matrix, no operator bypass и bounded projection.
- State/async/recovery: REQUIRED, PASS — new request, concurrency, replay,
  expiry, restart, deletion, ambiguous mail и outbox rollback.
- Prisma/persistence: REQUIRED, PASS локально; production restore BLOCKED.
- Module/platform dependency: REQUIRED, PASS — architecture check.
- UI/rendered/accessibility/form purpose: REQUIRED, PASS для tested flow;
  real-user/full screen-reader study NOT RUN.
- Images/icons: N/A — изображения и смысловые иконки не добавлялись.
- Public website/SEO: N/A — website не менялся.
- Secrets/dependencies/source: REQUIRED, PASS — tracked-secret check, dependency
  audit, Gitleaks и Semgrep зелёные.
- Docker/IaC/exact image: REQUIRED, PASS локально — DB-backed smoke, Trivy config
  и exact local image scan; production exact image BLOCKED.
- Performance: REQUIRED, PASS для bounded design; production capacity BLOCKED.
- Legal/support copy: N/A — legal/support contract не менялся.
- Release/production/network: BLOCKED — отдельное разрешение, issue #36,
  backup/restore, exact SHA, CI и post-deploy evidence нужны позднее.
