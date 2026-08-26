# Аудит distributed anti-abuse budgets и realtime

Дата: 2026-08-24
Этап: local production-like validation, без push, deploy и production-запросов.
Базовый checkout: `66afebf`; проверяемый security-срез внедрён в `68499c9`.

## Scope и граница доказательства

Проверены password auth с Argon2id, общий authenticated-mutation budget,
transactional-mail outbox, Room join, Tender commands, WebSocket ticket/upgrade,
межинстансная доставка и клиентский reconnect. Полные audit-профили:
Security/privacy, Persistence/concurrency, Performance и Cross-layer/product
contract; исправления выполнялись TDD-first.

Production-like driver использовал Bun `1.3.14`, PostgreSQL 18 в отдельной
`*_test` БД и два реальных TCP API/WebSocket listener с независимыми Hono app,
realtime hub и Prisma pool, но в одном OS process. Docker Desktop: client
`29.4.0`, engine `29.7.2`, Compose `5.3.1`, `aarch64`, 14 vCPU и 8.32 GB VM
memory. SMTP был только fake provider: измерено admission/lease/budget
поведение, не сеть REG.RU и не получение письма в ящик.

Исторический драйвер находился в `.scratch`, отказывался работать с БД без суффикса
`_test`, не сохранял access/refresh/realtime tickets, room codes, login/email,
HMAC keys или request bodies и не входит в product diff. Сценарий был повторён
после исправлений с одинаковыми status boundaries и без неожиданных `5xx`.
Это локальный baseline и нижняя доказанная граница, не production SLO и не
capacity ceiling для ALB, Managed PostgreSQL или отдельного multi-process
deployment.

С 2026-08-25 воспроизводимый преемник находится в
`backend/scripts/local-abuse-performance.ts` и запускается только через:

```bash
bun run benchmark:local-abuse
```

При уже загруженном PostgreSQL image ориентир для developer laptop — 30–90 s;
первый image pull может занять несколько минут. Workload намеренно включает 30
одновременных Argon2id login и 100 invalid-ticket запросов, поэтому его запускают
отдельно от других локальных load/E2E прогонов и только при достаточном запасе
CPU/RAM.

Runner очищает inherited Docker/Compose/database/provider selectors, инспектирует
Docker context без caller overrides и принимает только local Unix socket. Он
создаёт invocation-scoped Compose project с динамическим loopback port, сам
формирует URL БД `anomaly_detector_test`, отключает SMTP и не обращается к live
provider. Успешный JSON с `scope: "local_isolated"` и
`artifactRetention: "ephemeral_cleanup_confirmed"` появляется только после
подтверждённого `docker compose down -v`; raw Docker/driver stderr, credentials,
login/email, пароли, hashes, tickets, Recovery Codes и reset tokens в evidence
не попадают.

Versioned manifest сохраняет прежние локально измеримые auth/mutation/Room/
Tender/fake-mail/realtime boundaries и добавляет отсутствовавшие проверки:

- Feedback: concurrent границы `5/account/day` и `20/trusted IP/day`;
- realtime: отдельные ticket budget и invalid-ticket churn, cross-pool update и
  reconnect snapshot, затем ровно десять активных subscriptions одного игрока
  в одном process; одиннадцатая закрывается `4429`, исходные десять остаются
  открыты, один sync выполняет десять view reads;
- Argon2id: новый hash, wrong-password verify и unknown-account fallback без
  раскрытия существования account, opportunistic rehash, email password reset и
  Recovery Code password reset. Для трёх повторов каждого primitive evidence
  включает latency percentiles, process CPU и sampled process RSS; это локальная
  нижняя граница процесса, а не peak RSS/CPU production VM.

Версионированный runner отдельно запущен 2026-08-25 на текущем локальном
checkout: `18/18` сценариев завершились с `assertionsPassed: true` за `6.931 s`.
Он подтвердил `5×401 + 1×429` для wrong-password, `30×200 + 1×429` для общего
NAT, `5×201 + 1×429` и `20×201 + 1×429` для двух Feedback boundaries,
`20×404 + 1×429` для Room, `60×200 + 1×429` для Tender, `10×201 + 1×429` для
realtime tickets, `100×401` invalid tickets одновременно с `20×200` readiness,
cross-pool Tender version `1`, process-local cap `10` и close code `4429` для
одиннадцатого socket. Fake SMTP принял `60`, оставил одну запись в очереди и
создал один protection alert; email/Recovery Code password reset отозвали прежние
sessions и одноразовые credentials. Cleanup временного Compose project и volume
подтверждён до публикации итогового JSON.

