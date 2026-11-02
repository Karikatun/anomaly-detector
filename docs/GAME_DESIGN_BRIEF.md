# Anomaly Detector: Design Brief

Статус: правила стандартного режима реализованы. Срез #76 добавляет простой
режим по принятым решениям #74; проверка его баланса остаётся в #77.
`Anomaly Detector` — рабочее название, не подтверждение прав на бренд.

Player-facing wording: [RULES_REFERENCE.md](RULES_REFERENCE.md).

## Product

`Anomaly Detector` is a synchronous, competitive, browser-based deduction strategy game for 2-4 players. Research players compete aboard an orbital station that studies an unknown natural anomaly. A corporation will award a single funding tender to the player with the highest final rating.

The game borrows only the genre-level premise of deduction from incomplete experimental evidence. It has an original setting, terminology, directed experiments, tender structure, action flow, visual expression, and rules. Do not copy any text, art, terminology, components, scoring tables, formulas, turn structure, or app behaviour from *Alchemists*.

В партии участвуют 2–4 исследователя. Оба режима поддерживают людей и
серверных ботов easy/hard. Срез #77 добавляет простому режиму отдельную
сохраняемую стратегию `bot-simple-v1`; версии standard не меняются.
Клиент адаптирован для телефона и desktop.
С публичного лендинга игрок может пройти одиночное обучение без регистрации,
затем войти или создать аккаунт и перейти к настоящей партии. Защита аккаунта
остаётся добровольной. Изменение учебного сценария — отдельные #75/#78/#79.

## Простой режим

Партия длится три раунда по четыре мощности, без обычных и финального
контрактов. Шесть сигналов и 720 допустимых конфигураций сохраняются.
Образцы, направленные опыты Deep/Broad, собственные измерения, Рабочая модель,
тезисы и явная сдача Финальной научной модели остаются частью исследования.
Совпадение мощности со стандартом не разрешает выделять её на контракты.

- Стартовый бюджет — 2. В конце каждого раунда, включая последний, начисляется
  грант +1 бюджета.
- В начале раунда пул прямого выбора содержит все шесть сигналов. Прямой выбор
  убирает предложение до следующего раунда; собственный образец повторно не
  выдаётся. Случайный поиск выбирает лично недостающий сигнал независимо от
  пула и чужих образцов и не меняет пул. На разведку можно выделить не более
  `min(2, число недостающих образцов)` мощности.
- Итоговый слот 1 стоит 2 бюджета, слот 2 — 1. Слот 3 бесплатен, слот 4 даёт
  +1 бюджета, слот 5 — случайный недостающий образец, слот 6 — образец и +1
  бюджета. Бонус выдаётся до распределения мощности; при полном наборе
  пропускается без замены. Бюджет за слот 6 сохраняется.
- При коллизии сначала сохраняется прямой выбор и вращающийся приоритет.
  Вытесненный игрок получает только свободный слот 3–6: ближайший к заявке,
  а при равном расстоянии — более поздний. Достаточный бюджет не разрешает
  автоматически назначить платный слот. Цена и бонус определяются итоговым
  слотом; запрос платного слота без бюджета отклоняется.
- Тезис стоит 1 мощности, максимум два за раунд. Первый не расходует бюджет.
  После ошибочного первого второй стоит +1 бюджета независимо от результата.
  Без этого бюджета анализ завершается и оставшаяся мощность анализа сгорает.
  Правило сбрасывается каждый раунд; предупреждение показывается до
  распределения мощности. Тезисы не приносят итоговых очков или контрактных
  сертификатов.
- Итог — по одному баллу за верный тип и полярность каждого сигнала, максимум
  12. Бонусов за сигнал и полную модель нет. При равенстве сравниваются больший
  остаток бюджета и более ранняя явная сдача: сервер сохраняет уникальный
  порядок принятых команд. Черновик и часы клиента не задают сдачу.

При обычном завершении участвуют в определении победителя только явно сданные
финальные модели. Сданная модель с 0 баллов имеет результат и стоит выше
несданного черновика, даже если его владелец сохранил больше бюджета. Если к
дедлайну никто не сдал модель, партия заканчивается без победителя независимо
от бюджета. Черновики не оцениваются. Досрочное завершение и Forfeit сохраняют
свои отдельные правила.

