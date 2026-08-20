# Аудит пересмотра Public MVP Journey

## Scope

- Этап: design.
- Основной сигнал: продуктовые, security, privacy, UX, архитектурные и
  операционные документы описывают один согласованный MVP без выдачи будущей
  реализации за текущую.
- Поверхности: website, webapp, adminapp, backend/auth, PostgreSQL, OAuth,
  transactional mail, analytics, feedback, production domains и legal copy.
- Реализация, миграции, внешние публикации, DNS/cloud и production не менялись.

## Выбор проверок

| Триггер | Статус | Доказательство или остаточный риск |
| --- | --- | --- |
| Shared contract/API shape | BLOCKED | Контракты ещё не реализуются; MVP-план требует producer/consumer и error-path tests для каждого среза. |
| Auth/permissions/privacy/object ID | REQUIRED, design PASS | ADR 0005–0009 и 0015 исключают email merge и operator takeover, задают факторы, generic reset, atomic consume и session revocation. Runtime matrix остаётся обязательной при реализации. |
| State change/async/realtime | REQUIRED, design PASS | ADR 0011–0013 задают idempotency, version precondition, outbox retry, circuit breaker и audit. Race/replay tests ещё не существуют. |
| Prisma/persistence | BLOCKED | Schema/migrations не входят в design-задачу; real PostgreSQL integration и rollback обязательны в implementation slices. |
| Module/platform dependency | REQUIRED, docs PASS | `ARCHITECTURE.md` назначает владельцев auth, mail, analytics, feedback и admin projection без создания пустых модулей. Runtime architecture check запускается перед commit. |
| UI behavior/forms | BLOCKED | State matrices зафиксированы, production UI и approved responsive prototype ещё не созданы. Требуются TDD и rendered review при реализации. |
| Public website | BLOCKED | SEO/AI contract и viewports определены, но current landing не реализует их. Production build/render/indexing checks входят в gate первого и шестого срезов. |
| Secrets/dependencies/source | REQUIRED | Зависимости не добавлялись; tracked secret scan и commit gate выполняются перед commit. |
| Docker/IaC/image | N/A | Runtime/IaC не изменялись. |
| Release/production/network | N/A | Выпуска, DNS и production-мутаций нет; ADR 0014 и Yandex runbook определяют будущий coordinated cutover. |
| Backup/storage/cleanup | BLOCKED | Новые данные ещё не существуют; retention и обязательный cleanup перечислены в плане, restore/rollback проверяются с миграциями. |
| Active DAST | NOT RUN | Design-only документация; активная цель отсутствует. |

## Threat review

1. Защищаются identity links, Account Email, recovery credentials, sessions,
   Feedback Report, analytics consent, private Tender data и operator policy.
2. Акторы разделены на anonymous visitor, password owner, Yandex ID owner,
   authenticated outsider и allowlisted operator. Все эффекты принадлежат
   backend; UI и совпадение email не являются полномочием.
3. Anonymous видит только публичный landing и generic reset result; игрок —
   только собственное recovery/feedback состояние; operator — агрегаты и
   минимальную очередь, но не recovery secrets или произвольный account CRUD.
4. Replay/race закрываются hashed one-time credentials, atomic consume,
   version precondition, `commandId`, distributed budgets и session revocation.
   Их фактическое доказательство отложено до integration tests.
5. Логи и admin projections не содержат адресов, reset URL, кодов, raw feedback
   context или journey identity. Security telemetry не становится analytics.
6. Last-known-good mail policy, outbox terminal state, cooling-off cancellation,
   Recovery Code, scheduled deletion and coordinated domain rollback задают
   denial/recovery paths. SMTP acceptance не называется конечной доставкой.
7. План требует contract/backend integration для matrices и concurrency,
   representative E2E для полного пути, rendered website/profile/feedback review
   и production mail/domain acceptance.

## Находки и решения

- HIGH, account takeover: login+password могли позволить сменить recovery
  channel. Закрыто old+new factors, trusted-old-session cancellation,
  cooling-off и user-held Recovery Code; ручной support override запрещён.
- HIGH, privacy/retention: Яндекс Формы не позволяют удалить отдельный ответ,
  поэтому основной feedback intake перенесён в product-owned PostgreSQL contour
  с retention и без вложений.
- MEDIUM, identity collision: Yandex `default_email` не используется для merge;
  `providerSubject` остаётся identity, конфликт не блокирует существующий вход.
- MEDIUM, operational ambiguity: SMTP acceptance отделён от конечной доставки,
  adminapp получает только безопасные агрегаты.
- MEDIUM, indexing boundary: root website и player app разделены; private routes
  не входят в sitemap и не используют публичный AI-crawler permission.

## Остаточный риск

- Профильный legal review, заполнение operator placeholders и актуализация
  privacy/consent/terms обязательны одновременно с фактической реализацией.
- Реестр ОРИ поставляет только кандидатов; каждый email domain требует ручного
  доказательства и решения оператора.
- REG.RU delivery, лимиты, SPF/DKIM/DMARC и provider outage не доказаны до
  production-like испытаний.
- Схема, API, UI, migrations, cleanup, tests, DNS redirect и monitoring ещё не
  реализованы; принятые ADR не являются runtime evidence.
