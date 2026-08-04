# Anomaly Detector: актуальный план до Production MVP

Документ содержит только незавершённую работу до контролируемого публичного
теста. Выполненные этапы здесь не хранятся: фактическое поведение определяется
кодом, тестами, [GAME_DESIGN_BRIEF.md](GAME_DESIGN_BRIEF.md),
[RULES_REFERENCE.md](RULES_REFERENCE.md), [ARCHITECTURE.md](ARCHITECTURE.md) и
ADR в `docs/adr/`.

**Статусы:** `[-]` начато частично, `[ ]` не начато, `[~]` отложено.

## 1. Защита публичного трафика и восстановление аккаунта

**Результат:** публичные браузерные, auth-, API- и realtime-маршруты защищены от
автоматизированных атак и имеют распределённые ограничения, а пользователь
заранее понимает доступный путь восстановления password-аккаунта.

**Решение от 4 августа 2026:** платные ALB/SWS отложены, пока проект не приносит
выручку и работает примерно в бюджете `1 000 ₽/месяц`. Минимальный ALB увеличил
бы текущие расходы почти в четыре раза ещё до оплаты обработки запросов SWS.
До пересмотра бюджета production остаётся на single-VM ingress с уже включёнными
PostgreSQL application budgets. Вернуться к edge-защите нужно при росте
публичного трафика, подтверждённых атаках или появлении отдельного бюджета.

1. [~] Подключить Yandex Smart Web Security Advanced Rate Limiter или
   эквивалентный edge/WAF limiter перед API и WebSocket ingress:
   - разделить бюджеты register, login, refresh/logout и OAuth;
   - ограничить WebSocket handshakes по доверенному адресу клиента, включая
     запросы с невалидным или отсутствующим билетом;
   - выделить health checks в отдельное правило или доверенный источник;
   - проверить корректное получение trusted client IP через балансировщик.
