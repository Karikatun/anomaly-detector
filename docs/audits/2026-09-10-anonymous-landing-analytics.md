# Анонимные счётчики рекламного лендинга — подготовка релиза

Дата: 10 сентября 2026 года. Репозиторий `Karikatun/anomaly-detector`, ветка
`dev` (уже была выбрана до задачи), исходный HEAD `17c26043`. Ветка не переключалась.
Проверяется локальный diff этой задачи.
Production не изменялся. Конфигурация и шесть рекламных ссылок:
[ANALYTICS.md](../ANALYTICS.md).

Пользователь подтвердил выпуск всей текущей `dev` через PR в `master`, ожидание
обязательных проверок, merge и деплой только из `master`. До этого diff новые
изменения относительно production — `ae15c238` (лёгкие боты не берут Контракты),
`2a1cf71e` и `17c26043` (экран итогов и аудит раундов). История `master..dev`
показывает 22 коммита из-за разных SHA уже перенесённых изменений: tree
`master` на `b28852cc` совпадает с tree предка `dev` на `866f6163`.
Общий regression gate включает эти три коммита. Производственная ветка — `master`.

## Объём и основной сигнал

Профили: cross-layer/product contract, security/privacy (full), persistence/
concurrency, UI/UX и подготовка release. Поверхности: website → analytics API →
PostgreSQL → operator API → adminapp; общие контракты, cleanup, release guards,
privacy copy и существующая зависимость сборщика.

Primary signal status: **PASS локально**. В HTTPS split-domain E2E загрузка
лендинга с `ad_03` и реальное нажатие CTA увеличивают два соответствующих
агрегата в PostgreSQL; запись клика проверяется после ухода на домен приложения.
Панель и аналитические cookies отсутствуют, `credentials: omit`, journey/raw
event таблицы пусты, `yclid` не входит в тело. Блокировка сборщика сохраняет
переход к регистрации. Это не доказательство production-сбора.

Первый тест ожидал browser response после unload и завершился timeout.
Ожидание заменено проверкой сохранённого счётчика: keepalive продолжает запрос
после ухода, а страница уже не обязана наблюдать его ответ. Повторный standalone
target и полный split-domain preflight прошли; timeout не посчитан успешным тестом.

## Security review

Границы: недоверенный браузер → Origin/schema/budget → транзакция → агрегаты;
аутентифицированный оператор → UUID allowlist → bounded projection; worker →
дневная очистка. Запросы не создают связь между счётчиком и посетителем.

| Актор / ресурс | Проверка и результат |
| --- | --- |
| Посетитель и обычный игрок | Могут только увеличить разрешённый публичный счётчик; одинаковый контракт без account/visitor ID |
| Внешний browser origin, отсутствующий или `null` Origin | 403 до store и бюджетного обращения; route tests |
| Анонимный или авторизованный посторонний в operator API | Одинаковый 404; admin PostgreSQL integration |
| Оператор из UUID allowlist | Читает только проекцию по 7/30/90 дням и разрешённым меткам; ответ без visitor drilldown |
| Владелец комнаты / участник другого Tender | Аналитика не принимает ID игровых объектов; существующие игровые проверки остаются в общем E2E |
| Worker | Удаляет обе таблицы агрегатов по одному cutoff; повторная очистка безопасна |
| Рекламный провайдер | Не получает события от продукта; неизвестные метки не сохраняются, внешней отправки конверсий нет |

| Мутация / повтор | Проверка и результат |
| --- | --- |
| Дубликат или неоднозначный ответ | Считается отдельным действием; server dedup намеренно отсутствует без идентификаторов, клиент не делает retries |
| Несколько CTA в одной загрузке | Локальный boolean разрешает только первое нажатие; новая загрузка считается заново |
| Конкурентные записи | Восемь параллельных запросов store через реальный PostgreSQL дают восемь записанных действий без потерь |
| Частичный сбой записи двух агрегатов | Оба upsert находятся в одной транзакции; второй сбой откатывает первый |
| Logout, expiry, consent revoke | Анонимная операция не имеет сессии или аналитического пути; старый cookie игнорируется; связанные маршруты в aggregate не смонтированы |
| Deadline / закрытие вкладки | Keepalive не блокирует навигацию; событие может потеряться, отчёт не обещает точности рекламного биллинга |
| Cleanup и повтор запуска | Проверены cutoff 13 месяцев и идемпотентность; новые строки сохраняются |
| Откат | Миграция только CREATE TABLE; существующие таблицы не меняет. Старому worker неизвестна новая таблица — cleanup надо сохранить или восстановить до срока удаления |

