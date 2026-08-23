# Карта аудитов и проверок веб-приложения

Этот документ отвечает на два вопроса: **что проверять** и **на каком этапе**.
Точные команды и критерии остаются в документах-владельцах: [стратегии
тестирования](TESTING.md), [CI](CI.md), [политике безопасности](../SECURITY.md),
[UX-чек-листе](UX_CHECKLIST.md), [release checklist](RELEASE_CHECKLIST.md) и
[runbook Yandex Cloud](YANDEX_CLOUD.md).

Карта применяется к player webapp, публичному website, операторскому adminapp,
backend, общим контрактам и production-инфраструктуре. Агент сам выбирает и
выполняет проверки по этапу, затронутой поверхности и риску; пользователю не
нужно отдельно просить об аудите.

## Основные правила

1. Сначала определить основной проверяемый сигнал: какое наблюдаемое поведение,
   граница доступа или эксплуатационное свойство должно быть доказано.
2. Автоматический сканер даёт сигнал для разбора, но не доказывает безопасность,
   корректность продукта или отсутствие регрессий.
3. Поведенческая проверка выполняется на самом близком надёжном уровне: unit для
   чистого правила, integration для API/БД/авторизации, E2E для ценного
   пользовательского пути, rendered review для визуального результата.
4. Активные проверки, production-доступ и изменения инфраструктуры выполняются
   только после явного разрешения. Диагностика production по умолчанию
   read-only.
5. Для обычной нетривиальной задачи достаточно основного сигнала и 1–3 проверок,
   способных опровергнуть готовность. Не нужен полный перечень `N/A`; нужно
   явно назвать только заблокированную применимую проверку и остаточный риск.

## Автоматическая маршрутизация по риску

После классификации затронутых поверхностей агент выбирает `Обычный`, если ни
один high-risk триггер не сработал, либо все сработавшие полные профили. Профили
сочетаются: общее evidence можно использовать повторно, но нельзя пропустить
релевантный контур. Выбор профилей, TDD-среза и проверок является обязанностью
агента и не требует напоминания или одобрения пользователя. Разрешение
по-прежнему нужно для production-доступа, активной атаки, внешней передачи
данных и иных рискованных изменений, а не для самого выбора безопасной локальной
проверки.

| Профиль | Автоматический триггер | Минимальный охват |
| --- | --- | --- |
| Обычный | Локальное нетривиальное изменение без high-risk триггера ниже | touched surfaces, основной сигнал, 1–3 наиболее релевантные проверки |
| Cross-layer / product contract | Изменение пользовательского правила, общего контракта либо нескольких слоёв | источник правила, producer/consumers, success/failure/recovery и самый высокий практичный поведенческий сигнал |
| Security / privacy | Auth, permissions, privacy, operator, crypto, rate limit, audit, trust boundary, recovery или sensitive data | автоматический режим `$anomaly-security-review` и его обязательное evidence |
| Persistence / concurrency | Schema, migration, backfill, storage, transaction, worker, replay/race или data lifecycle | реальная PostgreSQL-проверка, совместимость, конкурентность и recovery/rollback в применимой части |
| Substantial UI/UX | Новый или существенно изменённый flow, hierarchy, responsive, focus, semantics или recovery state | `$anomaly-ui`, реальный rendered flow, desktop/mobile, keyboard/focus и recovery |
| Performance | Изменение затрагивает известный или вероятный hot path, bundle/query/load/backlog/disk либо исследует деградацию | автоматически сформулированная измеримая гипотеза, baseline, неизменный сценарий/среда, итоговое измерение и влияние на пользователя/операции |
| Release / production | Push approval, release, deploy, cloud/network/storage mutation или post-deploy | полный release/runbook-профиль, exact SHA/artifact, health, backup/restore и rollback |
| Incident | Подозрение на компрометацию или существенный production-сбой | сохранение evidence, impact, containment, recovery и regression guard |

Полный профиль означает полный применимый охват каждой сработавшей строки, а не
запуск всех инструментов проекта. В нём фиксируют существенные `N/A`, `BLOCKED` и
`NOT RUN`, если без статуса читатель мог бы ошибочно решить, что критичная
граница доказана. Для обычного профиля исчерпывающая матрица статусов запрещена:
она скрывает основной сигнал за церемонией.

## Карта по этапам

После выбора профиля этап определяет ближайшие кандидаты на проверки; строка не
является требованием механически выполнить каждый перечисленный пункт.