2. [~] Подключить защиту от вредоносного автоматизированного трафика на базе
   Yandex Smart Web Security bot management и Smart Protection
   ([#25](https://github.com/Karikatun/anomaly-detector/issues/25)):
   - сначала собрать baseline в observe-only режиме, затем включать challenge и
     блокировку поэтапно с контролем ложных срабатываний;
   - направлять подозрительный браузерный трафик регистрации и входа в
     SmartCaptcha, но не возвращать captcha HTML из JSON API и WebSocket;
   - сохранить работу OAuth callback, health checks, shared NAT, mobile reconnect,
     клавиатурной навигации и доступного fallback/support-пути;
   - не добавлять собственный browser/hardware fingerprinting и не заменять
     серверные auth-, room- и Tender-бюджеты edge-защитой;
   - документировать логи, метрики, rollback, владельца реакции на false positive,
     обработку и сроки хранения bot-detection telemetry.
3. [-] Завершить production abuse/load validation. Локальная PostgreSQL
   integration-проверка уже подтверждает атомарные общие budgets для room join
   (`20 / 60 секунд` по пользователю), Tender-команд (`60 / 60 секунд` по
   `userId + tenderId`), realtime tickets и authenticated mutations
   (`120 / 60 секунд` по пользователю), включая несколько API-инстансов,
   конкурентные запросы, независимые ключи, истечение окна, `Retry-After` и
   security events. Осталось проверить общий NAT, mobile reconnect, полный матч,
   room-code enumeration, command bursts, невалидные WebSocket tickets,
   registration quota races, edge/bot policy, ложные срабатывания и очистку
   истёкших buckets в production-like окружении.
4. [ ] Провести Argon2id benchmark на целевом Yandex-контейнере и закрепить
   допустимый диапазон latency и памяти в тесте или runbook.
5. [ ] До публичного теста выбрать и документировать восстановление
   password-аккаунта через подтверждённую внешнюю identity либо support-процесс.

Обычные authenticated GET и polling не получают отдельные application-level
лимиты без доказанной дорогой выборки или злоупотребления. Общий edge budget
для них появится только после пересмотра решения по ALB/SWS.

**Gate текущего бюджетного этапа:** распределённые application budgets нельзя
обойти переключением между API-инстансами, а обычный вход, reconnect и полный
матч не упираются в них. Edge challenge и блокировка до дорогой работы остаются
осознанно отложенным риском до роста трафика, атаки или отдельного бюджета.

## 2. Игровой интерфейс

**Результат:** Tender полностью понятен и проверен на поддерживаемых desktop- и
mobile-браузерах, а завершённый аудит объясняет результат без избыточной
начальной нагрузки.

1. [-] Завершить participant-only audit/replay
   ([#9](https://github.com/Karikatun/anomaly-detector/issues/9)):
   - объяснить Corporate Trust и Budget tie-break;
   - безопасно обработать недоступные или повреждённые исторические данные;
   - проверить mobile и доступ неучастника.
2. [x] Перенести оставшиеся видимые строки в доменные i18n-чанки и провести
   финальный repository scan
   ([#22](https://github.com/Karikatun/anomaly-detector/issues/22)).
   Завершено 4 августа 2026: русский каталог разделён по продуктовым доменам,
   а обязательный webapp-аудит блокирует видимый текст вне i18n, неизвестные
   ключи и пропущенные параметры интерполяции.
3. [-] Завершить визуальную и accessibility-проверку всех фаз на mobile portrait
   и desktop в рамках release matrix
   ([#23](https://github.com/Karikatun/anomaly-detector/issues/23)).
4. [x] Добавить guided solo tutorial
   ([#10](https://github.com/Karikatun/anomaly-detector/issues/10)).
   Завершено 4 августа 2026: два учебных раунда без таймеров против
   сценарного Учебного соперника показывают Справку, Рабочую модель,
   Тезисы, резерв и заявку на Контракт, а также Финальную научную модель.
   Учебный матч не попадает в историю и рейтинг; аккаунт хранит только отметку
   о завершении, а текущий шаг восстанавливается только в той же вкладке.

### Зафиксированные UX-доработки

1. [x] На mobile прогресс сокращён до текущего этапа в формате «Этап N из M»,
   сегментной шкалы и действия «Все этапы», открывающего полный маршрут в
   модальном окне. Desktop сохраняет развёрнутую шкалу фаз.
2. [x] На mobile действия «Правила» и «Трактовка анализов» объединены в одну
   подписанную кнопку «Справка» с понятным меню. Таймер, текущая фаза и выход
   сохраняют более высокий визуальный приоритет; desktop сохраняет прямые
   действия.
3. [x] Завершённый аудит на mobile сначала показывает место, Rating и начисления
   текущего игрока. Его модель, конфигурация аномалии, модели остальных игроков
   и полный аудит по раундам раскрываются отдельно; фильтр полного аудита по
   умолчанию выбран для текущего игрока, а «Все игроки» доступен вручную.
   Desktop сохраняет развёрнутый аудит.
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

1. [~] Перейти от single-VM baseline к целевой Yandex Cloud topology
   ([#21](https://github.com/Karikatun/anomaly-detector/issues/21)):
   - создать и проверить Compute instance group и Application Load Balancer;
   - подключить Managed PostgreSQL, Lockbox, logging и monitoring;
   - настроить autohealing API и worker;
   - использовать Object Storage только при подтверждённой необходимости.
   Переход, включая ALB/SWS, отложен по решению о бюджете; текущая single-VM
   схема, immutable releases, backups и health checks сохраняются.
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
  application limits работают, платная edge-часть отложена;
- [#20](https://github.com/Karikatun/anomaly-detector/issues/20) — Argon2id
  benchmark и account recovery;
- [#21](https://github.com/Karikatun/anomaly-detector/issues/21) — Yandex
  production topology, monitoring и recovery; ALB-переход отложен по бюджету;
- [#22](https://github.com/Karikatun/anomaly-detector/issues/22) — завершение
  MVP i18n;
- [#23](https://github.com/Karikatun/anomaly-detector/issues/23) — browser,
  device и visual release matrix;
- [#24](https://github.com/Karikatun/anomaly-detector/issues/24) — public MVP
  test и реальные матчи 2–4 игроков;
- [#25](https://github.com/Karikatun/anomaly-detector/issues/25) — платная
  edge-защита от автоматизированного трафика отложена до пересмотра бюджета.
