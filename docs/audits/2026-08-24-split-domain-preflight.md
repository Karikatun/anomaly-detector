# Аудит воспроизводимого split-domain preflight

Дата: 2026-08-24
Этап: implementation/preflight, без DNS, push, deploy и production mutations.
Срез: Caddy target/rollback, release-build config, backend auth origins,
website legal links и isolated Chromium E2E.

## Scope and protected invariant

Защищаемый инвариант: `anomaly-detector.ru` раздаёт только публичный сайт,
известные старые игровые URL адресно переходят на
`app.anomaly-detector.ru`, а credentialed auth/OAuth/cookie остаются привязаны
к явно настроенному player origin и API host. Rollback возвращает player SPA
на корень совместно с прежними runtime origins, не меняя PostgreSQL.

Trust boundaries и акторы:

- посетитель/crawler → public root → статический `website`;
- игрок → app host → API host → HttpOnly refresh cookie;
- Yandex OAuth → API callback → точный `WEBAPP_ORIGIN`;
- operator → отдельный защищённый host/API allowlist;
- release owner → Caddy/runtime/static artifacts и coordinated rollback;
- атакующий origin → browser CORS/CSP и OAuth return validation.

## Confirmed gaps and owning fixes

1. `/feedback` был зарегистрирован в player router после первоначального
   split-domain commit, но не добавлен в `@legacyPlayerRoutes`. После cutover
   старый deep link возвращал бы public `404`. Маршрут добавлен в target Caddy.
2. Caddy test содержал второй ручной список и поэтому не поймал ни поздние
   recovery additions, ни `/feedback`. Теперь matcher сравнивается со всеми
   зарегистрированными non-root player routes; parameter routes переводятся в
   Caddy wildcard families.
3. Обычный Playwright использовал один `127.0.0.1` с разными портами,
   `COOKIE_SECURE=false`, disabled OAuth и прямые Vite/Astro servers. Он не мог
   доказать host-only cookie, target headers, OAuth callback origin или
   rollback. Отдельный profile строит static clients и запускает target и
   rollback на разных HTTPS `*.anomaly-detector.localhost` hosts с ephemeral
   TLS, реальной test PostgreSQL и Chromium.
4. Первый split runner наследовал общий Compose project, DB/port/URL escape
   hatches и писал в общие `dist`; параллельный gate действительно удалил его
   network. Теперь invocation/mode получают собственные Compose, динамические
   порты, static/result paths; non-test DB, Docker skip/keep, release sentinels
   и caller URL overrides удаляются. Docker daemon selectors также удаляются,
   active context обязан указывать на локальный Unix socket, и проверенный
   endpoint закрепляется за всем child run. Final build идёт в exact temp paths.
5. Edge surrogate изначально hard-code-ил redirect status/destination и неверно
   моделировал Caddy `permanent` как 308 вместо 301. Теперь он читает route,
   destination, explicit status и cache policy из versioned site blocks;
   standalone E2E падает при drift или неизвестном destination.
6. Permanent target root → app вместе с rollback app → root создавал cache-loop.
   Legacy redirect теперь `temporary` + `Cache-Control: no-store` до закрытия
   rollback window; ADR и owner checklist фиксируют отдельную позднюю promotion.
7. OAuth preflight покрывал только start/provider-error. Mock success transport
   теперь доказывает app/root return и secure host-only auth cookie. Callback со
   state предыдущего origin отклоняется до consume/exchange/session/account
   side effects. Пока origin отличается, игрок начинает новый OAuth flow;
   отклонённая transaction при этом не сжигается и остаётся пригодной только
   если matching origin будет восстановлен до её expiry.
8. `webapp build:release` проверял только legal fields, а website не имел
   fail-closed release build. Оба release commands теперь отвергают missing или
   alternate production origins; webapp также требует точный lowercase 40-char
   SHA и четыре непустых public legal values. Owner-gated analytics flags
   очищаются preflight и отвергаются обоими guards, включая values из
   `.env.production`; artifact scan покрывает configured IPv4/IPv6/zero/named
   loopback endpoints и документированное исключение для TanStack fallback.
9. Rollback существовал только как runbook prose. Добавлен versioned Caddy
   profile: root player SPA + noindex, unchanged API/operator boundaries и
   non-cacheable temporary app-to-root redirect с сохранением path/query.

Runtime CORS/OAuth/cookie/CSP и website link generation были проверены как
соседние варианты. Подтверждённых дефектов в их owning implementation не было,
поэтому production behavior не ослаблялся и не переписывался.

## Threat and actor review

