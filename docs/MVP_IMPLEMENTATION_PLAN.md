# Anomaly Detector: MVP Implementation Plan

## Goal

Deliver a synchronous, competitive browser game for 2-4 authenticated players. A Tender lasts five rounds and targets approximately 45 minutes. Players research a hidden Anomaly Configuration, compete for exclusive Contracts, and determine the winner or shared winners by Rating and deterministic tie-breaks.

The source of truth for product scope is [GAME_DESIGN_BRIEF.md](GAME_DESIGN_BRIEF.md). The game-server and data boundaries are defined in [ADR 0001](adr/0001-authoritative-match-server.md), [ADR 0002](adr/0002-russian-launch-data-and-auth-boundary.md), and [ADR 0003](adr/0003-tender-module-and-audit-log.md).

**Статусы:** `[x]` выполнено, `[-]` начато частично, `[ ]` не начато.

**Общий статус:**
- **Milestone 0 (Contracts)** — ✅ 100% завершён
- **Milestone 1 (Tender Foundation)** — ✅ 100% завершён
- **Milestone 2 (Game Core)** — ✅ целевой набор правил реализован на авторитетном сервере и защищён симуляциями для 2-4 игроков
- **Milestone 3 (Identity, Rooms, Realtime)** — 🔶 основной путь готов; единый активный матч и корректное досрочное завершение реализованы, остаются VK ID и production-защита auth
- **Milestone 4 (Game Interface)** — 🔶 целевой игровой поток и визуальная переработка в активной разработке; не завершены справочник правил, полный аудит/replay, i18n и обучение
- **Milestone 5 (Operations, Public Test)** — 🔶 подтверждён Compute Cloud runtime, добавлены worker health/readiness и локальный recovery drill; production-развёртывание и облачный мониторинг ещё не выполнялись

## Delivery Rules

- The backend is authoritative for hidden state, legal actions, timers, Rating, outcomes, and audit data.
- The Tender Module is the only application seam for game behavior: `createTender`, `execute`, `readTenderView`, and `advanceDueTenders`.
- PostgreSQL remains the source of truth for Tender state, commands, audit data, rooms, users, and match history. Keep current Tender state in JSONB, keep audit events append-only, and add indexes for `phase`, `dueAt`, participants, and status as query needs appear. Introduce object storage or analytics storage only for derived artifacts such as large replay exports, raw telemetry files, or aggregate reporting when a concrete scale or cost problem appears.
- Work in vertical slices. Each game rule starts with one red test through the public Tender Module interface, followed by the minimum green implementation.
- Update `CONTEXT.md` before introducing a new domain term; do not use competing names for existing terms.
- Every issue is independently deliverable, linked to its dependencies, and classified before implementation.
- Do not add chat, public matchmaking, bots, random events, permanent upgrades, monetization, native apps, PWA support, or public sharing to the MVP.

## Ближайший План Перед Production MVP

Порядок ниже учитывает риск потери игрового состояния и злоупотребления публичными auth-маршрутами. Каждый этап должен оставлять систему рабочей и независимо проверяемой.

### P0. Один Незавершённый Матч На Игрока

**Продуктовый инвариант:** игрок может состоять только в одной текущей игровой сессии со статусом `waiting`, `starting` или `active`. Завершённые матчи остаются в истории и не блокируют новую игру.

1. [x] Добавить устойчивую серверную запись текущего матча с уникальностью по `userId`. Создавать её транзакционно при создании/входе в комнату и удалять только при выходе из ожидающей комнаты или терминальном завершении матча.
2. [x] Добавить авторитетный read endpoint текущего матча. Он возвращает комнату/`tenderId` и статус; клиент выбирает маршрут возврата, не дублируя игровые правила.
3. [x] Запретить на сервере создание комнаты и вход по коду, если у игрока уже есть текущий матч. Проверить конкурентные запросы: два одновременных create/join не должны создать две активные записи.
4. [x] На главной при наличии текущего матча заменить карточки «Создать комнату» и «Войти по коду» одной карточкой «Вернуться в матч». На desktop она занимает всю строку; на mobile сохраняет обычную ширину контейнера.
5. [x] Оставить возврат через «Мои матчи». Незавершённый Tender показывать со статусом «Активный», завершённый штатно — «Завершён», завершённый из-за ухода всех игроков — «Завершён досрочно».
6. [x] Добавить backend integration и Playwright-сценарий с двумя игроками: блокировка второй комнаты, возврат с главной, возврат из истории и освобождение возможности создать матч после завершения.