Локальный Argon2id sample текущего запуска: new-hash p50 `40.65 ms`, wrong verify
p50 `39.90 ms`, unknown-account fallback p50 `39.56 ms`, opportunistic rehash
`60.85 ms`. Эти три повтора и sampled process RSS не являются production
capacity/SLO. Основные таблицы ниже сохраняют исторический baseline 2026-08-24,
чтобы не смешивать измерения разных checkout и окружений.

## Зафиксированные пределы

Контрактные defaults не менялись:

| Контур | Ключ | Fixed window / предел | Проверенная граница |
| --- | --- | ---: | --- |
| Неуспешный login | normalized login | 5 / 15 min | `5×401 + 1×429`, `Retry-After: 60` |
| Login через общий NAT | trusted client IP | 30 / 15 min | `30×200 + 1×429`, boundary `Retry-After: 900` |
| Authenticated mutation | user | 120 / 60 s | `120×204 + 1×429`; GET остаются доступны |
| Room join | user | 20 / 60 s | `20×404 + 1×429`, `Retry-After: 60` |
| Tender command | user + Tender | 60 / 60 s | `60×200 + 1×429`, `Retry-After: 60` |
| Realtime ticket | user | 10 / 60 s | `10×201/upgrade + 1×429`, `Retry-After: 60` |
| SMTP admission | global для workers | 60 / 60 s | 60 accepted, 1 queued, 60 attempts, 1 transition alert |

Это fixed-window counters. Вблизи смены окна допустим burst почти в два
предела; приведённые числа нельзя интерпретировать как sliding-window rate.
Порог исчерпанного PostgreSQL bucket остаётся capped на `limit + 1`, но каждый
отклонённый запрос всё ещё берёт advisory lock и обновляет hot row.

## Локальные latency/throughput measurements

Все latency в миллисекундах; throughput — фактически завершённые операции в
секунду на указанной локальной машине.

| Сценарий | Batch / результат | p50 | p95 | p99 | Throughput |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6 concurrent wrong-password login | 98.60; `5×401 + 1×429` | 88.43 | 98.47 | 98.47 | 60.85 req/s |
| 30 concurrent valid Argon2id login, один IP | 324.53; `30×200` | 284.52 | 322.42 | 324.38 | 92.44 req/s |
| 21 concurrent Room join | 45.76; `20×404 + 1×429` | 32.29 | 45.37 | 45.61 | 458.96 req/s |
| 61 concurrent idempotent Tender command | 190.62; `60×200 + 1×429` | 149.17 | 187.00 | 190.34 | 320.01 req/s |
| 10 ticket issue | — | 10.00 | 24.81 | 24.81 | — |
| 10 WebSocket greeting | — | 4.62 | 8.49 | 8.49 | — |
| 100 concurrent invalid WS handshake | 21.35; `100×401` | 13.76 | 19.65 | 19.79 | 4683.57 req/s |

Тридцать первый NAT-login был отклонён за 3.14 ms; одиннадцатый realtime
ticket — за 6.14 ms. Transactional mail поставил 61 запись в outbox за 78.09 ms
(781.12 enqueue/s), а два worker identity совместно приняли ровно 60 fake SMTP
deliveries за 291.10 ms (206.11 admission/s). Эти throughput values измеряют
нулевую provider latency и потому не прогнозируют реальный SMTP drain rate.

Команда через API-B обновила socket на API-A через PostgreSQL sync за 434.18 ms.
После закрытия соединения новый ticket был выдан другим listener, а reconnect
на соседний listener получил authoritative Tender version `1` за 8.49 ms.

На историческом, выполненном до введения process-local cap, ramp из 50 idle
sockets:

- все 50 получили greeting; p50 25.99 ms, p95 26.64 ms;
- за 3.202 s выполнено 150 `readTenderView`, или 46.84 read/s;
- все 20 последовательных readiness probes вернули `200`, p95 5.26 ms;
- процесс использовал 209.29 ms CPU за окно; открытие sockets увеличило
  process RSS на 851,968 bytes после forced GC, но абсолютный RSS общей Bun/
  Prisma нагрузки нестабилен и не является per-socket memory estimate.

Измерение подтвердило примерно один authorized PostgreSQL view-read на активный
socket в секунду, но baseline 50 sockets больше не описывает достижимое состояние
одного игрока: текущий process-local cap равен 10. Versioned runner проверяет
bounded стоимость `10 reads/sync` для одного игрока; aggregate стоимость по
разным игрокам остаётся линейной и не разрешает объявлять production capacity.

