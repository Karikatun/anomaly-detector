# Аудит подготовки публичного и игрового доменов

Дата: 2026-08-21
Этап: implementation и подготовка релиза, без production-изменений.
Срез: issue #30, ветка `codex/public-player-domain-release`; Caddy, runtime/auth,
публичный `website`, player `webapp`, Playwright и release runbook.

## Scope and protected invariant

Защищаемый инвариант: публичный корень показывает только индексируемый лендинг,
приватное приложение живёт на отдельном неиндексируемом host, а browser auth и
OAuth возвращают сессию только на явно настроенный player origin.

Точки входа и trust boundaries:

- браузер или crawler → `anomaly-detector.ru` → статический `website`;
- браузер игрока → `app.anomaly-detector.ru` → статический `webapp` → API;
- Yandex OAuth → callback на `api.anomaly-detector.ru` → redirect в player app;
- operator browser → защищённый `ops.anomaly-detector.ru` → allowlisted API;
- Caddy/runtime env и отдельные immutable static directories → serving layer.

Акторы: анонимный посетитель, crawler, аутентифицированный игрок, посторонний
аутентифицированный пользователь, оператор, OAuth-провайдер и атакующий,
способный подменить browser input, но не production env или TLS.

## Acceptance criteria

1. Корень раздаёт `website` без SPA fallback; неизвестный путь получает `404`.
2. Player host раздаёт `webapp` со SPA fallback и `X-Robots-Tag: noindex`.
3. Только фиксированные legacy route families переходят на фиксированный player
   host с сохранением path/query; `www` переходит на публичный корень.
4. Production runtime принимает один origin-only HTTPS `WEBAPP_ORIGIN`, который
   входит в CORS; OAuth отвергает остальные CORS-allowed origins.
5. Реальный путь проходит разные origins: лендинг → CTA → регистрация →
   `/tutorial`.
6. Runbook сохраняет current/target distinction, порядок cutover и совместный
   rollback Caddy/runtime без изменения PostgreSQL.

## STRIDE threat review

| Boundary | STRIDE | Concrete attacker action | Impact | Control and evidence |
| --- | --- | --- | --- | --- |
| OAuth start/callback → browser | Spoofing, tampering, elevation | Передать operator или иной CORS-allowed origin как `webappOrigin`, либо случайно поставить его первым в CORS | Сессия возвращается не в player surface; скомпрометированный разрешённый origin получает удобную точку для credentialed API access | `WEBAPP_ORIGIN` валидируется отдельно; browser input обязан точно ему равняться; operator-origin получает `403`; provider error возвращается в player app |
| Public host → static files | Information disclosure | Запросить приватный deep link на корне и получить player SPA из общего fallback | Индексация приватной оболочки и смешение публичной/игровой границы | Отдельный `ANOMALY_WEBSITE_ROOT`, отсутствие root fallback, отдельный app fallback и noindex; Caddy tests + `caddy validate` |
| Legacy URL → redirect | Tampering, spoofing | Подставить внешний redirect target или неизвестный путь | Phishing/open redirect либо превращение корня в общий proxy | Matcher содержит только фиксированные path families, destination host константный, `{uri}` сохраняет только path/query |
| Static release roots | Information disclosure | Смешать website, player и operator artifacts в одном каталоге | Публикация operator/private output | Три отдельных root env; adminapp остаётся за Basic Auth и backend UUID allowlist; runbook требует раздельные immutable directories |
| Coordinated cutover | Denial of service | Применить только CORS, Caddy, DNS или OAuth часть | Потеря регистрации, cookie refresh, OAuth return или deep links | Runbook запрещает частичную reload, задаёт staged cutover, проверки и совместный rollback; production-доказательство остаётся gate #31 |

## Actor and resource matrix

| Operation/resource | Anonymous or crawler | Authenticated player/outsider | Operator | Expected result |
| --- | --- | --- | --- | --- |
| Public website | Read | Read | Read | Только публичный HTML/assets; crawler может индексировать корень |
| Player routes | Login/register shell; private state только после auth | Только собственные разрешённые данные | Обычный player contract без operator-проекции | App host noindex; authorization остаётся backend-owned |
| Browser cookie auth | Public website origin не разрешён CORS | Player origin разрешён | Operator origin разрешён только для штатного operator client | Missing/untrusted `Origin` отклоняется в secure-cookie mode |
| OAuth return target | Не выбирает произвольный host | Только точный `WEBAPP_ORIGIN` | Operator origin не принимается как return target | Callback остаётся на API, финальный redirect — player app |
| Operations overview | `404` | `404` | Basic Auth + backend UUID allowlist | Изменением не ослаблено |

Participant/owner resource identifiers, Tender projections и IDOR-механика не
изменялись. Полный backend integration и E2E gate повторно подтвердил прежние
negative actor checks, но этот срез не заявляет новый аудит всей игровой модели.

## Concurrency and recovery