| Ввод / вывод | Проверка и результат |
| --- | --- |
| event, campaign, referrerDomain | Строгий общий контракт, только два вида события; ограниченные строки и safe-slug allowlist; неизвестные поля отклоняются |
| accountId, journeyId, advertising ID, связанные события | Отрицательные contract/route tests; записи этих данных в новом режиме нет |
| Origin и cookies | Точный server allowlist; request body и cookies не считаются авторизацией; публичный root не получает auth/operator CORS |
| Ресурсный лимит | Существующий атомарный RequestBudget, отдельные HMAC scope; 120/min для ingest; 429 и Retry-After до записи. Эти scope исключены из операторской anti-abuse агрегации |
| Кардинальность | До 100 разрешённых campaign keys, два вида анонимного события, два класса трафика, UTC-дни и 13 месяцев хранения |
| Projection / logging | Только категории, метки и количества; error/security logging не получает body или cookie; SQL raw-event insert в aggregate отсутствует |
| Исторические данные | Префикс `aggregate:` отделяет старую согласованную воронку; неизвестные и выключенные ключи не становятся строками отчёта |

Дифференциальная проверка выполнена: история `dd101509` (analytics) и `f3ce4d8d`
(distributed budgets), затронутые producers/consumers/worker, соседние consent,
auth/CORS и operator routes, независимая попытка опровергнуть кандидаты.
Проверка Origin и отдельный ingest budget добавлены в owning route/module,
поскольку прежний выключенный сборщик не обеспечивал эти границы. Гипотеза
связи anonymous clicks через старый cookie опровергнута early return режима,
route test и реальными пустыми journey/event таблицами. Гипотеза разглашения
через operator API опровергнута существующим UUID allowlist и integration test.
Подтверждённых неисправленных находок в изменённой границе не осталось.

Остаточный риск: внешний клиент может подделать Origin/User-Agent и увеличивать
публичный счётчик в пределах бюджетов, распределённые источники обходят лимит
одного адреса. Это приблизительная продуктовая статистика; она не используется
для оплаты, рейтинга, персональных решений или проверки рекламного провайдера.
Общий NAT может недосчитать настоящие действия. ZAP/нагрузочные атаки не запускались;
новую JSON-границу проверяли контрактами, routes и PostgreSQL, production не атаковали.

## UX и совместимость

Сравнены реальные render до/после на 1440×900 и 390×844; финальный отчёт проверен
также на 1024×768. Для каждого размера проверены данные, нули, обновление,
ошибка, доступный keyboard focus и отсутствие горизонтального overflow страницы.
200% desktop reflow (720×450), узкий экран 320×700 и reduced motion проверены
отдельно. Широкая дневная таблица прокручивается в именованном focusable регионе.

Отдельная browser-проверка настоящего `App` с синтетическим API воспроизвела
ошибку при смене периода: старые данные и период сохранились, кнопки на время
запроса блокировались, повторная попытка обновила данные и убрала alert;
необработанных browser errors нет. Приватных production-данных в снимках нет.

Новый admin-контракт читает старые ответы через defaults; старый строгий parser
не принимает новый ответ. Поэтому выпуск и откат admin/API согласованы.
Режим consented сохраняется для совместимости и существующих тестов, но
release-профиль нового лендинга разрешает только aggregate. Webapp release
по-прежнему запрещает `VITE_ANALYTICS_ENABLED`.

## Проверки и граница выпуска

Secondary signal status:

- PASS — contract и route tests; реальные analytics/admin integration; Origin,
  quota, unknown fields, privacy, concurrency, bot exclusion, cleanup.
- PASS — `bun run preflight:split-domain`: 5 target + 2 rollback HTTPS E2E,
  production-domain build guards и изолированные release artifacts.
- PASS — `bun run drill:postgres:backup-restore`: 38 migrations, synthetic
  recovery point восстановлен; cleanup изолированных ресурсов подтверждён.
- PASS — Gitleaks (492 commits), Semgrep (5 rules, 449 files, 0 findings),
  Trivy config (0 HIGH/CRITICAL), rendered review и App recovery probe.
- PASS — `bun install --frozen-lockfile` и `bun audit --audit-level=low` после
  исправления существующей транзитивной зависимости `smol-toml` 1.7.0 → 1.7.1.
  [Advisory](https://github.com/advisories/GHSA-7w5x-hrqm-74c2), проверено
  10 сентября 2026: malformed TOML мог зациклить parser. Новая прямая зависимость
  не добавлялась. Bun также перераспределил уже присутствующие версии Zod
  4.4.3/4.5.4 между корневым и вложенными узлами; финальные gates проверяют этот lockfile.
- PASS — Trivy HIGH/CRITICAL для локального backend-кандидата
  `sha256:a5875d48f5a8a7070b5e87e81daa9ece445e05a160d9d9d7ac827498e8d89de9`.
  Production image собирается и проверяется отдельно из итогового `master` SHA.
- PASS — окончательный `bun run check` с финальным lockfile: lint, Prisma,
  typecheck, architecture, unit/integration, build, Docker smoke и 114 E2E
  в Chromium/Firefox. Повторный split-domain preflight также прошёл на этом lockfile.

До production остаются **NOT RUN**: push и exact-SHA CI; live migration/backup
identifier; owner static artifacts с утверждёнными legal values; deployment;
runtime image equality; публичные counters/admin/health, действующий cleanup
и мониторинг. Это оставшиеся шаги разрешённого пользователем PR → CI → merge →
master deploy; локальное evidence не заменяет их.
Техническая сверка privacy copy не является юридическим заключением и не
закрывает общие задачи #2/#31. В локальных тестах ссылки и данные синтетические.