**Gate:** уникальность активного матча доказана на уровне БД/транзакции, а не только скрытием кнопок в клиенте.

### P0. Завершение Матча После Ухода Всех Игроков

**Семантика:** уход — явное действие игрока, а не потеря WebSocket, закрытие вкладки или краткий обрыв сети. Disconnect по-прежнему допускает reconnect и не завершает Tender.

1. [x] Добавить идемпотентные Tender-команды `leave-tender` и `resume-tender` через существующий `execute`. Хранить серверный признак ухода для каждого участника.
2. [x] Когда ушёл последний остававшийся участник, установить отдельный `abandonmentDueAt = now + 5 seconds`, не перезаписывая дедлайн текущей игровой фазы.
3. [x] Если любой участник вернулся до дедлайна, снять отложенное завершение. После дедлайна worker атомарно завершает Tender с `completionReason = all_players_left`; повторный worker-вызов безопасен.
4. [x] Досрочно завершённый матч сохранять в истории и participant-only audit, но не учитывать в победах, среднем рейтинге и других показателях завершённой соревновательной партии.
5. [x] После терминального перехода освободить записи текущего матча всех участников. Главная и история используют короткий polling только пока матч активен/ожидает завершения и инвалидируют общие query keys после leave/resume.
6. [x] Покрыть перезагрузку страницы, одиночный disconnect, уход одного игрока, уход всех с возвратом в пределах пяти секунд и фактическое завершение после пяти секунд.

**Gate:** ни reload, ни сетевой сбой не завершают матч; после ухода всех сервер завершает его независимо от открытых браузеров, а у каждого участника обновляются главная и история.

### P0. Защита Входа И Регистрации

Текущий bounded in-process limiter (`AUTH_RATE_LIMIT_*`) и body limit остаются первой линией защиты, но не считаются глобальным production-лимитом: после масштабирования Compute instance group запросы могут обслуживаться несколькими API-процессами.

1. [x] Разделить auth budgets по маршрутам: register, login и refresh/logout не должны съедать бюджет друг друга.
2. [x] Для password login хранить два независимых общих счётчика:
   - по нормализованному логину — пять неуспешных попыток в окне 15 минут, затем ограниченная экспоненциальная задержка;
   - по доверенному адресу клиента — отдельный более широкий предел до вызова Argon2id против credential stuffing и CPU DoS.
3. [x] Не вводить бессрочную блокировку аккаунта. Верный пароль должен сбрасывать счётчик логина; ответ при неверном логине, неверном пароле и активном throttling остаётся обобщённым и не раскрывает существование аккаунта.
4. [x] Выполнять dummy Argon2id verify для неизвестного логина/аккаунта без пароля, чтобы ранний выход не создавал заметную разницу времени.
5. [-] Хранить счётчики в PostgreSQL с атомарным обновлением, TTL и плановой очисткой. На Application Load Balancer при production-развёртывании ещё нужно подключить Yandex Smart Web Security Advanced Rate Limiter как независимую edge-защиту.
6. [x] После пяти ошибок показывать понятное нейтральное сообщение и приблизительное время повторной попытки, не раскрывая внутренний bucket или точный алгоритм ограничения.

**Gate:** интеграционные тесты покрывают пять ошибок, шестую ограниченную попытку, успешный сброс, независимые login/IP buckets, конкурентные запросы и одинаковый внешний ответ для существующего/несуществующего логина.

### P0. Не Более Трёх Парольных Регистраций С Устройства