Одновременно со 100 invalid handshakes все 20 readiness probes остались `200`
(p95 19.86 ms), а application ticket-budget rows не изменились. Это доказывает
устойчивость только указанного локального burst. Invalid upgrade не имеет
application budget и остаётся обязанностью edge/SWS до production scale;
измеренные 4683 req/s не являются безопасным разрешённым порогом.

## Подтверждённые дефекты и owning fixes

1. **Concurrent Tender replay возвращал `500`.** При unique `commandId`
   PostgreSQL помечал transaction aborted, после чего `findUnique` внутри той же
   transaction падал с `25P02`. Сеть воспроизвела `51×200 + 9×500 + 1×429`.
   Store теперь использует `INSERT ... ON CONFLICT DO NOTHING` через Prisma
   `createMany({ skipDuplicates: true })`, затем читает persisted receipt в
   здоровой transaction. Отдельный тест с двумя pools и 20 concurrent replay
   подтверждает один command, audit event, version и 20 одинаковых receipt.
   Исторически defect предшествовал distributed-budget change; нагрузка его
   обнаружила, но сам budget его не создавал.
2. **Общий budget загрязнял более узкие квоты.** Room и ticket middleware
   списывали specific bucket до generic rejection. Порядок теперь
   `requireAuth → authenticated mutation → specific budget`; low-limit HTTP test
   подтверждает `429` от generic layer и ноль Room/ticket rows. Tender уже имел
   правильный порядок.
3. **Policy-blocked mail занимал SMTP slot без send.** Claim резервировал
   capacity до policy evaluation, а release снимал только lease. Claim теперь
   переносит identity fixed window; blocked release под общим control lock
   возвращает capacity только тому же окну. Тесты отдельно подтверждают, что
   разрешённый recovery mail проходит при `1/min`, а поздний release старого
   окна не уменьшает новый counter.
4. **Reconnect конфликтовал с ticket budget.** Две вкладки при fixed 5 s retry
   делали 24 ticket request в первые 60 s, а HTTP client терял `Retry-After`.
   Клиент сохраняет delay-seconds header и использует backoff 5/10/20/30 s с
   cap 30 s, reset после WebSocket open и server delay как minimum. Две вкладки
   теперь планируют 8 запросов: `0, 0, 5, 5, 15, 15, 35, 35 s`, то есть ниже
   общего user budget 10/min; `Retry-After: 60` даёт паузу 60 s.
5. **Поздно добавленный tutorial PUT обходил общий mutation contract.** При
   override `2/min` третий `PUT /api/profile/tutorial/completion` возвращал
   `200`. Profile routes теперь используют тот же existing middleware; третий
   PUT возвращает `429`, а `GET /api/profile/tutorial` остаётся `200`.

Ни один runtime threshold, HMAC identity, auth failure response, authorization
rule, database schema или provider setting не менялся.

## Security и differential review

| Actor / boundary | Проверенный риск | Результат |
| --- | --- | --- |
| Неаутентифицированный attacker → auth | Argon2id amplification, login enumeration, shared IP | PostgreSQL login/IP boundaries атомарны; response contract не раскрывает account existence |
| Authenticated attacker → player writes | обход общего/specific budget, hot key | generic и specific budgets распределены; GET не списываются; hot-row DB work остаётся residual |
| Tender participant → command | replay/race и `500`; чужой Tender | replay исправлен; existing participant authorization и одинаковые concealed failures сохранены |
| Несколько browser tabs → ticket endpoint | self-DoS и reconnect storm | 24/min воспроизведены; после backoff две tabs дают 8/min и учитывают `Retry-After` |
| Два API hub → shared PostgreSQL | missed event/stale reconnect | API-B→socket-A и reconnect snapshot подтверждены; eventual latency 434.18 ms |
| Два mail worker → global control row | double claim, false budget exhaustion, wrong-window refund | 60/60 admission, 1 queued, 1 alert; blocked и rollover tests зелёные |
| Invalid WS client → upgrade DB lookup | DB exhaustion без application counter | 100-way burst выдержан локально; edge control всё ещё обязателен |

History-pass сравнил budget commits, поздние profile/reconnect changes и Tender/
mail owning stores. Blast radius включал auth middleware ordering, profile,
Room, Tender, mail claim/release, HTTP errors и realtime session. Neighbor
variants: generic exhaustion перед Room/Tender/ticket, GET после exhaustion,
same-command replay с другим fingerprint, mail rollover, одна/две tabs,
межинстансный update и invalid ticket churn.

Независимое опровержение подтвердило:

