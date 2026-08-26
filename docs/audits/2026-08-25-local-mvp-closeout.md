# Локальное закрытие Production MVP — 2026-08-25

## Граница проверки

Этот отчёт фиксирует только то, что можно безопасно реализовать и доказать в
репозитории и изолированном локальном окружении. Работа начата от локального
`dev` на `9256c62`; ветка уже содержала три не опубликованных в `origin/dev`
Tender/security commit. В ходе проверки не выполнялись push, deploy, DNS/TLS,
Yandex Cloud, REG.RU, live SMTP, GitHub Issue/PR или иные внешние изменения.

Локальный PASS не является production acceptance. Точные внешние блокеры
сохранены ниже и в [Production Release Checklist](../RELEASE_CHECKLIST.md).

## Закрытые локальные разрывы

### Tender: audit, realtime и восстановление команд

- Participant-only audit восстанавливает полный ход матча и источники очков,
  включая legacy v1/v2 Thesis и неуспешные Contract Bid. Текущая коррупция
  продолжает fail loudly, а доказанно несовместимая история завершает матч без
  публикации частичного audit или нового wire-поля.
- Participant/outsider/forfeited/session-revocation границы проверены на HTTP и
  realtime. Reconnect не объявляет stale view подключённым, сохраняет backoff,
  не понижает version и не отправляет отложенный view после close/revoke.
- UI reconnect закрывает нижележащий destructive dialog, удерживает клавиатурный
  фокус, блокирует фон и возвращает фокус после восстановления. History различает
  «Продолжить» и «Открыть результаты»; завершивший матч выбывший участник может
  открыть свой audit, посторонний игрок не узнаёт о существовании Tender.
- Потерянный HTTP-ответ Tender-команды не создаёт новый пользовательский intent:
  exact envelope с тем же `commandId` сохраняется в пределах browser tab до
  квитанции, переживает refresh access token и reload, а повторы используют
  bounded backoff и `Retry-After`. Mutating controls остаются заблокированы;
  сохранённая квитанция проверяется до Tender-specific budget, и одно только
  обновление realtime не объявляет неизвестный исход решённым. Обычный
  in-flight autosave также блокирует новый intent, но не показывает ложный
  статус неизвестного исхода и не может вернуть свою квитанцию как результат
  другой команды.

### Public MVP Journey и browser matrix

- Переход с публичного CTA проходит регистрацию и продолжает `/tutorial`; secure
  refresh cookie, logout, CORS/CSP и rollback проверяются в split-domain target.
- Пустой промежуточный authenticated `<main>` устранён декларативным router
  redirect вместо post-render navigation effect.
- После успешного tutorial только `password_unprotected` получает необязательное
  предложение защитить аккаунт и предупреждение о невозможности самостоятельного
  восстановления без подтверждённой почты. CTA приводит точно к карточке защиты;
  Yandex ID, защищённые password-аккаунты и ошибка чтения состояния fail closed,
  не блокируя создание Tender, главное меню или повтор обучения.
- Основной Playwright gate теперь запускает одни и те же критические сценарии в
  Chromium и Firefox. Browser-specific различия sendBeacon, clipboard и SVG
  geometry проверяются без ослабления owning product assertions.
- В суммарной rendered-матрице Tender reconnect проверен на desktop/mobile,
  History и historical-incompatible terminal — на mobile, completed audit — на
  desktop/compact/mobile. Сохранённые локальные PNG просмотрены вручную, axe не
  обнаружил нарушений, горизонтального overflow нет.

### Локальные operations и performance

- Backup/restore drill очищает inherited Docker/Compose selectors, принимает
  только local Unix-socket context, закрепляет точный Compose project/file и
  публикует bounded JSON только после подтверждённого `down -v`. Реальный прогон
  восстановил synthetic probe `1`, подтвердил `31` migration за `4.736 s` и
  удалил временный project/volume.
- Versioned `bun run benchmark:local-abuse` защищён loopback `*_test` guard,
  fake SMTP, invocation-scoped Compose и evidence denylist. Реальный прогон
  завершил `18/18` сценариев за `6.931 s`: auth/shared NAT, generic mutation,
  Feedback, Room, Tender, mail, realtime ticket/churn/cross-instance/cap,
  Argon2id new/wrong/unknown/rehash, email reset и Recovery Code reset. JSON
  опубликован только после подтверждённой очистки.
- Private Prometheus exposition добавляет bounded API status/latency,
  auth/security, authorised realtime, Tender lifecycle/deadline, worker heartbeat
  и mail-protection signals. Public API не имеет metrics route; API collector в
  Compose публикуется только на host loopback, worker использует существующий
  private health listener. Object/player/session/request identifiers, route,
  credentials, provider payload и error text не становятся labels или values.

## Локальное evidence

- полный `bun run check:push`: dependency/secret security, lint, typecheck,
  architecture, unit/integration, release builds, backend Docker smoke и
  Playwright `106/106` в Chromium/Firefox — PASS; exact test Compose project
  после teardown пуст;
- split-domain preflight: backend/contracts `97` tests и `345` expectations,
  target `3/3`, rollback `2/2`, release builds и автоматическая очистка — PASS;
- backup/restore: probe `1`, migrations `31`, `4.736 s`, cleanup confirmed — PASS;
- abuse/performance: `18/18`, `6.931 s`, cleanup confirmed — PASS;
- operational metrics: focused unit `46/46`, PostgreSQL integration `160/160`,
  Docker smoke с public `404` и private collector series — PASS;
- Tender ambiguous response: unit и Chromium/Firefox browser regression — PASS;
- post-tutorial account protection: Chromium/Firefox positive, protected/Yandex
  negative и lookup-failure paths, desktop/compact/mobile render и axe — PASS;
- tooling contracts: `41/41`; backend/webapp typecheck и architecture — PASS;
- Gitleaks по `433` commit, Semgrep high-confidence rules и Trivy config — PASS,
  findings `0`.

## Что остаётся только внешней приёмкой

- exact pushed SHA, чистая синхронизация с upstream, mandatory GitHub Actions и
  branch protection без bypass;
- live DNS/TLS/Caddy/CDN/OAuth callback, production CORS/cookie/WebSocket и
  post-cutover/rollback smoke;
- заполненные operator requisites/effective date, профильная юридическая проверка,
  existing-user re-acceptance и сверка уведомления Роскомнадзору;
- REG.RU mailbox и incident ownership, SPF/DKIM/DMARC, controlled SMTP и реальное
  получение писем каждым Approved Mail Service, канал уведомлений;
- production backup identifier, Managed PostgreSQL restore, фактические RPO/RTO,
  Unified Agent scrape, dashboard panels, runtime collectors и настроенные alerts;
- Yandex ALB/SWS, real SMTP, несколько OS/process instances, production CPU/RSS/
  latency/capacity и настройка порогов по production evidence;
- физические актуальные iOS Safari и Android Chrome, экранная клавиатура,
  переключение сети и ручная проверка на устройствах;
- контролируемый единый Public MVP Journey с реальными группами из 2, 3 и 4
  игроков;
- минимум 30 дней и 100 человеческих посещений для продуктового baseline.

Ни один из этих пунктов не маскируется localhost, browser viewport, fake provider
или developer-laptop benchmark.
