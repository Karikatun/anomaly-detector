# Anomaly Detector: актуальный план до Production MVP

Документ содержит только незавершённую работу до контролируемого публичного
теста. Выполненные этапы здесь не хранятся: фактическое поведение определяется
кодом, тестами, [GAME_DESIGN_BRIEF.md](GAME_DESIGN_BRIEF.md),
[RULES_REFERENCE.md](RULES_REFERENCE.md), [ARCHITECTURE.md](ARCHITECTURE.md) и
ADR в `docs/adr/`.

**Статусы:** `[-]` начато частично, `[ ]` не начато.

## 1. Защита публичного API и восстановление аккаунта

**Результат:** публичные auth-, API- и realtime-маршруты имеют распределённые
ограничения, а пользователь заранее понимает доступный путь восстановления
password-аккаунта.

1. [ ] Подключить Yandex Smart Web Security Advanced Rate Limiter или
   эквивалентный edge/WAF limiter перед API и WebSocket ingress:
   - разделить бюджеты register, login, refresh/logout и OAuth;
   - ограничить WebSocket handshakes по доверенному адресу клиента, включая
     запросы с невалидным или отсутствующим билетом;
   - выделить health checks в отдельное правило или доверенный источник;
   - проверить корректное получение trusted client IP через балансировщик.
2. [ ] Перенести room-join budget `20 попыток / 60 секунд` из памяти процесса в
   атомарный PostgreSQL bucket по пользователю, сохранив `Retry-After`,
   стабильный `429 RATE_LIMITED` и security event.
3. [ ] Добавить атомарный PostgreSQL budget Tender-команд по
   `userId + tenderId`. Начальная граница для нагрузочной проверки —
   `60 запросов / 60 секунд` с допустимым коротким burst; окончательное значение
   определить по нормальному пятираундовому матчу и нагрузочному тесту.
4. [ ] Добавить страховочный budget authenticated mutations по пользователю.
   Начальная граница — `120 запросов / 60 секунд`; route-specific budgets должны
   срабатывать независимо и раньше общего.
5. [ ] Провести abuse/load validation: несколько API-инстансов, общий NAT,
   mobile reconnect, room-code enumeration, burst Tender-команд, невалидные
   WebSocket tickets, registration quota races и очистка истёкших buckets.
6. [ ] Провести Argon2id benchmark на целевом Yandex-контейнере и закрепить
   допустимый диапазон latency и памяти в тесте или runbook.
7. [ ] До публичного теста выбрать и документировать восстановление
   password-аккаунта через подтверждённую внешнюю identity либо support-процесс.

Обычные authenticated GET и polling не получают отдельные application-level
лимиты без доказанной дорогой выборки или злоупотребления; их закрывает общий
edge budget.

**Gate:** распределённый трафик нельзя обойти переключением между
API-инстансами; атаки получают контролируемый `429` до дорогой работы, а обычный
вход, reconnect и полный матч не упираются в лимиты.

## 2. Игровой интерфейс

**Результат:** Tender полностью понятен и проверен на поддерживаемых desktop- и
mobile-браузерах, а завершённый аудит объясняет результат без избыточной
начальной нагрузки.