До `complete` общие сведения — имена, отметки ботов и выхода, раунд, фаза,
таймер, текущий ход, готовность, разрешённые слоты, пул и бюджеты. Собственные
образцы, категории мощности, заявки до разрешения, случайные выдачи, пары,
протоколы и результаты опытов, измерения, тезисы и модели приватны. По
изменению пула или бюджета соперник может сделать косвенный вывод; это принято.
Правило одинаково для API, realtime и восстановления после перезапуска.

После `complete` полный игровой аудит доступен всем участникам, включая
выбывших: исследования, измерения, тезисы, действия по раундам, финальные
модели и конфигурация. Индивидуальный Forfeit до завершения ничего не
раскрывает. Посторонние не получают аудит, в том числе из истории.

Профиль считает партии, победы, процент побед, среднее место и среднюю
точность из 12 отдельно по режимам. Рейтинг и контрактные показатели остаются
только у стандарта; любой матч с ботом отображается только в истории.
Ни реализация #76, ни локальные сценарии не подтверждают баланс или понимание
правил человеком: для #77 принят отдельный frozen bot-протокол, человеческая
проверка отложена.

Остальные разделы ниже описывают стандартный режим, если явно не сказано иное.

The primary MVP Initiator is a Russian-speaking fan of board games, science fiction, and logical deduction who first learns alone and then brings one to three acquaintances into a standard Tender. The landing promise is «Разгадайте аномалию раньше соперников», supported by the literal facts «Бесплатно · без скачивания · 2–4 игрока» and real product screens rather than invented social proof.

## Core Fantasy

Players are competing R&D contractors. They capture telemetry from six named anomaly signals, run directed laboratory experiments, build a model of new physics, and turn verified effects into exclusive corporate contracts for energy control and deep-space communications.

The anomaly is natural, not an ancient artefact or a hidden code. The tone is grounded corporate sci-fi, without parody or a cartoonishly evil corporation.

## Victory

Five fixed rounds end with a final corporate audit. The player with the highest public final rating wins the tender.

- Commercial Contracts and science must both be viable paths to victory. Ordinary Contracts give either two, three, or four Rating according to their type; the Final Contract gives eight Rating.
- The final model gives one Rating for each correct signal property, one Rating for each Signal with both properties correct, and a three-Rating bonus for a complete correct model. A fully correct final model therefore gives 21 Rating.
- Tie-breakers, in order: higher research confirmation, more remaining budget, then shared victory.
- The score breakdown is public after every round. The unsubmitted portion of a player's final model stays hidden until the audit, with its possible score range shown.

Future rating categories are reserved in the data model but not implemented: patents, station infrastructure, station safety, and long-term research programmes.

## Статистика личного профиля

Личный профиль учитывает только завершённые матчи, в которых участвовал текущий игрок. Активные партии и исторические записи, из которых нельзя целиком восстановить результат по актуальным правилам, не входят ни в один показатель.

- Совместная победа считается полноценной победой для каждого победителя.
- Полная таблица мест использует те же критерии, что и определение победителя: итоговый рейтинг, число верных тезисов и оставшийся бюджет. При полном равенстве игроки делят место с пропуском следующего: `1, 2, 2, 4`.
- Средний рейтинг считается по итоговому Rating игрока.
- Точность модели — доля верно указанных свойств из 12 возможных. Незаполненные свойства считаются неверными; бонусы за полностью угаданный сигнал и всю модель в точность не входят.
- Успешность контрактов — доля успешных подач среди всех принятых сервером подач обычных и финальных контрактов. Пропуски, тайм-ауты и технически невалидные запросы не считаются попытками.
- Если завершённых матчей нет, счётчики матчей и побед равны нулю, а проценты и средние значения не определены.

## Просмотр результата Тендера

На desktop итог занимает всю доступную ширину. Слева видны места и рейтинг
участников, справа — разбор выбранного игрока. По умолчанию выбран текущий
игрок. Вкладки «Очки и ресурсы» и «Финальная модель» делят общую высоту:
переключение не сдвигает нижние разделы и не обрезает содержимое.