| Этап | Базовый ориентир выбранного профиля | Дополнительные проверки по триггеру | Доказательство |
| --- | --- | --- | --- |
| Идея и проектирование | продуктовый контракт, данные и роли, FR/NFR, границы модулей, состояния успеха/ошибки/восстановления | threat review, privacy/legal review, ADR, UX-прототип, внешний API contract | согласованное решение, ADR/issue или обновлённый owning doc |
| Реализация | тест на изменяемое поведение, producer/consumer контракты, typecheck/lint, узкая ручная проверка | PostgreSQL concurrency, auth/IDOR matrix, responsive/accessibility review, performance profile | тест или воспроизводимый сценарий, точные команды и результат |
| Commit и pull request | versioned pre-commit hook с `check:commit`, секреты staged/tracked, review diff и документации | Semgrep, Trivy config, полный `check`, архитектурная проверка | локальный результат и обязательные CI jobs на точном commit |
| Подготовка релиза | полный [release checklist](RELEASE_CHECKLIST.md), exact SHA, green CI, immutable image, backup/restore и rollback | security review, legal/privacy review, migration compatibility, нагрузочная проверка | release record без секретов |
| После развёртывания | внутренние/public health, checksums, CORS/auth/reconnect, логи, мониторинг, rollback artifacts | внешний SSH/TLS/perimeter audit, проверка deployed image, privacy isolation | post-deploy record с точным release SHA |
| Периодический аудит | зависимости, секреты, CI/rulesets, backup/restore, alerts, доступы и истечение ключей | Lynis, ssh-audit, ZAP, accessibility/UX, performance, SEO, storage reconciliation | датированный отчёт, владелец remediation и следующий срок |
| Инцидент или существенный сбой | сохранить доказательства, локализовать границу, минимально сдержать, проверить восстановление | forensic review, selective credential rotation, disclosure/legal review | incident record, root cause, recovery и регрессионная защита |

## Контуры аудита

### Продукт и сценарии

Проверять правила, роли, разрешённые действия, ошибки, отмену, повтор, дедлайны и
восстановление. Изменение считается доказанным только через основной
пользовательский или runtime-сигнал; зелёный вспомогательный тест не перекрывает
сломанный сценарий.

Владельцы доказательств: `docs/GAME_DESIGN_BRIEF.md`, план/issue, contracts,
integration/E2E и фактически отрендеренный интерфейс.

### Архитектура и контракты

Проверять направление зависимостей, владельца бизнес-правила, все producers и
consumers изменённого контракта, сериализацию, чтение/запись и миграционную
совместимость. При изменении module/feature/contract/platform/UI boundaries
запускать `bun run architecture:check`.

Владельцы: [ARCHITECTURE.md](ARCHITECTURE.md), ADR, общие Zod-контракты и тесты
producer/consumer.

### Качество кода и регрессии

Начинать с самого узкого meaningful check, затем расширять до затронутого CI
контура. Для ограниченного изменения, которое будет закоммичено, versioned
pre-commit hook сам выполняет `bun run check:commit`; не запускать ту же команду
вручную, кроме handoff без commit, недоступного hook или диагностики его
падения. Для полного сквозного изменения запускать `bun run check` без
предварительного ручного `check:commit`. Уровни описаны в
[TESTING.md](TESTING.md):

```bash
bun run check:commit
bun run check
```

Полный `check` нужен перед публикацией изменения, но для документационной или
изолированной правки достаточно targeted evidence и успешного pre-commit gate,
если они действительно покрывают изменённую поверхность.

### Безопасность приложения и данных

Для auth, permissions, privacy, personal data, storage, rate limits,
production boundaries, backup/restore и security/legal copy обязателен threat
review из [SECURITY.md](../SECURITY.md). `$anomaly-security-review`
автоматически выбирает `full`, `targeted` или `semantic`: реальное изменение
границы доступа или существующих данных получает полный профиль, локальный
storage/schema-only migration/data-lifecycle риск — только относящиеся к нему
строки, а copy или механическая правка без изменения границы —
semantic-проверку. Отдельно проверять в
применимом объёме:

- unauthenticated, owner/participant, authenticated outsider и operator;
- IDOR и несовпадение actor/resource identifiers;
- replay, duplicate, race, retry, timeout и partial failure;
- входные границы, лимиты, безопасную проекцию и редактирование логов;
- восстановление, удаление, аудит и rollback.

Статические и динамические инструменты дополняют эти проверки:

```bash
bun run security:gitleaks
bun run security:semgrep
bun run security:trivy:config
bun run security:trivy:image <exact-image-reference>
```

`bun run security:zap` запускает активные атаки только против создаваемой им
изолированной `_test` базы. Его запрещено направлять на production или общую
development-среду.

### UI, UX и доступность

Для существенного UI/UX-изменения автоматически использовать `$anomaly-ui` и
пройти реальный отрисованный flow с применимыми состояниями из
[UX_CHECKLIST.md](UX_CHECKLIST.md). Обязательны desktop/mobile, клавиатура и
focus, ошибка и recovery; для существующей поверхности применяется также
промежуточный viewport, если он поддерживается. Формальная CUJ/evidence-матрица
нужна только для нового или существенно перепроектированного критического flow.
Для форм отдельно сверять `type`, `inputmode` и `autocomplete` с назначением
данных, не считая подсказку виртуальной клавиатуре валидацией. Для изображений
проверять роль в конкретном контексте: информативный `alt` либо пустой `alt` для
декоративного или полностью дублирующего соседний текст. Скриншот подтверждает
внешний вид, но не семантику accessibility tree, принятие команды, сохранение,
авторизацию или приватность.

