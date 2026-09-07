# Офлайн-эксперимент с ботами: проверка реализуемости

Этот документ фиксирует воспроизводимый локальный эксперимент для #56. Он не
добавляет офлайн-режим в продукт, PWA, клиентское хранилище матчей или иной
production-контур. Результаты локальны и не участвуют в рейтингах, профиле,
синхронизации или соревновании.

## Как запустить

```sh
bun scripts/experiments/bots-offline/sha256-adapter.differential.ts
bun scripts/experiments/bots-offline/browser-runner.ts
```

Второй скрипт собирает browser IIFE из текущего Tender application engine,
поднимает loopback-сервер и запускает установленный Playwright Chromium. Он
записывает JSON-результат и текст ошибки только в `.scratch/bots-offline/`.
По умолчанию Bun выбирает свободный loopback-порт; его можно заменить переменной
`BOTS_OFFLINE_PORT`. Процесс не останавливает чужие listener'ы. Команды требуют
обычный `bun` в `PATH`.

## Проверенный сценарий

Harness создаёт локальный Tender с in-memory store и двумя участниками:
симулированным человеком и ботом. Он завершает пять раундов для:

- `bot-v2` / `easy`;
- `bot-v2` / `hard`;
- сохранённого `bot-v1` на ruleset `tender-v2`.

После 12 событий он сохраняет replayable transcript в `localStorage`, переводит
Playwright context в offline, заново загружает страницу через локальные static
route fulfill, создаёт новый Tender service и проигрывает transcript. В каждом
случае сохранённая версия стратегии остаётся прежней. Harness также отвергает
до replay transcript с несовместимыми ruleset, strategy version или format
version.

SHA-256 в `sha256-adapter.ts` существует только для сборки эксперимента:
browser target не предоставляет Node `node:crypto`, а Tender fingerprint
использует `createHash('sha256').update(...).digest('hex')`. Differential
скрипт сопоставляет адаптер с native `node:crypto` для пустой строки, ASCII,
Unicode JSON-команды, ввода больше одного блока и ввода больше 1 KB, включая
chunked `update`.

## Фактическое измерение 2026-09-07

Команда выше успешно выполнила шесть Chromium прогонов. Каждый завершил пять
раундов, reload и версионные rejection checks; в ходе каждого сценария были
только четыре same-origin `GET` для HTML и bundle, без API, mutation или
upload.

| Показатель | Значение |
| --- | ---: |
| Browser engine bundle | 404 856 B |
| Исполняемый policy bundle | 16 546 B |
| Полная длительность harness | 2 476 ms |
| SHA-256 differential vectors | 5/5 |

Измерение выполнено на `darwin/arm64`, Bun 1.3.14 и Chromium 149.0.7827.55.
Измерение выполнено на desktop Chromium. Профиль
`desktop-emulated-4x-cpu` использует CDP `Emulation.setCPUThrottlingRate(4)`;
это desktop CPU-emulation, а не измерение физического телефона. В нём максимальная
observed policy latency для `bot-v2` составила 26.2 ms (easy) и 20.8 ms (hard) в
этом единственном прогоне; это диагностический сигнал, не performance SLA.

Размеры bundle считаются `TextEncoder` в байтах, а не длиной JavaScript-строки.
`policy-measure-entry.ts` выполняет видимые вызовы `bot-v1`, `bot-v2/easy` и
`bot-v2/hard`, поэтому измерение включает исполняемый код всех поддерживаемых
веток policy в текущем checkout.

## Границы и рекомендация

Эксперимент доказывает только локальную browser-совместимость механики с
replayable transcript. Он не доказывает PWA cache/offline install, durable
browser storage, server clock, account/auth, anti-cheat, конкурентные команды,
privacy или trusted persistence. В частности, browser не может использовать
Node `node:crypto` без отдельного адаптера; этот адаптер нельзя переносить в
production без отдельного решения.

Необходимо отложить продуктовый офлайн-режим и завести отдельную продуктовую
задачу. В ней должны быть отдельно согласованы PWA/cache и storage policy,
совместимость ruleset и strategy version для долгоживущих transcript, безопасная
граница Node/browser crypto, а также явное отсутствие profile sync, рейтинга и
server upload для локальной игры.
