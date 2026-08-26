# Актуализация legal documents для issue #2

## Scope и режим проверки

- Этап: implementation, без push, production-доступа и публикации.
- Revision: task-scoped diff к текущему `dev`; exact SHA фиксируется локальным
  commit после прохождения gate.
- Touched surfaces: privacy/legal copy, версии registration acceptance,
  account-deletion copy, release-time legal template, recovery persistence,
  transactional-mail worker/outbox и daily maintenance cleanup.
- Security review mode: `full`. В согласованный retention slice вошли
  персональные данные, recovery credentials, PostgreSQL-транзакция и гонка
  cleanup с SMTP worker; actor, identifier, STRIDE и concurrency matrices
  приведены ниже.
- Защищаемый инвариант: опубликованные документы не должны скрывать фактически
  реализованные поля, получателей, сроки, отзыв и последствия удаления аккаунта
  либо объявлять ещё не включённую аналитику работающей в production.

## Источники и граница юридических выводов

Сверка выполнена 23 августа 2026 года. Нормативной основой для структуры и
оснований служил актуальный текст Федерального закона № 152-ФЗ:

- [статья 5](https://www.consultant.ru/document/cons_doc_LAW_61801/96fbc469f91f57235cc842a85e0516a99f23dc85/) — целевое ограничение, минимизация и хранение не дольше цели;
- [статья 6](https://www.consultant.ru/document/cons_doc_LAW_61801/315f051396c88f1e4f827ba3f2ae313d999a1873/) — согласие, исполнение договора и законный интерес как самостоятельные условия обработки;
- [статья 9](https://www.consultant.ru/document/cons_doc_LAW_61801/6c94959bc017ac80140621762d2ac59f6006b08c/) — конкретное, предметное, информированное, однозначное и отдельное согласие;
- [статья 18.1](https://www.consultant.ru/document/cons_doc_LAW_61801/eeeebe22bf738fd65bb66b95cc278911ae2525ee/) — категории, цели, способы, сроки и порядок уничтожения в документах Оператора;
- [статья 21](https://www.consultant.ru/document/cons_doc_LAW_61801/d3fe43a7c415353b17faab255bc0de92bea127da/) — прекращение обработки и уничтожение при достижении цели или отзыве.

Как образцы полноты, но не как источники права, использованы действующие
[политика Яндекса](https://yandex.ru/legal/confidential/ru/) и
[политика сервисов Mail ООО «ВК»](https://help.mail.ru/legal/terms/common/privacy/).
Из них применён только общий принцип: сервис-специфично разделять категории,
цели/основания, получателей, retention, cookies и права. Чужие реквизиты,
основания и формулировки не переносились.

Фактические наименования и адреса привлечённых лиц сверены отдельно по
[корпоративной информации Yandex Cloud](https://yandex.cloud/ru/about),
[условиям API Яндекс ID](https://yandex.ru/legal/authid_api/ru/) и
[официальным реквизитам REG.RU](https://www.reg.ru/company/requisites_and_docs).
API Яндекс ID сейчас предоставляет ООО «Айди Тех»; оно раскрыто как
самостоятельный поставщик сервиса, а не как лицо, действующее по поручению
Оператора внутри Яндекс ID.

Это evidence-backed best-effort анализ, а не заключение привлечённого юриста.
Неизвестные operator facts и решения ниже оставлены явными gates.

## Сверенный data map

| Поток | Фактически обрабатываемые данные | Получатель или доступ | Фактический retention |
| --- | --- | --- | --- |
| Account Email / recovery | `default_email` Яндекс ID либо введённый адрес, canonical key/state, даты, HMAC одноразовых кодов/ссылок/Recovery Code, attempts и message IDs | auth в PostgreSQL; Яндекс ID — источник `default_email`; support/operator не имеют factor-bypass | адрес до замены/удаления аккаунта; factor TTL 15 минут плюс ближайшая daily cleanup; у двухсторонней замены истёкшая производная очищается отдельно, строка удаляется после истечения обеих сторон; Recovery Code derivatives — до consume/reissue/reset/delete |
| Transactional mail | recipient, recipient domain, template kind и token-free payload, state/attempt/outcome/failure code | worker и SMTP REG.RU; operator видит только bounded delivery aggregates | credential recipient/payload — до собственного `expiresAt`, security notification — до 7 дней, затем redaction ближайшей daily cleanup; terminal metadata eligible for deletion через 30 дней и удаляется ближайшей daily cleanup (при штатной работе дополнительное окно ≤24 часов) |
| Feedback Report | категория/содержание, public number/status, safe route/build/device/browser/error context, отдельно reply email и account link, HMAC account/IP budgets | product-owned operator queue; GitHub transfer только вручную после очистки | `new`/`in_review` 180 дней, terminal/transferred content/contact/link 30 дней, затем ближайшая daily cleanup; counters действуют до 24 часов; derived aggregate сейчас не создаётся |
| Consent analytics | до выбора — только дневной count по source/traffic category; после allow — HMAC journey key, consent time/expiry и bounded funnel events | собственная PostgreSQL база и aggregate-only operator projection; сторонних analytics providers нет | journey/raw events 30 дней или revoke; aggregate counts 13 месяцев; затем ближайшая daily cleanup; production flags остаются выключены до gates #2/#31 |

Основные code owners: `backend/prisma/schema.prisma`,
`backend/src/modules/auth/infrastructure/auth-repository.ts`,
`backend/src/modules/mail/infrastructure/prisma-transactional-mail-outbox.ts`,
`backend/src/modules/feedback/infrastructure/prisma-feedback-cleanup.ts`,
`backend/src/modules/analytics/infrastructure/prisma-analytics.ts` и
`backend/src/modules/analytics/infrastructure/prisma-analytics-cleanup.ts`.
Shared contracts: `packages/contracts/src/auth.ts`,
`packages/contracts/src/feedback.ts` и `packages/contracts/src/analytics.ts`.

## Внесённая синхронизация

- Privacy revision `1.2` теперь описывает Account Email/recovery,
  transactional mail, REG.RU, Feedback Report, оба режима consent analytics,
  cookies, сроки и account deletion.
- Personal-data consent `1.1` остаётся отдельным от Terms, включает
  request-driven recovery/mail/feedback и прямо не подменяет отдельный analytics
  choice.
- Terms `1.1` фиксирует отделение email от identity, self-service recovery без
  support/admin bypass, назначение транзакционных писем и добровольный Feedback
  Report.
- Registration contracts принимают только версии consent/Terms `1.1`; старые
  сохранённые acceptance records не переписываются.
- Дата вступления в силу не угадывается: release build требует
  `VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE` вместе с существующими operator
  values.
- Account-deletion dialog называет удаление Account Email/recovery credentials,
  снятие Feedback link и отдельный retention содержания/контакта.
- Daily cleanup теперь атомарно удаляет просроченные однофакторные recovery
  credentials, очищает истёкшую сторону двухфакторной замены, завершает и
  редактирует просроченную pending mail; worker независимо от cron не начинает
  отправку после того же deadline.
- `MAIL_OUTBOX_RETENTION_DAYS` ограничен схемой env максимумом 30, поэтому
  production-конфигурация не может молча продлить опубликованный срок до
  eligibility удаления terminal metadata; физическое удаление выполняет
  ближайший daily cleanup.

## Принятое OWNER-решение по правовым основаниям

OWNER decision: `ACCEPTED` 23 августа 2026 года; внешнее юридическое заключение:
`NOT RUN`.

- Account Email, Recovery Email и запрошенная транзакционная отправка опираются
  на исполнение Пользовательского соглашения и действия по инициативе
  пользователя.
- Anti-abuse, security notifications и предотвращение неправомерного доступа
  опираются на законный интерес в защите пользователя и Сервиса при условии,
  что права пользователя не нарушаются.
- Feedback Report обрабатывается для выполнения добровольного запроса
  пользователя; улучшение и защита Сервиса дополнительно относятся к законному
  интересу при тех же ограничениях прав пользователя.
- 30-дневный аналитический путь и связанные события создаются только после
  отдельного однозначного разрешения; отказ и отзыв не ограничивают Сервис.
- Несвязанный дневной `landing_view` до выбора допускается на основании
  законного интереса только в пределах balance test ниже.

### Balance test для `landing_view` до выбора

- **Интерес:** понимать доступность и фактическое использование публичной
  страницы, чтобы оценивать путь к регистрации и обучению без сторонних
  трекеров.
- **Необходимость:** хранится только дневной count по укрупнённым
  `sourceCategory` и `trafficClass`; постоянный идентификатор, сырой IP-адрес,
  полный URL, fingerprint и последовательность действий не создаются.
- **Влияние на пользователя:** данные не позволяют выделить путь отдельного
  посетителя, не используются для рекламы, профилирования, принятия решений или
  ограничения функций.
- **Меры:** backend-маршруты отсутствуют при `ANALYTICS_ENABLED=false`;
  first-party клиенты включаются отдельно; агрегаты хранятся 13 месяцев плюс
  ближайшее ежедневное окно удаления; добавление идентификатора, новых
  измерений или сырого retention повторно открывает OWNER/LEGAL gate.
- **Решение:** законный интерес принят только для текущего aggregate-only
  `landing_view`. Это решение не активирует аналитику и не заменяет production
  verification из issue #31.

## Принятое OWNER-решение по retention

OWNER decision: `ACCEPTED` 23 августа 2026 года; внешнее юридическое заключение:
`NOT RUN`.

- Одноразовый recovery challenge или reset credential удаляется ближайшей
  ежедневной очисткой после собственного `expiresAt`; истёкший код или ссылка
  не могут быть отправлены worker и не могут изменить состояние аккаунта.
- В двухсторонней замене Recovery Email старая и новая стороны независимы:
  производная истёкшего кода очищается отдельно, действующая сторона и право на
  resend сохраняются, а вся запись удаляется после истечения обеих сторон.
- Pending security notification перестаёт быть пригодным для новой отправки
  через 7 дней; recipient/template редактируются worker либо ближайшей daily
  cleanup с техническим окном не более 24 часов. Terminal metadata становится
  подлежащим удалению через 30 дней и удаляется ближайшим daily cleanup, при
  штатной работе — в пределах следующего 24-часового окна.
- Это осознанная продуктовая граница минимизации данных, а не утверждение о
  прямо установленном законом числе дней.

## OWNER/LEGAL gates до публикации

1. **OWNER:** заполнить подтверждённые operator values и дату вступления в силу;
   доказать владение `support@`/`no-reply@`, inbound/outbound delivery,
   privacy-request и incident ownership. Значения не помещать в Git или issue.
2. **OWNER/LEGAL:** решить, нужно ли повторное принятие Terms/consent
   существующими аккаунтами. Принятое выше сопоставление оснований само по себе
   этого решения не заменяет; текущий код требует `1.1` только для новой
   регистрации.
3. **OWNER/LEGAL:** сверить финальный data map, REG.RU/Yandex agreements,
   российское размещение и реализованные сроки retention с уведомлением
   Роскомнадзору.

## Full security review retention slice

Защищаемые активы: адреса Account/Recovery Email, HMAC-производные кодов и
ссылок, token-free mail payload, целостность recovery state и доступность
security notifications. Нового публичного маршрута нет: доверенная граница
проходит между private cron task, PostgreSQL, mail worker и SMTP REG.RU.

### Actor и identifier matrix

| Actor / граница | Вход и идентификатор | Разрешённое действие | Результат |
| --- | --- | --- | --- |
| anonymous / authenticated user | публичные auth routes, но не cron | только существующие start/resend/confirm/cancel | cleanup не добавляет полномочий или object lookup |
| operator UI | aggregate mail projection | читать только bounded aggregates | recipient, payload и recovery rows недоступны |
| private cleanup runtime | server-selected rows по deadline/state | redact terminal mail и удалить/очистить expired recovery data | `ALLOW`, только через именованный task и DB credential |
| mail worker | внутренний outbox id и lease owner | отправить только ещё действующее письмо | после deadline — terminal `retention_expired`; stale lease не переписывает cleanup |
| SMTP provider | уже переданные recipient/content | завершить начатую SMTP-попытку | внешняя передача до deadline необратима; credential после expiry недействителен |

Пользовательский `id` в новом entry point отсутствует; выбор строк полностью
server-side. Межтенантного read/write пути, IDOR и oracle существования аккаунта
slice не создаёт.

### STRIDE и concurrency matrix

| Риск / гонка | Контроль и evidence | Вывод |
| --- | --- | --- |
| spoofing / elevation | cron не экспортирован как HTTP route; существующие auth permissions не менялись | нового privilege path нет |
| tampering / replay просроченного credential | worker валидирует typed template и deadline до SMTP; auth уже проверяет expiry при confirm/reset | fail closed, код/ссылка не оживает после cleanup или retry |
| information disclosure | overdue queued/leased row получает `[redacted]` и `{}`; лог содержит только counts; code derivative истёкшей replacement-side заменяется необратимым tombstone | raw recipient/payload не остаются в recovery log/attempt metadata |
| два cron одновременно | conditional `updateManyAndReturn` по `queued/leased`, terminal transition и одна attempt row в PostgreSQL transaction | один winner; повтор идемпотентен |
| cleanup против resend/confirm/delete | cleanup блокирует mail перед recovery; одно- и многострочные direct auth paths приведены к тому же bounded transaction runner, а recovery-first paths повторяются максимум три раза через общий classifier `P2034`, driver conflict, PostgreSQL `40P01`/`40001` и stale `P2025`; inverse-order PostgreSQL test принудительно создаёт deadlock | после одного winner допустимы только удаление процесса либо valid resent-side + tombstone expired-side; частичный commit исключён, transient conflict повторяется ограниченно и остаётся видимой ошибкой после трёх неудачных попыток |
| cleanup против leased worker до SMTP | worker сам отклоняет письмо на deadline | provider call отсутствует |
| cleanup против уже начатого SMTP | cleanup остаётся terminal owner; поздний `recordAccepted` получает stale claim | один уже начатый provider call возможен, DB и credential state не откатываются |
| отмена против уже leased письма | queued запись отменяется и редактируется сразу; существующий контракт не отзывает lease | leased attempt может продолжаться до исходного deadline, но удалённый auth factor уже непригоден; copy раскрывает этот residual risk |
| failure между mail redaction и recovery delete | обе операции находятся в одной transaction | полный rollback, без полусостояния |
| двухсторонняя замена | expired side redacted независимо; valid side сохраняется; whole row удаляется только при expiry обеих | resend semantics не ломаются |

### External input и stored-payload matrix

| Поверхность | Контроль | Результат |
| --- | --- | --- |
| новый cleanup entry point | пользовательского body/path/token нет; predicates и template kinds заданы кодом | malformed ID, unknown field, Unicode и body-size cases неприменимы |
| создание mail payload | strict discriminated Zod schema, bounded recipient/URL, нормализация домена, UUID message id | неизвестные поля и невалидный envelope не попадают в outbox |
| чтение stored template | повторная strict schema validation перед render; safe recovery URL; unknown payload terminally redacted как `stored_message_invalid` | повреждённая запись не отправляется провайдеру |
| deadline query | только application-written ISO `expiresAt`, фиксированные credential kinds и `queued/leased` states | чужой template kind или terminal row не затрагивается |
| provider result и logs | failure code ограничен safe alphabet/length; recipient/template редактируются; cron логирует counts | email, code, token и payload не появляются в новом operational output |

### History, blast radius и independent refutation

- История `bd2db64`, `ec8d3a9`, `cb38e97`, `e0372c6`, `8c5d794` проверена
  по mail/recovery ownership: outbox остаётся mail-owned, auth state —
  auth-owned, cron только компонует одну транзакцию.
- Blast radius: five expiring recovery models, three transactional templates,
  worker claim/record protocol, maintenance logs/runbook и privacy retention.
  `RecoveryCodeSet/RecoveryCode` не имеют expiry и намеренно не затронуты.
- Опровергнут первый вариант удаления `RecoveryEmailReplacement` при истечении
  любой стороны: он ломал независимый resend. Реализация изменена на per-side
  tombstone и удаление только после истечения обеих сторон; PostgreSQL test
  сохраняет valid side.
- Опровергнуто предположение, что terminalizing leased row гарантирует отмену
  уже переданного SMTP DATA: race test фиксирует допустимый один in-flight call,
  stale claim и неизменный terminal state.
- Последовательные independent reviews нашли и опровергли условия per-side
  tombstone, AB/BA order, отсутствие retry в multi-mail auth paths, stale-row
  `P2025`, точный terminal-time overclaim и overclaim отмены уже leased письма.
  Cleanup использует mail→recovery order; затронутые auth paths выполняют
  bounded retry через общий classifier. Реальный inverse-order PostgreSQL test
  воспроизвёл `DriverAdapterError`/`40P01`, а runbook/copy описывают eligibility
  + daily cleanup window и существующий leased-cancellation contract.

Открытых подтверждённых security findings после исправления P2 нет.
Residual risks: три OWNER/LEGAL gate выше, production publication/date,
mailbox/provider evidence, RKN notification, existing-user re-acceptance и
короткое внешнее окно уже начатой SMTP-попытки, а также возможность завершения
ранее leased попытки после отмены до исходного deadline. Код или ссылка после
отмены уже непригодны. Mapping оснований, balance test и retention policy
приняты OWNER, но внешнее юридическое заключение не выполнялось. Active DAST:
`NOT RUN`; нового сетевого entry point нет, а production не является
разрешённой целью.

## Validation

- Primary signal: `PASS` — PostgreSQL integration (137 tests) доказывает
  deadline, atomic rollback, concurrent idempotence, two-sided preservation,
  реальный inverse-order deadlock + bounded retry и in-flight SMTP stale-claim
  behavior; legal source/data map согласован с реализованным retention.
- `PASS` — contracts: 47 tests; webapp: 172 tests; website: 5 tests; backend
  unit: 235 tests.
- `PASS` — legal source test фиксирует принятое разделение contract/request,
  security legitimate interest и отдельного analytics consent, а также наличие
  OWNER decision и balance test.
- `PASS` — monorepo typecheck, frontend lint и architecture check (383 source
  files).
- `PASS` — release build без `VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE`
  отклонён именно этим gate; сборка с тестовыми public operator values и датой
  завершилась успешно, а template tests исключают неизвестные или оставшиеся
  после рендера placeholders во всех трёх документах.
- `PASS` — относительные Markdown targets существуют; публичные `/privacy`,
  `/terms` и `/personal-data-consent` ответили HTTP 200; нормативные,
  provider-requisite и structural-example links открыты 23 августа 2026 года.
- `PASS` — `check:commit`: secret hygiene, lint, Prisma validation, monorepo
  typecheck, architecture, deploy/tooling/contracts/admin/backend/webapp/website
  suites; contracts 47, adminapp 14, backend unit 235, webapp 172, website 5.
- `PASS` — full security static profile: Gitleaks (425 commits, no leaks),
  Semgrep (5 versioned rules, 0 findings) и Trivy config (0
  misconfigurations). Exact-image scan: `NOT RUN`, exact release image в scope
  не создавался. Active DAST: `NOT RUN`, нового сетевого entry point нет.
- Production checks: `BLOCKED` until the three OWNER/LEGAL gates are resolved;
  no push, deploy, mailbox mutation, RKN submission or analytics activation is
  part of this task.