Конфигурация Аномалии раскрывается отдельно. Кнопка «Полный разбор партии»
открывает только аудит по раундам с фильтром по участнику. Модели доступны
в разборе выбранного игрока на основном экране. Этот же
экран доступен через «Открыть результаты» в истории матчей. Мобильная версия
сохраняет компактные раскрывающиеся разделы.

## Shared Hidden World

Each match has a server-generated, reproducible, solvable anomaly configuration. The server stores the seed.

- The anomaly contains six stable Signals: `Aster`, `Boreal`, `Cinder`, `Delta`, `Eclipse`, and `Ferro`. Players initially know only that six Signals exist. A name appears in the public registry when a player obtains its Sample or when a Contract names it.
- Each signal has two hidden properties: a field type and a polarity. The field types are `inertial`, `electromagnetic`, and `phase`; polarities are `positive` and `negative`. Every configuration assigns each of the six possible field-type/polarity pairs to exactly one Signal, shuffled by the server seed.
- Players see four public result classes from a test: transmission gain, attenuation, reflection, and unstable collapse.
- Results are generated by directed interactions, not unordered combinations. A test chooses a source signal, a different receiver signal, and an emission protocol.
- Один игрок не может повторно исследовать уже проведённую им направленную пару, даже по другому протоколу. Обратное направление остаётся отдельным опытом, а исследование той же пары другим игроком разрешено.
- A signal sample does not get consumed. Scarcity comes from access to new Samples, laboratory capacity, Budget, and timing.
- A Sample is private to its owner even after the Signal name becomes public. Other players need their own Sample to use that Signal in a Directed Test.

### Правило направленного взаимодействия

Типы поля образуют цикл: инерционное -> электромагнитное -> фазовое -> инерционное. В направленном опыте важны источник и приёмник.

- Одинаковый тип поля и одинаковая полярность дают усиление.
- Одинаковый тип поля и разная полярность дают ослабление.
- Если тип приёмника следующий в цикле после типа источника, одинаковая полярность даёт отражение, а разная - нестабильный срыв.
- Если тип приёмника предыдущий в цикле, одинаковая полярность даёт ослабление, а разная - усиление.

Например, опыт из инерционного источника в электромагнитный приёмник идёт вперёд по циклу: одинаковая полярность даст отражение, разная - нестабильный срыв.

At match start each player receives two Budget and no Samples. Samples enter play only through Access Slot compensation or Reconnaissance.

## Laboratory And Deduction

The starting protocols are:

- Impulse costs one Laboratory Power and gives one public result class.
- Continuous costs two Laboratory Power and gives the same public result plus a private measurement: whether the source and receiver have the same or different polarities.
- With two Laboratory Power the player explicitly chooses Deep (one Continuous test) or Broad (two distinct directed Impulse tests committed atomically). Broad gives two public results and no private polarity measurement.

Signals cannot be tested against themselves in the MVP. Self-tests may become a future technology.

Every Directed Test is written to a permanent public scientific journal with its source, receiver, Protocol, and public result. The journal gives every player shared facts for deduction; the initiator's Continuous private measurement remains private until the final audit.

Every player has a private interactive deduction model. It supports possible-property marks, exclusions, personal hypotheses, and optional notes. It warns only about contradictions with confirmed public facts; it never solves the puzzle or recommends the next test.

Players may allocate one or two Model Analysis Power for up to one or two private, immediately checked Theses. The author sees field-type and polarity correctness separately without learning the correct values. Other players receive neither the Thesis values, result, nor personal Thesis count during play. A fully correct Thesis gives one Rating and one personal Research Certification the first time that player certifies the Signal. A Research Certification is consumed by a successful Scientific Contract.

Model Analysis uses one shared 90-second window in which players act independently. An incorrect first Thesis triggers a personal Corporate Review for the rest of that round: only that player's second Thesis costs one Budget. A player without the Budget loses the unused Model Analysis Power. After the first Thesis a player who allocated two Power may voluntarily finish with confirmation; timeout preserves submitted work and burns unused Power.

The final Scientific Model uses one shared three-minute window. At phase entry the server snapshots only explicit Working Model hypotheses into each player's private draft; possible and excluded marks remain hints and are never selected automatically. Draft edits autosave independently, survive reconnects, and stop synchronising from the Working Model. Only an explicit atomic submission is scored or revealed; an unsubmitted draft is discarded at timeout.

## Round Structure

Each match has five rounds.