Надёжно идентифицировать физическое устройство в браузере невозможно. MVP использует privacy-preserving anti-abuse token, а не canvas/font/hardware fingerprint; очистка cookie остаётся обходом, поэтому это только один слой защиты.

1. [x] При первой browser password-регистрации выдавать долгоживущий случайный device token в подписанной `HttpOnly`, `Secure`, `SameSite` cookie. В БД хранить только HMAC токена.
2. [x] Разрешать не более трёх успешных password-регистраций на device token за 180 дней. Удаление аккаунта не должно немедленно возвращать квоту, иначе ограничение обходится циклом register/delete.
3. [x] Применять правило только к созданию password-аккаунта. OAuth identity остаётся уникальной у провайдера и защищается отдельными OAuth/state и edge-лимитами.
4. [-] Дополнить device quota независимым более широким пределом регистраций по доверенному адресу. Edge rate limit остаётся частью production-настройки Yandex Cloud.
5. [x] Описать anti-abuse cookie, цель, срок хранения и удаление в политике обработки данных. Сырые IP не записываются в anti-abuse buckets: в PostgreSQL хранится HMAC-ключ.
6. [x] Покрыть первую выдачу cookie, три успешных регистрации, четвёртый отказ, конкурентную гонку, поддельный token и отсутствие утечки quota через тексты ошибок.

**Gate:** ограничение атомарно при параллельных запросах и честно обозначено как anti-abuse control, а не как доказательство физического устройства.

### P0. Хранение Паролей

**Текущее состояние:** password-аккаунты сохраняют только PHC-строку Argon2id в `users.password_hash`; уникальная соль генерируется `Bun.password.hash` автоматически, plaintext не пишется в БД, а `Bun.password.verify` определяет алгоритм и параметры из PHC-строки. Новые хеши явно закреплены на `m=65536`, `t=2`, `p=1`, то есть 64 MiB памяти, две итерации и parallelism 1 — выше текущего минимального OWASP baseline `19 MiB / 2 / 1`. При успешном входе более слабый или устаревший PHC атомарно заменяется новым. Непарольные и повреждённые значения проверяются через фиктивный Argon2id-хеш и получают общий ответ без 500 или раскрытия типа аккаунта.

1. [x] Зафиксировать явные `memoryCost=65536` и `timeCost=2` не ниже актуального OWASP baseline и проверять `p=1` в итоговой PHC-строке.
2. [ ] Провести benchmark на целевом Yandex-контейнере и выбрать стоимость, которая остаётся в допустимом latency/памяти под контролируемой параллельной нагрузкой; зафиксировать ожидаемый диапазон в тесте/runbook.
3. [x] При успешном входе определять устаревшие параметры PHC и делать opportunistic rehash через compare-and-set, чтобы усиление настроек не требовало сброса паролей и параллельные входы не перезаписывали более новый hash.
4. [x] Проверить, что пароль и его производные не попадают в серверные логи, ответы, audit или аналитику; тестовые данные используют только синтетические значения. Сохранить общий ответ «неверный логин или пароль».
5. [x] Оставить длину 8-128 как текущий минимум MVP, разрешить password managers и вставку, не вводить периодическую смену или искусственные composition rules.
6. [ ] Перед публичным тестовым запуском решить путь восстановления password-аккаунта через подтверждённую внешнюю identity или документированный support-процесс. Публичная доступность не допускает неоговорённого отсутствия recovery.

**Gate:** security-тест проверяет формат и параметры нового хеша, verify старого хеша и rehash; нагрузочный тест доказывает, что публичный login нельзя использовать для неконтролируемого исчерпания CPU/памяти.

### P1. Переработка Справочника Правил

1. [x] Сохранить единый `RulesReferenceDialog`, доступный с главной и из активного Tender без навигации.
2. [x] Заменить длинный линейный текст доступным accordion с независимо раскрывающимися блоками:
   - основная концепция и цель игры;
   - терминология с небольшими смысловыми иконками и текстовыми подписями;
   - общие правила и структура раунда;
   - детальные правила по фазам: слоты, мощность, разведка, лаборатория, анализ модели, контракты, финальная модель;
   - отдельный раздел «Как трактовать лабораторные анализы» с направлением источник → приёмник, матрицей результатов и примером вывода.