1. [-] Завершить participant-only audit/replay
   ([#9](https://github.com/Karikatun/anomaly-detector/issues/9)):
   - объяснить Corporate Trust и Budget tie-break;
   - безопасно обработать недоступные или повреждённые исторические данные;
   - проверить mobile и доступ неучастника.
2. [-] Перенести оставшиеся видимые строки в доменные i18n-чанки и провести
   финальный repository scan
   ([#22](https://github.com/Karikatun/anomaly-detector/issues/22)).
3. [-] Завершить визуальную и accessibility-проверку всех фаз на mobile portrait
   и desktop в рамках release matrix
   ([#23](https://github.com/Karikatun/anomaly-detector/issues/23)).
4. [ ] Добавить короткое guided solo tutorial либо отдельным продуктовым
   решением удалить его из MVP scope
   ([#10](https://github.com/Karikatun/anomaly-detector/issues/10)).

### Зафиксированные UX-доработки

1. [-] На mobile показаны короткие подписи всех фаз в существующем
   горизонтально прокручиваемом прогрессе с автоматическим переходом к активной
   фазе. Осталось проверить на реальном телефоне, что подписи помогают
   ориентироваться, а прогресс вместе с основной шапкой не вытесняет ключевое
   действие из первого viewport.
2. [ ] Сделать мобильные действия «Правила» и «Трактовка анализов» понятными без
   знания иконок. Проверить видимую короткую подпись и единое меню справочных
   действий, не снижая приоритет таймера, фазы и выхода.
3. [ ] Сократить начальную длину завершённого аудита на mobile: сначала
   показывать результат и данные текущего игрока, а модели остальных игроков
   раскрывать по запросу. Полный аудит и фильтр «Все игроки» сохранить.
4. [-] На mobile название сигнала и его иконка вынесены в отдельную верхнюю
   строку, а ниже расположены два независимых подписанных списка: тип поля и
   полярность, включая явное «Не выбрано». Высота списка — `44 px`; desktop
   сохраняет прямые сегменты. Данные исследований открываются отдельной кнопкой
   в модальном окне по тому же шаблону, что и на остальных игровых экранах.
   Кнопка отправки финальной модели закреплена у нижнего края экрана; действия
   остальных фаз остаются после содержимого. Осталось проверить на реальном
   телефоне скорость заполнения, случайные ошибки, клавиатуру, отсутствие
   перекрытия последнего поля и масштаб текста `200%`.

**Gate:** release matrix подтверждает ключевые игровые действия, reconnect,
финал, аудит, приватность, клавиатуру и мобильную композицию без критических
проблем.

## 3. Production-инфраструктура и эксплуатация

**Результат:** production-like Yandex Cloud окружение проходит миграции,
восстановление, мониторинг и безопасный откат.

1. [-] Перейти от single-VM baseline к целевой Yandex Cloud topology
   ([#21](https://github.com/Karikatun/anomaly-detector/issues/21)):
   - создать и проверить Compute instance group и Application Load Balancer;
   - подключить Managed PostgreSQL, Lockbox, logging и monitoring;
   - настроить autohealing API и worker;
   - использовать Object Storage только при подтверждённой необходимости.
2. [-] Завершить legal readiness в российском контуре
   ([#2](https://github.com/Karikatun/anomaly-detector/issues/2)):
   - провести юридическую проверку опубликованных текстов;
   - подать уведомление в Роскомнадзор до открытия production-регистрации;
   - сверить тексты с фактическими обработчиками и сроками хранения.
3. [-] Завершить настройку `support@anomaly-detector.ru`:
   - проверить authenticated outbound delivery к независимым провайдерам;
   - подтвердить SPF/DKIM `PASS`;
   - документировать восстановление mailbox, retention и применимые условия
     обработки данных REG.RU.
4. [-] Завершить release-safety path:
   - повторить migration и backup/restore drill на production-like Yandex
     Managed PostgreSQL;
   - зафиксировать владельца rollback/forward-fix;
   - подключить API/worker health checks к autohealing и production alerts;
   - наблюдать worker lag, overdue Tenders, auth throttling, 5xx, DB saturation
     и аномальные realtime reconnects.
5. [ ] Провести production abuse и performance validation для auth/login,
   Argon2id, registration quota, edge limits, room join, Tender-команд,
   WebSocket, reconnect, матчей 2–4 игроков, request-size limits и log redaction
   ([#19](https://github.com/Karikatun/anomaly-detector/issues/19),
   [#20](https://github.com/Karikatun/anomaly-detector/issues/20)).

**Gate:** production-like окружение проходит health, migration, backup/restore,
access-control и полный Tender flow; проверен безопасный откат.

## 4. Контролируемый публичный тест

**Результат:** известные тестировщики проходят реальные матчи, а продуктовые и
операционные проблемы превращаются в проверяемые GitHub Issues.

1. [ ] Выполнить release acceptance matrix на актуальных mobile Safari/Chrome и
   desktop Chrome/Firefox: reconnect, refresh, multi-tab session, возврат в
   активный матч, all-player abandonment, audit privacy, удаление аккаунта и
   cross-phase visual/accessibility review
   ([#23](https://github.com/Karikatun/anomaly-detector/issues/23)).
2. [ ] Провести реальные матчи для 2, 3 и 4 игроков. Менять дедлайны только при
   подтверждённом отклонении от целевой продолжительности
   ([#24](https://github.com/Karikatun/anomaly-detector/issues/24)).
3. [ ] Запустить публичный тест без маркетинга, передав ссылки известным
   тестировщикам. Дефекты аудита, баланса, доступности, понимания правил,
   поддержки, abuse и эксплуатации фиксировать как Issues
   ([#24](https://github.com/Karikatun/anomaly-detector/issues/24)).
4. [-] Завершить модель support ownership: account recovery, privacy requests,
   споры по матчам, retention и действия при сбое worker/deployment во время
   активного матча.

**Gate:** тестировщики завершают полный Tender, критические дефекты и инциденты
имеют владельцев, а production-состояние можно наблюдать и безопасно
восстановить.

## Открытые GitHub Issues

- [#2](https://github.com/Karikatun/anomaly-detector/issues/2) — legal и support
  operations;
- [#9](https://github.com/Karikatun/anomaly-detector/issues/9) — детали
  participant-only audit;
- [#10](https://github.com/Karikatun/anomaly-detector/issues/10) — guided solo
  tutorial;
- [#19](https://github.com/Karikatun/anomaly-detector/issues/19) — distributed
  application и edge abuse limits;
- [#20](https://github.com/Karikatun/anomaly-detector/issues/20) — Argon2id
  benchmark и account recovery;
- [#21](https://github.com/Karikatun/anomaly-detector/issues/21) — Yandex
  production topology, monitoring и recovery;
- [#22](https://github.com/Karikatun/anomaly-detector/issues/22) — завершение
  MVP i18n;
- [#23](https://github.com/Karikatun/anomaly-detector/issues/23) — browser,
  device и visual release matrix;
- [#24](https://github.com/Karikatun/anomaly-detector/issues/24) — public MVP
  test и реальные матчи 2–4 игроков.