1. The current round's Contracts are revealed.
2. Players secretly choose an Access Slot.
3. The server resolves Slots and reveals the round order.
4. Players simultaneously and secretly allocate Power; allocations are revealed once every player has confirmed.
5. Operations resolve by phase and Access Slot order: Reconnaissance, Laboratory, Model Analysis, then Contracts.
6. The end-of-round calculation applies grants, contracts, trust, rating, and new available work.

The first-position tie priority rotates once per round. It resolves otherwise equal slot conflicts and is public before choices begin.

### Access Slots

Слотов всегда шесть, независимо от числа игроков. Каждый игрок тайно выбирает один слот. Игрок, напрямую выбравший слот, сохраняет приоритет перед игроком, сдвинутым из более ранней коллизии. Если несколько игроков напрямую выбрали один слот, победитель коллизии остаётся в нём, а остальные по очереди сдвигаются в ближайший свободный слот согласно вращающемуся приоритету. При равной дистанции выбирается более поздний слот. Например, при приоритете `A, B, C, D` заявки `A=1`, `B=1`, `C=2`, `D=6` дают результат `A=1`, `B=3`, `C=2`, `D=6`.

| Slot | Access order | Cost | Compensation |
| --- | ---: | ---: | --- |
| Emergency | 1 | 2 budget | None |
| Priority | 2 | 1 budget | None |
| Standard | 3 | None | None |
| Off-peak | 4 | None | 1 budget |
| Night | 5 | None | 1 signal sample |
| Remote | 6 | None | 1 budget and 1 signal sample |

Slot compensation is fixed in the MVP. Early access grants operational priority; late access grants planning information and resources.

Samples granted by slots are selected deterministically by the server: first from as-yet undiscovered Signals, then from Signals the player does not already hold. Their names become public when granted.

### Power

Each player has four Power units per round, allocated secretly among four action categories before every allocation is revealed together.

| Category | One power | Two power |
| --- | --- | --- |
| Reconnaissance | Acquire one Sample | Acquire two Samples |
| Laboratory | One Impulse test | One Deep Continuous test or two Broad Impulse tests |
| Model analysis | Submit up to one private Thesis | Submit up to two private Theses |
| Contract | Reserve and submit one Contract | Not available |

Reconnaissance, Laboratory, and Model Analysis accept at most two Power; Contracts accept at most one. Power allocation fixes only the category and amount. A player picks its exact target when its phase opens. It can revise any choice before confirmation; confirmed actions are final.

Every Tender stores an immutable ruleset identifier. New matches use `tender-v2`; persisted state without an identifier is interpreted as `tender-v1`, and all UI rules/help content is selected from the match version rather than a deployment-global flag.

Reconnaissance can target an Unknown Sector or an already revealed Signal. An Unknown Sector deterministically reveals one undiscovered Signal and gives its Sample to the researching player. An already revealed Signal gives its Sample only if the player does not already have it. A Sample acquired in Reconnaissance can be used in that same round's Laboratory phase.

## Contracts, Budget, And Trust

The server generates a deterministic, state-independent Contract deck from the Tender seed at match creation, then reveals `number of players + 1` exclusive Contracts at the start of each round. The set contains one Scientific Contract, one Complex Contract, and Light Contracts for the remaining slots. Every Contract names a target Signal, specifies whether it is the source or receiver, and defines the required public effect. Naming an undiscovered Signal does not grant its Sample or reveal its properties.

- A Light Contract gives two Rating for one unused, own Directed Test with the target Signal in its required role and required public effect.
- A Complex Contract gives four Rating for either one unused, own Continuous Directed Test with the required role and effect, or two unused, own Directed Tests with the target Signal in its required role and the two listed distinct public effects.
- A Scientific Contract gives three Rating for one unused, own Research Certification for its target Signal.
- A player can win at most one ordinary Contract per round. Reservation is public and final: the player must immediately submit that Contract and cannot switch after reserving it.
- A player with no currently eligible Contract may explicitly skip the Contract action instead of waiting for the phase deadline.
- A Directed Test stays permanently visible in the public journal and remains usable in later rounds, but one Test record can be attached to only one successful Contract.
- One Final Contract is visible from round one and resolves in round five. It gives eight Rating, requires at least two trust points, and uses the Complex Contract evidence rule.