3. [x] На первом открытии раскрывать «Основная концепция», остальные блоки держать закрытыми; запоминание состояния между открытиями не требуется.
4. [x] Использовать нативную/доступную accordion-семантику: клавиатура, `aria-expanded`, видимый focus, заголовки и текстовые подписи. Цвет и иконка не могут быть единственным носителем смысла.
5. [x] Вынести весь текст в rules i18n chunk и сверить его с `RULES_REFERENCE.md` и фактическими серверными правилами. Не показывать игрокам устаревший справочник.
6. [x] Проверить mobile scroll/focus trap, desktop-размер, открытие из Tender без остановки таймера и без потери draft-состояния. Playwright проверяет поведение блоков, а визуальный вид — browser QA, не CSS-assertions. Прокручивается только содержимое, а кнопка закрытия всегда остаётся в видимой нижней панели.

**Gate:** новый игрок может по справочнику правильно объяснить хотя бы один направленный лабораторный результат; справочник не противоречит серверу и не уводит из матча.

## Approved Ruleset Migration

`GAME_DESIGN_BRIEF.md` describes the agreed target ruleset. The checklist below records the completed server-side migration from the original prototype rules; remaining client and explanation work belongs to Milestone 4.

1. [x] Replace starting Samples and Analytical Reports with the new discovery model: no starting Samples; Samples only from Access Slots or Reconnaissance; unknown Signals are revealed when acquired or named by a Contract.
2. [x] Make Power allocation simultaneous and private after Access Slot resolution. Limit Model Analysis and Contracts to one Power; retain two-Power choices only for Reconnaissance and Laboratory.
3. [x] Implement Reconnaissance targets: Unknown Sector or an already revealed Signal. An acquired Sample must be usable in the same round's Laboratory phase.
4. [x] Add the permanent public scientific journal and Continuous private same/different-polarity telemetry.
5. [x] Replace the wrong-Thesis contract-power restriction with Corporate Review and spendable Research Certifications.
6. [x] Replace the Contract generator and bidding model with a seeded round deck of Light, Complex, and Scientific Contracts, target-Signal roles, permanent-but-single-use Contract Evidence, Rating-only rewards, and the revised Final Contract.
7. [x] Implement the revised final Scientific Model scoring: property points, per-complete-Signal points, and complete-model bonus.
8. [x] Build the post-auth home page and the full Rules Reference. The reference must be reachable from the home page and as an in-game modal without leaving a Tender.

**Gate:** deterministic API simulations for 2, 3, and 4 players cover every new rule, including hidden Power planning, Corporate Review, one-use Contract Evidence, Contract deck reproducibility, and final scoring; browser tests cover the Rules Reference from the home page and from an active Tender.

**Статус миграции:** серверная миграция целевого ruleset завершена. Старое описание Milestone 2 ниже актуализировано; клиентская миграция и player-facing объяснение правил остаются частью Milestone 4.

## Milestone 0: Contract And Work Breakdown

**Outcome:** implementation can proceed through stable seams without embedding game rules in routes or realtime handlers.

1. [x] Bring the temporary Access Slot implementation to the asynchronous Tender Module contract in ADR 0003.
2. [x] Define shared command, receipt, view, error, and audit-event DTOs in `packages/contracts`.
3. [x] Require `commandId`, `tenderId`, and authenticated `actorId` for every Tender command.
4. [x] Define player-scoped `TenderView` projections and the error shape for invalid, forbidden, stale, or duplicate commands.
5. [x] Break this plan into tracer-bullet GitHub issues, including dependencies and acceptance criteria.

**Skills:** `tdd` for contract migration and behavior; `domain-modeling` for vocabulary; `to-issues` to create vertical slices; `triage` before work begins; `code-review` after the milestone.

