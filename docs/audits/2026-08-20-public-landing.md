# Аудит публичного лендинга и перехода в обучение

Дата: 2026-08-20  
Срез: production HTML `website`, SEO/crawler contract, ограниченное намерение
`continue=tutorial` в `webapp`.

## Критерии приёмки

1. Статический initial HTML содержит утверждённый лендинг, три актуальных
   игровых скриншота, FAQ, повторный CTA и юридический footer.
2. Canonical, Open Graph, social image, JSON-LD, `robots.txt` и `sitemap.xml`
   содержат только проверяемые публичные факты и не индексируют player app.
3. `continue=tutorial` переживает регистрацию и приводит в `/tutorial`, а любое
   другое значение не влияет на навигацию.
4. Рендеры 1440×900, 1024×768 и 390×844 не имеют горизонтального overflow,
   сломанных изображений и ошибок консоли.

## Повторная acceptance-проверка 2026-08-23

`UX pilot extension: RUN — public landing`; формальная попытка пилота player
webapp — `N/A`, потому что flow принадлежит статическому `website`.

`CUJ-LANDING-01`: русскоязычный MVP Initiator открывает production build корня
без сессии, понимает обещание и ограничения продукта, видит доминирующий CTA
«Пройти обучение» и получает bounded-ссылку
`https://app.anomaly-detector.ru/?continue=tutorial`. Проверяются initial HTML,
crawler/social/structured metadata, ready и analytics-unavailable состояния,
keyboard focus, три целевых viewport и лабораторные Web Vitals. Server-accepted
state, дедлайн, conflict и competitive privacy — `N/A`: лендинг не отправляет
игровую команду и не получает приватных игровых данных.

Browser-safety boundary: новый изолированный Chromium context; analytics API
подменён только локальными ответами без cookie, логина, персональных и игровых
данных. В screenshots и runtime report нет secrets.

| ID | Шаг / критерий | Baseline | Final evidence |
| --- | --- | --- | --- |
| `UXC-LANDING-01` | Production initial HTML и bounded CTA | `PASS` | artifact build test, три реальные PNG, FAQ/repeated CTA/legal footer |
| `UXC-LANDING-02` | Canonical, полный social metadata и реальный image asset | `FAIL` | `PASS`: Open Graph/Twitter image, type, 1440×900, одинаковый alt; локальный preview просмотрен |
| `UXC-LANDING-03` | JSON-LD повторяет видимый и текущий FAQ | `FAIL` | `PASS`: recovery claim соответствует активной почте восстановления/Recovery Code и provider boundary |
| `UXC-LANDING-04` | robots/sitemap индексируют только public root | `PASS` | оба HTTP `200`; sitemap содержит ровно `https://anomaly-detector.ru/` |
| `UXC-LANDING-05` | Три viewport без overflow/assets/runtime errors | `PASS` | итоговая runtime-таблица ниже |
| `UXC-LANDING-06` | Keyboard focus и automated accessibility | `FAIL` | `PASS`: privacy link имеет 3 px focus; axe — 0 violations |
| `UXC-LANDING-07` | Русская публичная терминология | `FAIL` | `PASS`: `landing` заменён на «публичный лендинг» |
| `UXC-LANDING-08` | Lab LCP/INP/CLS | `NOT RUN` | `PASS` локально; field p75 отдельно не заявляется |

Подтверждённые находки: `UXF-LANDING-01` — stale recovery claim;
`UXF-LANDING-02` — отсутствовал `og:image:alt`; `UXF-LANDING-03` — privacy
link имел только browser-default focus; `UXF-LANDING-04` — англицизм в consent
copy. Исправлены `4 / 4`; композиция, визуальный restyle и игровой flow не
менялись.

## Итоговые сигналы

- Initial HTML/SEO: `PASS` — 5 artifact-тестов, 56 assertions; ровно три
  настоящих PNG, текущий видимый FAQ совпадает с `FAQPage`, `VideoGame` и
  `WebApplication` разбираются как JSON. Тяжёлого video, `autoplay` и
  scroll-reveal нет.
