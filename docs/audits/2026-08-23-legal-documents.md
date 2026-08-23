# Актуализация legal documents для issue #2

## Scope и режим проверки

- Этап: implementation, без push, production-доступа и публикации.
- Revision: task-scoped diff к текущему `dev`; exact SHA фиксируется локальным
  commit после прохождения gate.
- Touched surfaces: privacy/legal copy, версии registration acceptance,
  account-deletion copy и release-time legal template.
- Security review mode: `semantic`. Runtime entry points, permissions,
  persistence, recovery и provider behavior не менялись; изменены только тексты,
  версия принимаемых документов и обязательная release-time дата вступления в
  силу. Actor, concurrency и STRIDE matrices для этого режима не создаются.
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
| Account Email / recovery | `default_email` Яндекс ID либо введённый адрес, canonical key/state, даты, HMAC одноразовых кодов/ссылок/Recovery Code, attempts и message IDs | auth в PostgreSQL; Яндекс ID — источник `default_email`; support/operator не имеют factor-bypass | адрес до замены/удаления аккаунта; factor TTL 15 минут; Recovery Code derivatives до consume/reissue/reset/delete; expired technical rows могут оставаться до следующей операции или удаления аккаунта |
| Transactional mail | recipient, recipient domain, template kind и token-free payload, state/attempt/outcome/failure code | worker и SMTP REG.RU; operator видит только bounded delivery aggregates | recipient/payload до terminal state, затем немедленная redaction; terminal metadata 30 дней плюс ближайшая daily cleanup; `queued`/`leased` age cleanup не удаляет |
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

## OWNER/LEGAL gates до публикации

1. **OWNER:** заполнить подтверждённые operator values и дату вступления в силу;
   доказать владение `support@`/`no-reply@`, inbound/outbound delivery,
   privacy-request и incident ownership. Значения не помещать в Git или issue.
2. **OWNER/LEGAL:** принять или изменить mapping оснований из privacy sections
   4.6–4.10, отдельно зафиксировав balance test для несвязанного
   `landing_view`, и решить, нужно ли повторное принятие Terms/consent
   существующими аккаунтами. Текущий код требует `1.1` только для новой
   регистрации.
3. **OWNER/LEGAL:** сверить финальный data map, REG.RU/Yandex agreements,
   российское размещение и released retention с уведомлением Роскомнадзору.
   Отдельно решить, допустимы ли expired recovery rows до следующей операции и
   неограниченное по возрасту состояние `queued`/`leased`; иначе сначала нужен
   bounded cleanup/recovery change с PostgreSQL tests.

## Semantic security review

- Подтверждённых security findings в изменённой copy/template boundary нет.
- Отвергнута гипотеза, что Account Email назван identity: документы прямо
  запрещают account merge и сохраняют `providerSubject` владельцем identity.
- Отвергнута гипотеза, что Feedback Report автоматически публикуется или
  использует Account Email: copy соответствует product-owned queue и manual
  sanitized transfer.
- Отвергнута гипотеза, что аналитика объявлена действующей: документы применяют
  условное описание, а runtime/build flags остаются отдельным production gate.
- Residual risks: три OWNER/LEGAL gate выше, production publication/date,
  provider delivery, RKN notification, existing-user re-acceptance и bounded
  deletion expired recovery/outbox data.
- Active DAST: `NOT RUN`; semantic copy/template change не оправдывает активную
  атаку, production не является разрешённой целью.

## Validation

- Primary signal: `PASS` — rendered legal source/data map, contract versions and
  deletion copy agree with implemented fields and current disabled/enabled
  boundaries.
- `PASS` — contracts: 47 tests; webapp: 172 tests; website: 5 tests; backend
  unit: 232 tests.
- `PASS` — monorepo typecheck, frontend lint и architecture check (380 source
  files).
- `PASS` — release build без `VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE`
  отклонён именно этим gate; сборка с тестовыми public operator values и датой
  завершилась успешно, а template tests исключают неизвестные или оставшиеся
  после рендера placeholders во всех трёх документах.
- `PASS` — относительные Markdown targets существуют; публичные `/privacy`,
  `/terms` и `/personal-data-consent` ответили HTTP 200; нормативные,
  provider-requisite и structural-example links открыты 23 августа 2026 года.
- Versioned pre-commit gate должен повторить обязательный task-level набор;
  broader scanners нужны только если final diff выйдет за semantic mode.
- Production checks: `BLOCKED` until the three OWNER/LEGAL gates are resolved;
  no push, deploy, mailbox mutation, RKN submission or analytics activation is
  part of this task.