**Gate:** unit and contract tests prove the four-method Tender Module seam, command idempotency boundary, and participant-scoped views.

## Milestone 1: Authoritative Tender Foundation

**Outcome:** the server can persist, resume, and audit a Tender without a browser client.

1. [x] Add PostgreSQL write models for Tender, players, current round/phase state, commands, and append-only audit records.
   - [x] Use PostgreSQL as the Tender source of truth, with JSONB current state and append-only audit events instead of a separate match database.
   - [x] Add focused indexes for `phase`, `dueAt`, participants, and status when the corresponding query paths are implemented.
2. [x] Implement Tender creation for 2-4 players with a server-generated seed and hidden Anomaly Configuration.
3. [x] Implement deterministic restoration after restart and idempotent command handling by `commandId`.
4. [x] Implement `advanceDueTenders` as the only timeout-resolution path.
5. [x] Build player-only audit projections; audit data is not public or shareable.

**Skills:** `tdd` for persistence, retries, deadlines, and visibility; `codebase-design` before repository and audit adapter boundaries; `domain-modeling` for audit terminology; `code-review` before proceeding.

**Gate:** backend integration tests prove persistence, restart recovery, duplicate command safety, and no private data leakage across participants.

## Milestone 2: Five-Round Game Core

**Outcome:** a complete Tender is playable through the authoritative API.

1. [x] Add five fixed rounds and the transitions between Access Slot selection, Power planning, four operational phases, and end-of-round calculation.
   - [x] Add current round number to Tender state and participant Tender views.
   - [x] Add end-of-round transition from round 1 through round 5.
2. [x] Resolve six secret Access Slots with rotating public tie priority and the confirmed direct-request rule: with `A=1`, `B=1`, `C=2`, `D=6`, results are `A=1`, `B=3`, `C=2`, `D=6`.
   - [x] Rotate direct-collision tie priority between rounds.
3. [x] Add four Power per player with simultaneous private planning: up to two for Reconnaissance/Laboratory and up to one for Model Analysis/Contracts.
4. [x] Add Reconnaissance targets, persistent Signals, non-consumable Samples, public discovery and initiating-player private Raw Telemetry.
5. [x] Add Laboratory: directed source-to-receiver tests with Impulse and Continuous Protocols, public results, and authorised Private Measurements.
   - [x] Validate Directed Test source/receiver Samples and reject self-tests through the shared command contract.
   - [x] Resolve Impulse and Continuous Protocols deterministically from the hidden Anomaly Configuration.
   - [x] Store authorised Continuous Private Measurements in participant-scoped Tender views.
   - [x] Project public Laboratory results into Tender views.
   - [x] Project Laboratory results into replay/audit views beyond the append-only audit event.
6. [x] Add Model Analysis: Working Model updates, public Theses, correct-rating reward, Research Certifications, and round-scoped Corporate Review.
   - [x] Validate and resolve public Thesis submissions in Access Slot order.
   - [x] Project checked public Theses to every participant without exposing the hidden Anomaly Configuration.
   - [x] Apply the correct-Thesis Rating reward.
   - [x] Activate Corporate Review after a wrong Thesis and charge Budget for later Theses in the same round.
   - [x] Award and privately expose spendable Research Certifications for correct Theses.
   - [x] Implement player-owned Working Model updates.
7. [x] Add the seeded Contract deck: player-count-plus-one exclusive choices, evidence assessment, Rating rewards, and Corporate Trust.
   - [x] Create `players + 1` public Contracts for the round: one Scientific, one Complex, and remaining Light.
   - [x] Reserve Contracts publicly in Access Slot order.
   - [x] Reject reservation of already reserved Contracts.
   - [x] Add immediate evidence submission for a reserved Contract.
   - [x] Assess Light/Complex evidence and Scientific Research Certifications without consuming public journal facts.
   - [x] Make successful Contract Evidence single-use while keeping the journal entry permanently visible.
   - [x] Add starting Budget and Access Slot budget cost/Remote compensation.
   - [x] Add Access Slot Budget compensation for slot 4 and Sample compensation for slots 5 and 6.
   - [x] Start with 2 Budget and no Samples or Analytical Reports.
   - [x] Add Rating rewards and Corporate Trust without restoring the obsolete requested-funding payout.
