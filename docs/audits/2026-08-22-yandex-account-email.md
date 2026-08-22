# Аудит синхронизации Yandex Account Email

Дата: 2026-08-22
Этап: implementation, без production-изменений.
Срез: issue #35, ветка `dev`; Yandex OAuth, auth application/persistence,
Approved Mail Service, shared contract, player profile и Prisma migration.

## Scope and protected invariants

Основной инвариант: Yandex Account Email является обновляемым атрибутом уже
привязанной provider identity, но никогда не становится способом найти,
объединить или перепривязать аккаунт. Один canonical key может принадлежать
только одному активному аккаунту.

Точки входа и trust boundaries:

- Yandex OAuth consent и user-info response → provider adapter;
- непроверенный `default_email` → bounded parser → Account Email canonicalizer;
- auth application → единая PostgreSQL-транзакция identity, Account Email и
  session;
- приватные provider/canonical values → безопасная server-side проекция →
  shared contract → профиль игрока;
- удаление аккаунта → очистка identity, sessions и Account Email в одной
  транзакции.

Акторы: анонимный посетитель, владелец password-аккаунта, владелец Yandex
identity, другой аутентифицированный пользователь, OAuth-провайдер и атакующий,
способный вернуть некорректный или чрезмерно большой provider response.

## Acceptance criteria

1. Yandex consent запрашивает `login:email`; user-info ограничен по размеру и
   схеме, а ошибки не раскрывают payload.
2. Provider value и canonical key хранятся раздельно. Domain приводится к
   lowercase/IDNA; alias-правила берутся только из опубликованной политики.
3. Identity определяется только парой provider/subject. Совпадение email не
   объединяет аккаунты; конфликт не блокирует вход уже привязанной identity и
   не раскрывает владельца.
4. Параллельное создание с одним canonical key даёт одного владельца, а
   проигравшая новая регистрация полностью откатывается. Уже привязанная
   identity при таком конфликте продолжает вход с безопасным profile state.
5. Смена адреса освобождает старый key только при успешном commit; удаление
   очищает email/identity/session и позволяет независимому новому аккаунту
   занять освобождённый key.
6. Yandex account не получает локальный password/recovery control. Профиль
   показывает только маску или bounded state без полного адреса.

## Threat review

| Boundary | Threat | Concrete path and impact | Control and evidence |
| --- | --- | --- | --- |
| Yandex response → parser | Information disclosure, denial of service | Вернуть большой или содержащий чувствительные данные payload и спровоцировать его логирование | Response ограничен 16 KiB и bounded Zod-схемой; reader отменяется при переполнении; наружу выходит общее сообщение без body; adapter tests покрывают oversize/redaction |
| Email → identity | Spoofing, elevation | Использовать совпадающий email, чтобы войти в чужой аккаунт или объединить записи | Репозиторий ищет identity только по provider/subject; email участвует только в проверке владения canonical key; concurrent integration подтверждает две разные users/identities/sessions |
| Canonicalization | Tampering, account collision | Глобально удалить точки или `+tag` и ошибочно склеить адреса разных сервисов | Domain lowercase/IDNA; локальная часть сохраняется без published service rule; сервисные flags применяются отдельно и покрыты unit tests |
| Concurrent sign-in | Race, replay | Два новых subject одновременно заявляют один key либо уже связанная identity повторяет OAuth completion | HMAC advisory locks для identity и отсортированных old/new keys, unique index и retryable transaction; у новых регистраций проигравшая транзакция откатывается, а linked sign-in получает conflict state |
| Persistence → API/UI | Information disclosure | Получить полный Account Email через API, ошибку конфликта или профиль | Auth route не принимает object ID и возвращает только own state; маскирование выполняется сервером; strict contract отвергает raw address; browser test проверяет отсутствие полного значения |
| Address change/deletion | Integrity, recovery failure | Освободить старый key при откатившейся смене или оставить PII после удаления | Identity/email/session update выполняется в одной транзакции; forced rollback сохраняет прежний key; delete integration доказывает очистку и независимое повторное использование |