### Производительность и устойчивость

Когда затронутый путь может существенно влиять на latency, bundle, дорогой
запрос, нагрузку БД, reconnect storm, worker backlog или расход диска, агент сам
формулирует измеримую гипотезу и включает performance-профиль. Зафиксировать
исходный и итоговый результат, сценарий, данные и среду. Не оптимизировать по
синтетической метрике, не связанной с пользовательским или операционным риском.

### Public website, SEO и legal

Для публичного website проверять initial HTML, title/description/canonical,
social metadata, robots/sitemap, ссылки, assets, mobile rendering и отсутствие
секретов или приватных данных в статической сборке. Legal/privacy/support copy
должна соответствовать фактическому продукту и рабочим каналам.

### Production и восстановление

Перед релизом и после него использовать [DEPLOYMENT.md](DEPLOYMENT.md),
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) и provider runbook. Обязательны
точный commit, immutable artifacts, backup, доказательство restore, rollback,
internal/public health, логи и мониторинг. Не считать статус VM или контейнера
сам по себе доказательством здоровья приложения.

## Host, SSH и container image

Эти три проверки закрывают разные границы и не заменяют друг друга.

### [Lynis](https://cisofy.com/documentation/lynis/): операционная система VM

Lynis применим к текущей single-VM topology для проверки ядра, системных служб,
прав, журналирования, firewall и hardening ОС.

```bash
sudo lynis audit system
```

- запускать после существенного изменения ОС/образа VM и планово раз в квартал;
- заранее зафиксировать источник и версию инструмента;
- не интерпретировать Hardening Index как вероятность взлома или универсальный
  проходной балл;
- разбирать каждое warning/suggestion по реальному пути атаки, влиянию на
  доступность и способу отката;
- не применять рекомендации автоматически и не менять SSH/firewall/sysctl без
  отдельного плана и разрешения.

Установка пакета и исправления изменяют VM и требуют явного разрешения. Отчёт
может содержать сведения о хосте; хранить только минимальный обезличенный итог.

### [ssh-audit](https://github.com/jtesta/ssh-audit): публичная SSH-граница

Основной аудит выполняется с внешней доверенной машины против фактического
public endpoint; `localhost` показывает только локально доступный протокол и не
доказывает Yandex Security Groups, NAT или внешний reachability.

```bash
ssh-audit --skip-rate-test <public-host>
```

- зафиксировать версию ssh-audit, endpoint, дату и применённую policy;
- отдельно проверить Security Groups, разрешённые source CIDR, password auth,
  users/keys и журналирование;
- не использовать `--dheat` против production: это активный DoS-режим;
- при connection penalties, reset или неполном результате считать аудит
  inconclusive, а не успешным.

### [Trivy](https://trivy.dev/docs/latest/target/container_image/): точный container image и конфигурация

Проект уже использует digest-pinned Trivy. Проверка должна получать точную
ссылку на собранный release image и завершаться ошибкой для настроенных уровней
severity:

```bash
bun run security:trivy:config
bun run security:trivy:image anomaly-detector-backend:<full-commit>
```

Перед завершением релиза сопоставить `docker image inspect` запущенных API и
worker с образом, который прошёл CI. Docker socket передавать только
закреплённому доверенному scanner image. Trivy не проверяет фактические
Security Groups, открытые host ports, runtime secrets, application
authorization, IDOR, replay/race или восстановление.

## Рекомендуемая периодичность

| Проверка | Когда |
| --- | --- |
| CI security-static, tests, exact-image Trivy | каждый pull request/release commit |
| ZAP в изолированной `_test` среде | существующий weekly workflow и перед значимым публичным security-релизом |
| Внешний ssh-audit и perimeter review | ежеквартально и после изменения SSH, VM, сети или Security Groups |
| Lynis | ежеквартально и после существенного обновления ОС/VM image |
| Backup/restore drill | перед рискованной миграцией и по операционному расписанию |
| Branch protection, GitHub permissions и alert routing | ежеквартально и после изменения CI/владельцев |
| UX/accessibility, performance и SEO | перед затрагивающим их релизом и после подтверждённой регрессии |

Периодичность — исходный минимум, а не доказательство выполнения. Для каждой
production-проверки нужен датированный результат и владелец следующего шага.

## Формат отчёта

```text
Этап, профиль и touched surfaces:
Основной сигнал:
Ревизия/среда:

Выбранные проверки:
- <проверка>: PASS/FAIL, точное доказательство

Применимые пробелы:
- <проверка>: BLOCKED/NOT RUN, причина, остаточный риск, следующий шаг

Находки:
- severity, затронутая граница, доказательство, владелец remediation
```

В обычном профиле раздел пробелов опускается, если их нет; `N/A` не
перечисляются. В полном профиле добавляются только существенные `N/A`, нужные
для честной границы покрытия. Агент обязан применять эту карту через
[agent audit checklist](agents/audit-checklist.md); выбор проверки без её
выполнения или явного `BLOCKED`/`NOT RUN` не считается доказательством.