- Social preview: `PASS` локально — реальный PNG 1440×900, canonical, Open
  Graph и Twitter title/description/image/alt согласованы. Text alternative
  следует рекомендации [Open Graph protocol](https://ogp.me/). Внешние cache
  debugger/production preview — `NOT RUN`: deploy не выполнялся.
- robots/sitemap: `PASS` — HTTP `200`, все заявленные crawler blocks читаются,
  sitemap содержит один public root; player app/API/operator отсутствуют.
- Analytics-unavailable: `PASS` — при локальном `503` виден текст «Выбор можно
  сделать позже. Игра работает без аналитики», CTA остаётся рабочим. Два
  ожидаемых browser resource errors `503` зафиксированы только в этом
  специально смоделированном failure state; unhandled/page errors нет.
- Ранее доказанный CTA/auth contract не менялся: только literal `tutorial`
  переживает auth и ведёт в `/tutorial`; произвольные значения не становятся
  redirect. В этой повторной статической проверке auth E2E не перезапускался.

| Viewport | Overflow | Broken images | Console / page / request / HTTP errors | axe violations | Lab LCP | Lab INP | Lab CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1440×900 | 0 px | 0 | 0 / 0 / 0 / 0 | 0 | 124 ms | 16 ms | 0 |
| 1024×768 | 0 px | 0 | 0 / 0 / 0 / 0 | 0 | 56 ms | 16 ms | 0 |
| 390×844 | 0 px | 0 | 0 / 0 / 0 / 0 | 0 | 56 ms | 32 ms | 0 |

Лабораторный runtime укладывается в published Core Web Vitals thresholds:
LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1
([web.dev](https://web.dev/articles/defining-core-web-vitals-thresholds)). Это
не заменяет production field p75: локальные и полевые данные имеют разные
границы ([Chrome Developers](https://developer.chrome.com/blog/devtools-realtime-cwv)).
Field CWV остаётся release evidence после появления production traffic.

axe оставил `color-contrast` как `incomplete` из-за градиентных/полупрозрачных
background. Literal color tokens дополнительно проверены на наиболее светлом
используемом dark-teal background: минимальное отношение для обычного текста
`5.25:1`; primary CTA — `8.83:1`. Keyboard-последовательность просмотрена на
трёх viewport, privacy link получает `3px solid` outline.

Rendered evidence хранится в
`.scratch/ux-pilot/public-landing-acceptance/final/`: viewport/full-page PNG для
1440×900, 1024×768, 390×844, локальный `social-preview.png`, mobile
`analytics-unavailable.png` и машинный `report.json`.

## Политика краулеров

Имена user-agent повторно сверены с официальными источниками 2026-08-23:

- OpenAI: `OAI-SearchBot`, `GPTBot`, `ChatGPT-User` —
  <https://help.openai.com/en/articles/12627856-publishers-and-developers-faq>;
- Anthropic: `ClaudeBot`, `Claude-User`, `Claude-SearchBot` —
  <https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>;
- Perplexity: `PerplexityBot`, `Perplexity-User` —
  <https://docs.perplexity.ai/docs/resources/perplexity-crawlers>;
- Google: `Googlebot` —
  <https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers>;
- Yandex: `Yandex` —
  <https://www.yandex.com/support/webmaster/en/robot-workings/user-agent>.

Разрешение относится только к публичному hostname. Player app, API и operator
surface отсутствуют в sitemap и не получают разрешение через этот файл.

## Threat review

Защищаемые инварианты: anonymous HTML не меняет auth/permissions, не раскрывает
существование аккаунта или recovery credential; публичный recovery claim
соответствует реализованному owner-only flow; social asset не содержит private
player data; CTA может выбрать только маршрут обучения.

| Актор | Доступ через landing | Control / результат |
| --- | --- | --- |
| Анонимный пользователь / crawler | Читает static HTML, JSON-LD, robots/sitemap и public PNG | Нет серверной мутации или private identifier; CTA передаёт только `continue=tutorial` |
| Владелец password-аккаунта | Видит claim об активной почте восстановления или сохранённом резервном коде | Реальный recovery принимает login и даёт одинаковый внешний ответ без enumeration; этот diff flow не меняет |
| Владелец Яндекс ID | Видит provider boundary | Вход и восстановление остаются на стороне Яндекса |
| Другой игрок / operator | Не получает нового entry point | Чужие recovery credentials и административный takeover по-прежнему недоступны |

Replay, race, duplicate delivery, transaction и rollback — `N/A`: diff меняет
только static copy/metadata/CSS и не пишет серверные данные. Underlying recovery
controls доказаны собственными integration/E2E gates и не ослаблялись.
Изменение analytics copy не меняет payload, retention, consent state machine
или transport. DAST — `NOT RUN`: новый API surface отсутствует. Подтверждённых
уязвимостей нет.

## Security-agent pilot

`Security-agent pilot: RUN` завершён решением `ADOPT`. Обычный review нашёл один
существовавший recovery-claim drift. History/blast-radius/variant pass до commit
нашёл ещё два недублирующих дефекта предлагаемого diff: неучтённую activation
почты/provider wording и неверный термин «научная модель» в social alt. Оба
исправлены. Три гипотезы — расширение analytics privacy scope, enumeration через
email и disclosure через screenshot — отвергнуты фактическими controls.

Метрики: accepted findings / candidates `3 / 6`, additive signal `2 / 5`;
добавлены artifact regression guards. Дополнительное время отдельно не
измерялось. Новых dependencies, MCP, permissions, hosted workflows, внешних
scanners и передачи private repository content не было. Snyk Agent Scan,
Promptfoo, Garak и agent harness — `NOT RUN`, не применимы к статическому
runtime без LLM.

## UX pilot

- UX contract: `CUJ-LANDING-01`, критерии `UXC-LANDING-01..08` выше.
- Rendered evidence: все три viewport, full-page, social card и failure state
  просмотрены человеком; blocking findings `0`, review-required findings
  `4 / 4` исправлены.
- Accessibility evidence: axe `0` violations, manual contrast/focus review
  `PASS`; automated incomplete раскрыт, а не скрыт.
- Метрики: ручные комментарии до первого handoff `0`, ручное время
  `NOT MEASURED`, review cycles `0`, high severity `0`, accepted findings `4 / 4`.
- Итог: `PASS`; field CWV и external social cache остаются отдельными release
  signals, а не ложным локальным доказательством.

## Audit checklist

- Product/public website: REQUIRED, `PASS`.
- Initial HTML/SEO/crawler/structured/social: REQUIRED, `PASS` локально.
- UI/responsive/rendered quality: REQUIRED, `PASS` по трём размерам.
- Accessibility: REQUIRED, `PASS` с раскрытым axe incomplete и manual resolution.
- Auth/security/privacy: REQUIRED, `PASS`; auth behavior не менялся,
  подтверждённых уязвимостей нет.
- Analytics consent/refusal/unavailable: REQUIRED, `PASS` для затронутой public
  panel; server analytics contract не менялся.
- Architecture/shared API/persistence/migrations/concurrency: `N/A`.
- DAST и external social validators: `NOT RUN`; новый API/deploy отсутствуют.
- Production field CWV/domain migration: `BLOCKED` до production traffic и
  отдельного release. DNS, TLS, CORS, cookies и OAuth redirect URI не менялись.
