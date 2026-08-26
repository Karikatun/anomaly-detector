# Аудит повторной попытки входа в комнату

Дата: 2026-08-23
Этап: implementation, без production-изменений.
Срез: стабилизация конкурентного входа в четырёхместную комнату, обнаруженная
полным gate issue #40.

## Root cause and invariant

Четыре почти одновременных join-команды выполняются в serializable PostgreSQL
transactions. Репозиторий уже повторял конфликт `P2034` при подтверждении
готовности, но `join` завершался первой ошибкой сериализации. В браузерном
четырёхпользовательском сценарии это иногда оставляло одного игрока вне комнаты.

Инвариант: одна join-команда либо целиком добавляет игрока и возвращает
authoritative Room, либо не меняет состояние. Только retryable Prisma `P2034`
повторяет всю owning transaction; остальные ошибки не маскируются.

## Implementation and risk review

- `join` делает не более трёх serializable attempts;
- между конфликтами используется bounded backoff 10/20 ms;
- каждая попытка заново проверяет room status/capacity, membership и
  `CurrentMatch`, поэтому частичный результат не переносится между attempts;
- существующее безопасное отображение unique `CurrentMatch` conflict сохранено;
- API contract, схема БД, права доступа, join-code privacy и UI не менялись;
- бесконечного retry loop или новой нагрузки на обычный успешный путь нет.

Конкретных P0–P2 security findings в срезе не найдено. Active DAST: N/A —
публичная поверхность и разрешения не менялись.

## Validation

- Targeted repository unit: PASS — 3/3, включая `P2034` → retry → success.
- Targeted four-player browser regression: PASS — 2/2 сценария.
- Full `check:push`: PASS — 219 backend unit, 113 PostgreSQL integration,
  DB-backed Docker smoke и 42/42 browser E2E.
- Security gates: PASS — dependency audit, tracked secrets, Gitleaks, Semgrep,
  Trivy config и exact local image scan без блокирующих находок.

## Audit checklist

- Product/gameplay: REQUIRED, PASS — конкурентный join больше не теряет игрока.
- Auth/permissions/privacy: REQUIRED, PASS — actor/resource boundary не менялся.
- Concurrency/recovery: REQUIRED, PASS — whole-transaction bounded retry.
- Persistence/migration: REQUIRED, PASS — schema не менялась; clean PostgreSQL
  integration и Docker smoke зелёные.
- API/contracts/UI/accessibility: N/A — внешнее поведение и интерфейс не менялись.
- Performance: REQUIRED, PASS локально — максимум три attempts и 30 ms backoff;
  production contention evidence ещё не собрано.
- Release/production: BLOCKED — push, deploy и production observation требуют
  отдельного разрешения и exact SHA.