| Operation | Duplicate/parallel/replay | Recovery and persisted outcome |
| --- | --- | --- |
| Legacy redirect GET | Идемпотентен; query не становится host | Повтор даёт тот же фиксированный destination |
| OAuth transaction | Существующие PKCE/state, consume-before-exchange и replay guards не менялись | Origin хранится и на callback повторно сверяется с текущим `WEBAPP_ORIGIN` |
| Caddy reload | Partial config или неверный root может разорвать journey | До reload обязателен `caddy validate`; retained config/static artifacts составляют immediate rollback |
| Domain cutover | Параллельные старые вкладки могут попасть в переходное окно | Краткий контролируемый порядок, затем steady-state CORS; rollback восстанавливает Caddy и runtime env вместе |

Миграций и новых записей в БД нет. PostgreSQL rollback/restore drill для этого
diff не требуется; runbook отдельно запрещает затрагивать volume при откате.

## Findings

Подтверждённый pre-release trust-boundary defect устранён: OAuth fallback и
browser-supplied return origin раньше зависели от `CORS_ORIGINS[0]` и принимали
любой origin из общего CORS allowlist. Это не доказывало захват production-
аккаунта, но позволяло конфигурационной ошибке или компрометации другой
разрешённой browser surface стать post-login destination. Исправление находится
в owning runtime/auth boundary и покрыто отрицательным route test.

Новых подтверждённых security-уязвимостей в итоговом diff не найдено.

GitHub `security-static` обнаружил новый high-entropy fixture формата
production JWT в `backend/src/env.test.ts`. Исходник и история подтвердили,
что это статический тестовый placeholder, а не credential. Текущий fixture
заменён на явно низкоэнтропийный, а уже опубликованный historical finding
разрешён только одним immutable fingerprint в `.gitleaksignore`. Path-, rule- и
regex-allowlist не добавлялись, поэтому новые findings остаются видимыми.
Full-history Gitleaks добавлен в `check:push` перед поведенческим gate,
а точный порядок закреплён в `scripts/quality-gates.test.mjs`, чтобы новый
committed fixture не доходил до remote CI без той же локальной проверки.

## Rejected hypotheses and residual risk

- Open redirect: отвергнут фиксированным destination host и path matcher.
- Публикация operator SPA: отвергнута отдельным root, сохранёнными Basic Auth и
  backend allowlist; adminapp не копируется в public roots.
- Public root как credentialed API client: отвергнут target CORS и реальным E2E
  с разными origins.
- Полная production-готовность: не доказана. DNS, TLS, live Caddy headers,
  provider-side OAuth registration, cookie flow в production browser, логи,
  monitoring и rollback smoke выполняются только в owner-задаче #31.
- Public CSP допускает inline script для статического JSON-LD. Сейчас website не
  принимает request/user content; при появлении SSR, server islands или
  пользовательских данных CSP необходимо пересмотреть.
- Exact release image scan и production release не выполнялись. PR принимается
  только после зелёных `security-static`, `checks` и `e2e` на одном exact SHA;
  production image/digest остаётся release gate задачи #31.

## Validation

- Primary signal: PASS — isolated Playwright прошёл landing CTA на отдельном
  website origin, регистрацию и автоматический переход в `/tutorial`.
- Targeted auth/env: PASS — 23 теста; отсутствующий/невалидный player origin,
  operator-origin и OAuth error fallback покрыты.
- Serving configuration: PASS — 7 Caddy policy tests и `caddy validate` на
  локальном Caddy `v2.11.4`.
- Public HTML/crawlers: PASS — production website build tests проверяют CTA,
  canonical, robots и sitemap без app host.
- Full gate: PASS — единый `bun run check:push`, включая dependency audit,
  full-history Gitleaks, lint, typecheck, architecture, все tests/builds,
  Docker DB-backed smoke и 35/35 Playwright E2E.
- Static/security: PASS — Gitleaks после review одного exact historical
  test-fixture fingerprint проверил полную историю текущей ветки и не нашёл утечек;
  Semgrep 0 findings, Trivy config 0 misconfigurations.
- Active DAST: NOT RUN — ZAP не доказывает изменённую OAuth-origin границу;
  применены negative integration tests. Production DAST запрещён.

## Audit checklist

- Product/public journey: REQUIRED, PASS.
- Auth/permissions/privacy: REQUIRED, PASS; actor matrix и negative tests выше.
- Shared API contract: N/A — wire shape не менялся.
- Persistence/migrations: N/A — schema и persisted data не менялись.
- Replay/race/recovery: REQUIRED для OAuth/cutover, PASS локально; production
  rollback smoke BLOCKED задачей #31.
- Architecture boundary: REQUIRED, PASS.
- UI behavior: REQUIRED, PASS по user-visible E2E.
- Visual-only/responsive/UX pilot: N/A — композиция и стили экранов не менялись.
- Public website/SEO: REQUIRED, PASS для build/HTML; live production BLOCKED.
- Secrets/dependencies/source: REQUIRED, PASS локально.
- Docker/IaC: REQUIRED, PASS для config и smoke image; exact release-image scan
  BLOCKED до release SHA.
- Performance: N/A — hot path, bundle composition и query cost не менялись.
- Legal/support copy: N/A — текст и реквизиты не менялись.
- PR/CI: REQUIRED — merge gate требует green `security-static`, `checks` и `e2e`
  на одном exact SHA без bypass.
- Production/network: BLOCKED — DNS/TLS и production mutation не входят в PR;
  остаточный риск и следующий шаг — issue #31.