Successful ordinary Contracts grant one trust point but never Budget. Each player receives one Budget at the end of every round, in addition to late-slot compensation. Trust gates the Final Contract; it is not a score multiplier.

## Timing And Failure Handling

Every live phase has a 90-second server deadline except the final Scientific Model, which uses one shared three-minute deadline. Access Slot selection, Power allocation, Model Analysis, and the final Scientific Model use shared deadlines because players act independently. In the remaining ordered operational phases, each active player receives a fresh 90 seconds when their choice opens.

If a player times out or disconnects, the server takes conservative, non-beneficial defaults: a standard or later free slot without budget spend, unallocated power to reserve, and a skipped unresolved target. The player may reconnect and continue. A missing player never blocks a match.

Closing, reloading, losing the network, or choosing Collapse only leaves the game screen; it never changes participation. Explicit Forfeit is permanent: the player loses live access, is skipped by every phase, remains in history and the final audit, and cannot win. If one active player remains, the Tender completes early with that player as winner.

## Modes And Match Setup

- Standard rooms are private, invite-code rooms for exactly 2, 3, or 4 real players.
- The host chooses the room size. A game cannot start until every chosen slot is occupied, and the host must explicitly confirm start.
- Standard matches have no bots, public matchmaking, global ranks, chat, monetisation, purchases, random crisis events, or permanent upgrades in the MVP.
- Повторяемый одиночный урок использует реальный интерфейс Тендера и два детерминированных раунда с видимым учебным соперником. Таймер выключен; учебные очки и модель не попадают в историю и статистику настоящих матчей. В аккаунте сохраняется только отметка о прохождении.
- Урок показывает слот доступа, распределение мощности, разведку, непрерывный и импульсный направленные опыты. После первого опыта игрок вручную открывает Журнал и проходит «Данные исследований → Трактовка → Рабочая модель» в одном окне. Автосохранение записывает черновик, не проверяет догадку и не закрывает окно. Игрок сам закрывает Журнал и отдельно отправляет Тезис на поле; во втором раунде возвращается к данным для новой гипотезы. Проверки тезисов допускают повтор без штрафа. Контракт и отдельная финальная модель сохраняют явные действия отправки. Итог объясняет, что в обычном Тендере пять раундов, все виды контрактов, таймеры и финальная модель с шестью сигналами.
- Обновление той же вкладки сохраняет учебный черновик. Устаревшие именные шаги текущего урока продолжаются с соответствующего действия; отметка завершения остаётся прежней. Выход с подтверждением, повтор или новая вкладка начинают урок заново; активный настоящий Тендер блокирует вход в обучение.
- A non-ranked learning room for 2-4 friends uses four signals and three rounds, without trust penalties or the final contract.

Рабочая модель, полные записи опытов и личных измерений, история тезисов находятся в трёх существующих вкладках Журнала. На поле остаются текущие команды, ресурсы, фаза и время; единственное информационное исключение — полный редактор модели на широком экране в этапе анализа, использующий тот же черновик. При соединении в последние десять секунд Журнал открывает только данные исследований для чтения из разрешённого сервером представления. Это не отменяет ограничений фазы, хода, редактирования или отправки команд. В обычной партии результаты не открывают Журнал автоматически.

## Audit, History, And Privacy

After every finished game, participants receive a complete post-match audit and a read-only phase-by-phase replay. It reveals the anomaly configuration, all private measurements, bids, actions, seed-derived results, score sources, and tie-break resolution.

Only match participants can access its audit and replay. Public sharing links are not supported.

Accounts have match history. On account deletion, remove the profile and identity-provider links while retaining finished match records in anonymised form as `Deleted participant`, so other participants keep a coherent audit.

## Accounts, Data, And Russian Launch Scope

The initial audience is Russian citizens. The product operator is a Russian citizen acting as an individual. The application therefore must be designed as an operator of personal data, not as a private family-use tool.