- raw login/email не появляются в HMAC buckets или security events;
- generic rejection не расходует Room/Ticket specific budgets;
- одноразовый ticket работает между pools и не переиспользуется;
- blocked mail не открывает lease или SMTP bypass и не возвращает capacity в
  чужое окно;
- повтор команды с изменённым fingerprint остаётся conflict, а не replay;
- health и authenticated GET остаются доступны при измеренных bursts.

После fixes конкретных открытых P0–P2 findings в проверенном срезе нет. Active
DAST: NOT RUN — production attack запрещён, а локальный driver уже активировал
релевантные abuse boundaries без добавления ZAP surface scan.

## Validation

- Versioned `bun run benchmark:local-abuse`: PASS, `18/18`, secret-free JSON
  опубликован только после `ephemeral_cleanup_confirmed`.
- Production-like two-listener driver: PASS два раза после fixes, без `5xx` и
  timeout; финальные числа приведены выше.
- Full backend PostgreSQL integration: PASS, 153 tests, 1447 assertions.
- Mail outbox integration: PASS, 20/20, включая workers, lease, circuit,
  blocked capacity и rollover.
- Web reconnect/API targeted: PASS, 25/25; web typecheck и targeted ESLint PASS.
- Targeted Tender two-pool replay: PASS, 20 identical receipts in 27.91 ms в
  полном integration run.
- `bun run check:commit`: PASS; 243 backend unit и 199 web tests, остальные
  commit-gate suites также без failures.
- Первый `bun run check`: secrets, lint, Prisma format/validate/generate,
  TypeScript, architecture, unit/integration suites, production builds и Docker
  smoke — PASS; финальный Playwright дал 44/45 из-за stale exact-copy assertion
  в `webapp/e2e/specs/auth.spec.ts:307`. Продуктовый legal copy не менялся:
  assertion выровнен только по сохраняемой семантической фразе
  `история матчей останется только в обезличенном виде.`. Targeted deletion E2E
  после исправления — 1/1 PASS; повторный полный Playwright — 45/45 PASS за
  2.5 min.
- Dependency audit: PASS, vulnerabilities не обнаружены.
- Gitleaks: PASS, 428 commits / 7.78 MB, leaks не обнаружены.
- Semgrep: PASS, 5 rules / 372 files, findings не обнаружены.
- Trivy config: PASS, Dockerfile misconfigurations не обнаружены.
- Trivy image: PASS для exact smoke image
  `sha256:d328919ac3d89414d81ac5c984365fffc056951fa79fefcf87fa9823583baa24`;
  Alpine 3.22.4 и Node package targets — 0 HIGH/CRITICAL findings.

## Открытые пределы и production gates

- Не проверены ALB trusted-client-IP propagation, Smart Web Security, TLS/
  idle timeout, Managed PostgreSQL pool/lock waits, отдельные OS processes,
  production CPU/RSS, mobile network switching и provider SMTP latency.
- Feedback не входил в исторический запуск 2026-08-24. Versioned rerun
  2026-08-25 подтвердил account/IP boundaries и локальные p95 `32.18 ms` /
  `70.20 ms`; это не production capacity и не разрешение менять defaults.
- Reconnect evidence ограничено двумя tabs и continuous ticket failure:
  массовый синхронный reconnect, manual retry и rapid WebSocket
  open→immediate-close отдельно не нагружались; jitter пока отсутствует.
- Mail подтверждён отдельно для двух concurrent workers и для blocked→allowed
  refund, но их совмещённая гонка не моделировалась. Возможный краткий ложный
  `budget_exhausted` transition до следующего drain остаётся гипотезой, не
  основанием для дополнительного исправления.
- Tender concurrent replay измерял одинаковый fingerprint. Different-fingerprint
  conflict и rollback/version-conflict сохраняют существующие contract/
  transaction проверки, но не запускались в том же 20-way сценарии.
- PostgreSQL realtime polling даёт eventual cross-instance recovery, но его
  стоимость линейна по sockets. Горизонтальный production scale требует
  отдельного capacity test и перехода на grouped/brokered fanout, а не
  экстраполяции результата 50 sockets.
- Invalid/missing/used WebSocket ticket churn требует edge rule и метрик; новый
  application limiter без production evidence не добавлялся.
- Отсутствуют product metrics API latency, reconnect, auth throttle и mail
  protection transitions; поэтому production tuning defaults не разрешён.
- HMAC namespace rollout остаётся stop-all-old → wait 60 s → start-new; mixed
  revisions временно удвоят allowance и не проверялись локальным harness.

Push, deploy, production mutation, threshold tuning и dependency additions не
выполнялись.