## Actor and resource matrix

| Resource or operation | Anonymous | Password account owner | Yandex account owner | Other authenticated user / operator |
| --- | --- | --- | --- | --- |
| `GET /api/auth/account-protection` | `401` | Только `password_unprotected` | Только собственный masked/ conflict/unavailable state | Получает только собственное состояние; endpoint не принимает user ID, operator override отсутствует |
| OAuth completion | Без одноразовой transaction/consent новая запись не создаётся | Не связывается по email | Обновляет только identity с тем же provider/subject | Совпадающий email не даёт доступ и не раскрывает owner |
| Full provider/canonical value | Нет доступа | Нет доступа | Нет доступа через API | Нет доступа через player/operator API; только приватные DB fields |
| Delete account | Нет | Только собственный аккаунт после recent auth | Только собственный аккаунт после recent auth | Нет cross-user command |

## Concurrency, replay and recovery

| Scenario | Expected persisted outcome | Evidence |
| --- | --- | --- |
| Два новых Yandex subject одновременно используют один canonical key | Один user/identity/session получает `yandex_managed`; проигравшая регистрация откатывается с generic OAuth failure | PostgreSQL integration с параллельными completions |
| Уже привязанная identity синхронизирует занятый key | Вход и новая session сохраняются; старый key освобождается, значения очищаются, state становится `yandex_conflict`; merge отсутствует | PostgreSQL integration после отдельной свободной регистрации |
| Повторный вход того же subject | Обновляется тот же user; новая session; email refresh атомарен | Identity advisory lock и transaction boundary |
| Ошибка записи session после смены email | Вся смена откатывается, старый key остаётся у пользователя | Forced duplicate-session rollback integration |
| Успешная смена email | Новый key закреплён, старый освобождён после commit | PostgreSQL integration |
| Удаление и повторное использование | Identity/session/email очищены; новый subject получает другой user ID и освобождённый key | PostgreSQL integration |
| Missing/invalid/unavailable provider email | Sign-in сохраняется, account protection становится `yandex_unavailable`, сырое значение не хранится | Application fallback и DB state constraints |

## Persistence and rollout

Migration делает `password_hash` nullable, заменяет исторический OAuth sentinel
`OAUTH_USER` на `NULL`, добавляет private provider/canonical fields, unique index
и CHECK constraints для согласованности state/value pair. Чистая PostgreSQL 18
база успешно применила все 23 migrations, после чего прошёл полный DB-backed
набор.

Порядок релиза: backup и проверка restore point → `prisma migrate deploy` → API
и worker из одного exact image → OAuth/profile smoke. Старый runtime допускает
nullable password в verification path, а старая OAuth-запись со sentinel всё ещё
валидна для новой nullable колонки; это сохраняет краткий rolling/rollback
переход. Production backup/restore drill и rollback exact image в этот срез не
входят.

## UX pilot and rendered inspection

UX pilot: RUN. Отдельно от автоматизации выполнен rendered walkthrough профиля:

- managed state: 1440×900, 1024×768 и 390×844 — маска читается, карточка не
  создаёт horizontal overflow, локальных recovery controls нет;
- conflict state: 1440×900 и 390×844 — warning заметен, но не сообщает чужой
  адрес и явно сохраняет вход через Yandex;
- generic OAuth callback failure: 1440×900 и 390×844 — alert читается до
  способов входа, internal cause удалён из URL и не отображается, horizontal
  overflow отсутствует;
- keyboard: первый `Tab` после callback failure переводит focus на выбранную
  вкладку «Вход»; alert объявлен через `role=alert`;
- browser console: ошибок и предупреждений не обнаружено.

Это ручная проверка конкретных состояний, а не заявление о полном usability
исследовании с реальными пользователями.

## Findings and residual risk