8. [x] Add Rating calculation, Final Contract, per-property/per-Signal Scientific Model scoring, complete-model bonus, and deterministic tie-breaks.
9. [x] Add conservative server defaults for missing players: no beneficial slot choice, reserve Power, and skipped unresolved target.

**Skills:** `tdd` for every rule and edge case; `prototype` for timing, planning order, and decision clarity before complex UI work; `domain-modeling` whenever new rules add vocabulary; `grill-me` only if a rule changes score balance or the victory condition; `code-review` after each phase family.

**Gate:** API-level simulated Tenders for 2, 3, and 4 players complete all five rounds, determine the winner or shared winners, and expose a deterministic participant-only audit replay.

## Milestone 3: Identity, Rooms, And Realtime

**Outcome:** real players can securely form and play a private live Tender.

1. [-] Implement Yandex ID and VK ID authentication. Keep Telegram outside MVP until a separate legal review permits it.
   - [x] Add provider-agnostic OAuth identities, PKCE transaction storage, application ports, and Yandex ID start/callback flow.
   - [ ] Complete and validate the VK ID start/callback flow.
2. [x] Enforce Russian-launch data policy: non-blocking 16+ product marking, account deletion that anonymises old match entries, and password registration through a unique login.
   - [x] Add `DELETE /api/auth/account` endpoint: revokes all sessions, anonymises user record
   - [x] Add required `privacyConsent` to the register schema (Zod validation rejects missing/falsy values)
   - [x] Display the consent checkbox and a non-blocking `16+` notice in the registration form; do not collect or claim to verify age
   - [x] Create privacy policy template for legal review
   - [x] Add `anonymizedAt` field to User model (Prisma migration applied)
3. [x] Implement profile locale preference, default and fallback `ru`.
   - [x] Add `locale` field to User model with Prisma migration (default `'ru'`)
   - [x] Include `locale` in `UserDto` and auth responses
   - [x] Add `PATCH /api/auth/profile` endpoint to update locale
   - [x] Display locale in the webapp profile page
4. [x] Implement private rooms with a host-selected fixed size from 2 to 4. Starting requires every seat to be filled and an explicit host confirmation.
   - [x] Allow an authenticated host to create a waiting room and occupy the first seat.
   - [x] Allow authenticated players to join open rooms in seat order and reject a full room.
   - [x] Allow a participant to leave a waiting room and join it again while a seat is free.
   - [x] Allow only the host to start a full room after every player confirms readiness and atomically create its Tender.
5. [x] Add authenticated HTTP endpoints and WebSocket updates that only deliver each participant's authorised TenderView.
   - [x] Add authenticated HTTP reads and command submission through participant-scoped TenderView projections.
   - [x] Issue one-time, session-bound realtime tickets without exposing access tokens in WebSocket URLs.
   - [x] Stream each participant's authorised TenderView over ticket-upgraded WebSocket connections.
6. [x] Support reconnect without pausing the Tender and ensure the worker, not a browser connection, resolves deadlines.
   - [x] Add automatic advanceDueTenders loop to the server entry point
   - [x] Start and stop the loop on server lifecycle
   - [x] Reconnecting subscriber receives the current state after a timeout
7. [x] Enforce the single-current-match invariant and expose the current match to the home page, as specified in «Один Незавершённый Матч На Игрока».
8. [x] Add explicit leave/resume and five-second all-player abandonment through the Tender Module and worker.
9. [-] Complete auth abuse protection.
   - [x] Bound auth request bodies.
   - [x] Add a bounded per-instance client-address limiter and trusted-proxy configuration.
   - [x] Add shared password-attempt counters, unknown-user dummy verification, and registration device quota.
   - [ ] Configure and validate Yandex edge limits on the production ingress.