| Boundary | Concrete failure/attacker action | Control and evidence |
| --- | --- | --- |
| Legacy root → app | Новый route выпадает или cached redirect ломает rollback | Route-derived exact matcher; temporary/no-store policy; target Chromium проверяет все concrete families, path/query/status/cache |
| Public/previous origin → auth API | Public target или оставшаяся app-вкладка после rollback делает credentialed auth request | Public target fetch и previous app rollback fetch блокируются CORS; текущий player fetch проходит; wildcard отсутствует |
| OAuth start/callback | Caller выбирает return host или old-origin callback оставляет side effects | Fixed API callback/current `WEBAPP_ORIGIN`; browser error return; mock app/root success; stale state rejected before service/repository |
| API cookie → browser hosts | Cookie получает parent `Domain` или root path | Browser response и cookie jar доказывают HttpOnly, Secure, SameSite=None, `Path=/api/auth`, отсутствие `Domain`; echo probes не видят cookie на root/app/API non-auth path |
| Static host → script/connect | Missing CSP или public SPA fallback смешивает surfaces | Edge fixture применяет versioned CSP; Chromium CSP violation probe; root unknown path `404`; app reload uses SPA fallback |
| Runner → local host | Ambient DB/Compose/Docker env или соседний gate меняет доказательство либо удаляет remote volume | Fresh `_test` DB, unique project/ports/output, stripped escape hatches, pinned local Unix-socket endpoint, exact teardown and temp cleanup |
| Rollback | Возвращается только Caddy/CORS или redirect-loop | Paired no-store target/rollback profiles + separate root auth/deep-link/OAuth/CORS E2E; coordinated runtime restore remains mandatory |

Participant/owner resources, persistence schema, auth token rotation and game
authorization не менялись. Новых IDOR или replay surfaces этот diff не
добавляет; обнаруженная OAuth cutover race закрыта до side effects. E2E
fail-closed использует только fresh `_test` database; каждый profile удаляет
лишь свой invocation-scoped Compose volume.

## Differential review and refutation

- History: первоначальный split-domain change, поздние recovery routes и
  поздний `/feedback` сравнивались отдельно; найден реальный route drift.
- Blast radius: player router, public links, Caddy target/rollback, backend env,
  auth transport, Playwright startup и release commands.
- Neighbor variants: `/recover/code`, `/recover/password`, parameterized Room и
  Tender routes, three legal routes, public analytics/API CSP.
- Open redirect отвергнут fixed destination origins и exact path families.
- Credentialed wildcard CORS отвергнут exact allowlists и browser probes.
- Parent-domain cookie отвергнут raw attributes, cookie jar and path/host echo.
- Missing CSP/legal URL отвергнут generated artifacts и enforced browser path.
- Cache-loop отвергнут парой temporary/no-store target/rollback redirects.
- Ambient analytics/DB/URL/release flags отвергнут merged-env guards и runner
  sanitization tests.
- Full production readiness не подтверждена: isolated edge интерпретирует
  versioned route/header policy, но не является Caddy parser и не проверяет
  public trust/DNS/provider control plane.

## Local evidence

- Primary signal: `bun run preflight:split-domain` — PASS.
- Targeted contracts: 97/97 PASS (Caddy, env, OAuth/CORS route, release config,
  website generated HTML/legal links).
- Named-host Chromium: target 3/3 PASS; rollback 2/2 PASS.
- Release artifact guards: webapp/website `build:release` PASS on explicit
  test fixtures; exact production origins/SHA/links present, configured local
  service endpoints absent. Известный TanStack literal `http://localhost` не
  является endpoint и проверяется отдельным exact exception.
- Secondary repository gate: lint, Prisma validation, all typechecks,
  architecture check, unit/integration suites, builds and backend Docker smoke
  PASS. Standard player Playwright: 44/45 PASS; the sole failure is an
  out-of-scope pre-existing exact-copy assertion expecting uppercase
  `История` where the current deletion dialog continues the sentence as
  `, а история`. Neither the spec nor that product copy was changed here.
- Active DAST: NOT RUN. Production DAST is prohibited; isolated ZAP would not
  add evidence for this host/origin configuration beyond the browser profile.
- Exact release image scan: NOT RUN; no release SHA/image was created.

Preflight builds conspicuous legal fixtures only in an isolated OS temporary
directory and removes it in `finally`; no shared `dist` becomes a release
artifact.

## Owner-only production gates

- choose and record the exact pushed release SHA; require clean/synchronized
  Git and green protected CI for that same SHA;
- provide legally approved operator name/recipient/address/effective date and
  verify the published support/legal channel;
- rebuild static artifacts with those values, record checksums, scan the exact
  backend image/digest and prove no test fixtures/configured local service
  endpoints; separately review the documented TanStack fallback literal;
- retain the active Caddy/runtime/static artifacts and checksums, validate both
  prepared files with the installed production Caddy, and keep the previous
  root-player set as the immediate rollback set;
- keep legacy redirects temporary/non-cacheable while rollback is open; close
  that window and promote to permanent, if still desired, only through a
  separate owner-approved Caddy validation;
- provision/verify public DNS and trusted TLS for root/app/api/www/ops without
  switching traffic early; verify live Caddy headers, `404`, redirects, roots,
  noindex and CDN/static checksums;
- set exact production `WEBAPP_ORIGIN`, `CORS_ORIGINS`, callback base and cookie
  settings; verify password register/login/refresh/logout and WebSocket
  reconnect in a real production browser;
- register the API callback at Yandex, then verify both real provider success
  and error returns with a controlled account. Local preflight does not exchange
  a real provider authorization code;
- keep analytics disabled; approval of its legal/product gates and any later
  release-guard change are outside this split-domain preflight;
- perform the coordinated rollback drill against retained artifacts, confirm
  API readiness and the unchanged production PostgreSQL volume identity, then
  return to target or remain rolled back by an explicit owner decision;
- record backup/restore evidence, live logs/monitoring and rollback triggers.

До закрытия этих пунктов код готов к owner preflight, но production release не
разрешён.