Pre-commit review обнаружил P1 spec mismatch: общий conflict branch ошибочно
разрешал только что созданной второй Yandex identity сохранить user/session с
занятым email. Failing PostgreSQL test воспроизвёл две успешные регистрации.
Репозиторий теперь различает новую и уже связанную identity после защищённого
lookup: occupied key откатывает всю новую регистрацию с generic callback
failure, а существующая identity продолжает вход с `yandex_conflict`.
Повторный полный integration run прошёл. Security review итогового кода не
нашёл других подтверждённых P0–P2 дефектов в identity binding, privacy
projection, transaction/race handling, deletion или provider response boundary.

В полном integration gate обнаружена и устранена независимая нестабильность
outbox-тестов: их фиксированное календарное время могло оказаться раньше
DB-generated `available_at`. Сценарная шкала теперь вычисляется относительно
момента запуска; product-код и outbox semantics не менялись.

Остаточные риски:

- реальный Yandex consent, доступность `default_email` и поведение production
  application не проверены локальными doubles; обязательный следующий шаг —
  provider roundtrip по Yandex runbook на exact release image;
- production migration, backup/restore и rollback smoke не выполнялись;
- password-account Recovery Email и self-service recovery относятся к следующим
  MVP issues и не реализуются этим срезом;
- Active DAST: NOT RUN. Изменённая identity/email граница лучше доказывается
  отрицательными contract/application/PostgreSQL/browser tests; атаки на
  production запрещены.

## Validation

- Primary signal: PASS — PostgreSQL registration-race/linked-conflict/change/
  rollback/delete/reuse scenario прошёл вместе с 82/82 integration tests и
  782 assertions.
- Targeted behavior: PASS — 29/29 provider, canonicalizer, auth application,
  shared contract и web API tests.
- Producer/consumer types: PASS — backend и webapp typecheck.
- Architecture boundary: PASS — `bun run architecture:check`.
- Browser behavior: PASS — isolated Playwright managed/conflict profile states;
  full raw email отсутствует.
- Full repository gate: PASS — `bun run check:push`, включая dependency audit,
  full-history Gitleaks, lint, Prisma validation, typecheck, architecture, все
  tests/builds, Docker DB-backed smoke и 37/37 Playwright E2E.
- Static/security gates: PASS — Semgrep 0 findings, Trivy config 0
  misconfigurations; exact local `anomaly-detector-backend:smoke` image scan
  показал 0 OS и 0 application vulnerabilities.

## Audit checklist

- Shared contract/API shape: REQUIRED, PASS — strict producer/consumer schema,
  masked success states и rejection полного address.
- Auth/permissions/privacy: REQUIRED, PASS — actor matrix, own-only route,
  no-link integration и safe projection.
- State change/async: REQUIRED, PASS — duplicate/race/rollback/delete/reuse.
- Prisma/persistence: REQUIRED, PASS локально — fresh migration и real
  PostgreSQL; production backup/restore BLOCKED до release.
- Module/platform dependency: REQUIRED, PASS.
- UI behavior: REQUIRED, PASS — user-visible Playwright states.
- Visual/responsive/accessibility: REQUIRED, PASS для semantic status/alert и
  rendered desktop/tablet/mobile; real-user usability N/A для implementation.
- Form/input purpose and image semantics: N/A — поля и изображения не менялись.
- Public website/SEO: N/A — public surface не менялся.
- Secrets/dependencies/source: REQUIRED, PASS — tracked/staged hygiene,
  dependency audit, full-history Gitleaks и Semgrep.
- Docker/IaC/exact image: REQUIRED, PASS для локального smoke image и Trivy;
  production release image/digest BLOCKED до release.
- Performance: N/A — новый read делает bounded own-user query; hot gameplay path
  не менялся.
- Legal/support copy: N/A — legal documents и support contract не менялись.
- Release/production/network: BLOCKED — отдельное разрешение, exact SHA, CI,
  provider setup, migration/backup и post-deploy evidence обязательны позднее.