- Primary sign-in: Yandex ID; password registration and sign-in use a unique login.
- An Account Email is unique across active accounts. Yandex ID supplies and refreshes its `default_email` when the provider permission is available; the immutable provider subject remains the identity, and matching email never merges accounts.
- A password-account owner may voluntarily confirm an Account Email as Recovery Email after the tutorial. It is not a login, marketing contact, or gameplay-notification channel. A Yandex ID account recovers through Yandex.
- First Recovery Email activation uses the current password, a code sent to the new address, and a 24-hour cooling-off window. Replacing an active address also requires proof from the old address or a user-held Recovery Code.
- Password reset uses a generic login-based request, a short-lived one-time link or Recovery Code, and revokes every session and recovery credential after success. Support and administrators cannot assign a new email or reset these factors manually.
- New password-account addresses must match an exact public domain in the published Approved Mail Service catalog or use a custom `.ru`/`.рф` domain whose complete current MX profile matches one approved provider. This identifies only the first receiving mail service; ownership still requires the emailed one-time code, and Yandex ID addresses remain provider attributes even when they are not locally approved for recovery delivery.
- The authenticated app offers a product-owned Feedback Report form for errors and suggestions. Account linkage and a reply contact are separate optional choices; Account Email is never reused as a support contact automatically.
- VK ID and Telegram OAuth are outside the MVP until a separate product and legal review permits them.
- Store Russian users' personal data, identity links, and match history in Russia. The production target is Yandex Cloud through `yc`.
- Publish an accessible personal-data processing policy before collecting user data. Before launch, obtain legal review for the Roskomnadzor notification obligation, authentication providers, recovery and transactional-mail flows, separate analytics consent, feedback intake, recipients, and retention policy.
- Product age marking for the MVP: `16+`.

This is a product requirement, not legal advice. Revalidate all legal and provider requirements immediately before launch.

## Language And Interface

- Base locale and fallback: `ru`.
- The first release defaults to Russian. Locale is a manual profile setting and is retained for later translations.
- All user-facing copy is externalised by domain-specific i18n chunks, including auth, lobby, match, tutorial, audit, validation errors, contracts, and legal documents. Do not hard-code player-visible text in UI components.
- After sign-in, the home page links to a complete Rules Reference. The same reference opens as a modal during a Tender, without leaving the match.
- Mobile portrait is a first-class interface. The deduction model opens as a dedicated full-screen view; the match timer and current phase remain continuously visible.
- Desktop is a full product surface, using a multi-panel workspace for the model, experiment log, contracts, and active phase.
- Meaning is never conveyed by colour alone. Test results and signal properties use a colour, a distinct icon, and short text.

## Technical Product Constraints

- The backend is authoritative for the hidden configuration, seeds, timers, validation, results, scores, contracts, and audit. Browser clients receive only public and player-authorised private information.
- Real-time state must support reconnecting players and a deterministic replay log.
- Use the existing `website`, `webapp`, `adminapp`, and modular-monolith backend surfaces. `website` owns the public static content on the root domain; `webapp` owns registration, tutorial, account, and gameplay on `app.`; `adminapp` owns protected operational projections and only explicitly listed audited commands.
- Deploy the Production MVP in Yandex Cloud through the repository runbooks. The public website, player app, API, and operator surface have distinct hosts and indexing/cache boundaries.

## Explicitly Deferred

- More than two active victory categories.
- Public matchmaking, global ratings, seasons, anti-fraud ranking systems, and spectating.
- Chat and shared replay links.
- Native applications, PWA/offline support, and content marketing beyond the MVP landing page.
- Payments and monetisation.
- Bots for standard matches, random events, self-tests, permanent upgrades, and variable slot compensation.
- International legal and identity-provider support beyond the Russian launch scope.

## Validation Before Feature Expansion

Before expanding the MVP, prototype and playtest the core loop with the following questions:

1. Can a new player understand a directed test and use the deduction model after the tutorial?
2. Does early access versus late compensation create meaningful but fair choices?
3. Can commercial and scientific paths both win across 2, 3, and 4 players without an early Contract lead deciding the match?
4. Are contract challenges rare, intentional, and understandable?
5. Does a four-player standard game complete within 40-50 minutes?
6. Can every final result be explained unambiguously by the audit and replay?
7. Can a new visitor understand the product and complete the tutorial from the public landing CTA without losing intent during registration?
8. Can a password-account owner protect and recover access without allowing a stolen login and password, email collision, replay, or operator action to take over the account?
9. Can an authenticated player submit a useful Feedback Report without exposing private game state or creating an external public issue?