10. [-] Verify password storage and account recovery posture.
   - [x] Use salted PHC Argon2id hashes with explicit parameters and verify without storing plaintext.
   - [x] Support opportunistic compare-and-set rehash on successful login.
   - [ ] Benchmark Argon2id on the target Yandex container and decide the recovery path before public launch.

**Skills:** `tdd` for authorization, room capacity, reconnect, and deadline behavior; `design-an-interface` before OAuth-provider and realtime protocol boundaries; `context7-mcp` when consulting Hono, Prisma, OAuth, or WebSocket documentation; `triage` and `code-review` for security-sensitive work.

**Gate:** integration and browser tests prove that a room cannot start with an empty seat, one player cannot have two current matches, unauthorised users cannot view a Tender, reconnecting users receive the current authorised state, and public auth routes remain bounded under abuse.

## Milestone 4: Mobile-First Game Interface

**Outcome:** players can finish a Tender from a portrait mobile browser while desktop remains efficient.

1. [x] Build login, profile, home, room creation, room waiting, readiness, host-confirmation, and match-history flows.
2. [-] Complete the live Tender screen for the target ruleset: timer, phase status, Access Slot order, private simultaneous Power planning, public Rating, legal actions, reconnect, and final state exist; continue browser-level validation of the full five-round path.
3. [-] Complete Reconnaissance, Directed Test, Thesis, Contract Evidence, and Final Scientific Model interactions for the target ruleset.
4. [-] Complete the interactive Working Model without exposing hidden Anomaly Configuration data; the private workspace exists, but accessibility and mobile/desktop playtest treatment are still in progress.
5. [-] Complete end-of-round score breakdown and the final participant-only audit/replay. A final screen and audit projection exist, but phase-by-phase replay and complete score explanation remain incomplete.
6. [-] Store every visible string in domain i18n chunks. Russian is the default, but player-visible literals still require a final repository scan.
7. [-] Apply and verify the realistic corporate sci-fi visual system across all phases, mobile portrait, and desktop workspace.
8. [ ] Replace create/join cards with the full-width «Вернуться в матч» state when the current-match endpoint reports an unfinished session.
9. [ ] Finish the accordion Rules Reference and laboratory-result interpretation section described in P1.
10. [ ] Add the short guided solo tutorial already required by `GAME_DESIGN_BRIEF.md`, or explicitly remove it from MVP scope through a product-doc decision before release.

**Skills:** `prototype` for the Working Model and dense mobile interactions; `browser:control-in-app-browser` for mobile and desktop verification; `imagegen` only when original raster assets are needed; `tdd` for client state that affects correctness; `code-review` for each completed journey.

**Gate:** Playwright covers sign-in, room creation, player readiness, full room start, each action family, reconnection, final score, and participant-only audit access on mobile and desktop viewports.

## Milestone 5: Operations, Delivery, And Public Test

**Outcome:** a secure Russian public test deployment runs on Yandex Cloud and provides actionable match evidence. The site is publicly reachable without an allowlist; the first audience arrives through direct links sent to known testers, without a marketing campaign.

1. [-] Configure Yandex Cloud using `yc`: Compute Cloud instance group, Application Load Balancer, Managed PostgreSQL, Container Registry, Object Storage only if required, Lockbox/secrets, logs, backups, and monitoring.
   - [x] Document the target topology, environment, private backend network, custom-domain auth requirements, WebSocket ingress, and Smart Web Security.
   - [x] Replace the incompatible long-running Serverless API/worker topology with a fixed-size Compute Cloud instance group, separate API/worker containers, Application Load Balancer WebSocket ingress, private worker health checks, and Smart Web Security.
   - [ ] Provision and verify the production-like environment; deployment has not started.
2. [-] Keep production data and operational configuration within the Russian launch boundary.
   - [x] Record the Russian data-location decision and Yandex Cloud target.
   - [-] Complete legal readiness before collecting production users.
     - [x] Prepare a comprehensive legal-review draft personal-data processing policy tied to the current data model, authentication providers, Russian hosting target, retention periods, support mailbox, and anti-abuse cookies.
     - [x] Prepare separate versioned personal-data consent and User Agreement texts, expose public legal routes, persist acceptance evidence for password and OAuth registration, unlink deleted identities from Tender JSON/audit, and clean expired OAuth/realtime records.
     - [ ] Fill in the individual operator's full name and legal contact address, complete legal review, file the Roskomnadzor notification, and verify the published legal texts against production processors and retention operations.
   - [-] Configure and test `support@anomaly-detector.ru`; the REG.RU mailbox and MX records are created, while end-to-end delivery, SPF, DKIM, and DMARC verification remain.
3. [-] Complete the release-safety path.
   - [x] Validate environment at startup and expose liveness/readiness endpoints.
   - [-] Run migrations against a production-like copy, document rollback/forward-fix ownership, and perform a real PostgreSQL backup/restore drill.
     - [x] Add and pass an isolated PostgreSQL 18 migration plus `pg_dump`/`pg_restore` rehearsal that cannot touch development data.
     - [ ] Repeat the drill on a production-like Yandex Managed PostgreSQL cluster and record recovery evidence and ownership.
   - [-] Verify that API and worker are both deployed, monitored, and restart-safe; alert on worker lag, overdue Tenders, auth throttling, elevated 5xx, DB saturation, and abnormal realtime reconnects.
     - [x] Add internal worker liveness/readiness with per-loop success, failure, and stale-heartbeat tracking.
     - [ ] Connect API and worker health checks to Compute instance-group autohealing and production alerts.
4. [ ] Add production abuse and performance validation: auth/login load with Argon2id, registration quota races, WebSocket connection/message limits, 2-4 player Tender load, request-size limits, and log redaction.
5. [ ] Run the complete release acceptance matrix on current mobile Safari/Chrome and desktop Chrome/Firefox, including reconnect, refresh, multi-tab session, active-match return, all-player abandonment, audit privacy, and account deletion.
6. [ ] Measure real matches with 2, 3, and 4 players; tune deadlines only when data shows the five-round target is materially missed.
7. [ ] Run a public test without marketing, distributing links directly to known testers. Capture audit-derived defects, balance observations, accessibility problems, rules misunderstandings, support requests, abuse, and operational incidents as GitHub issues.
8. [-] Decide and document support ownership before public MVP: `support@anomaly-detector.ru` is the chosen public contact, but mailbox activation, responsible operator, account recovery, privacy requests, match disputes, and the response when a worker/deployment interrupts an active match remain incomplete.

**Skills:** `tdd` for deployment configuration and privacy-sensitive deletion paths; `diagnosing-bugs` for nondeterminism, concurrency, or performance regressions; `improve-codebase-architecture` after several working verticals and before the public test; `triage` for tester reports; `code-review` before release.

**Gate:** a production-like environment passes health, migration, backup/restore, access control, and end-to-end Tender acceptance checks.

## Release Acceptance

MVP is ready for the public test only when all of the following hold:

- Two to four authenticated players can create a full private room and complete five live rounds.
- A player cannot create or join a second unfinished match and can reliably return to the current one from the home page or match history.
- Explicit departure by all players completes the match after five seconds without treating reloads or network disconnects as departure.
- The server alone determines hidden configuration, timer outcomes, Rating, and the winner or shared winners.
- Every participant receives only public information plus their authorised private information until the final audit.
- Completed Tenders have a deterministic, participant-only replay and score explanation.
- Password login, password registration, and device quota are protected by shared server-side limits plus Yandex edge controls; password hashes use benchmarked, explicit Argon2id parameters.
- The Rules Reference explains concepts, terms, phases, and interpretation of directed laboratory results in an accessible accordion.
- Russian is the default UI language, and all visible text is loaded from i18n resources.
- Automated contract, backend, and browser coverage protects the critical flows.
- Yandex Cloud deployment, data handling, monitoring, and recovery procedures have been verified.
