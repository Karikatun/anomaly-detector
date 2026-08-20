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

## Результат

- Initial HTML: PASS — контент, ссылки, metadata и три изображения проверены
  тестом сборочного артефакта.
- CTA: PASS — Playwright с реальным backend и изолированной PostgreSQL проверил
  регистрацию из лендинга и открытие пролога `/tutorial`.
- Отрицательный auth-сценарий: PASS — `continue=admin`, произвольный URL и
  повреждённое значение из `sessionStorage` не становятся redirect.
- Визуальный рендер: PASS — 1440×900, 1024×768 и 390×844; `scrollWidth` равен
  `clientWidth`, все изображения имеют `naturalWidth=1440`, console warn/error
  отсутствуют. На mobile дополнительно просмотрены цикл, value cards,
  продуктовые экраны и начало пути к частному Тендеру.
- Core Web Vitals: BLOCKED — лабораторный или production Lighthouse замер не
  выполнялся; остаточный риск фиксируется до доменной миграции.

## Политика краулеров

Имена user-agent сверены с официальными источниками на дату аудита:

- OpenAI: `OAI-SearchBot`, `GPTBot`, `ChatGPT-User` —
  <https://developers.openai.com/api/docs/bots>;
- Anthropic: `ClaudeBot`, `Claude-User`, `Claude-SearchBot` —
  <https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>;
- Perplexity: `PerplexityBot`, `Perplexity-User` —
  <https://docs.perplexity.ai/docs/resources/perplexity-crawlers>;
- Google: `Googlebot` —
  <https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers>;
- Yandex: `Yandex` —
  <https://yandex.com/support/webmaster/en/robot-workings/user-agent>.

Разрешение относится только к публичному hostname. Player app, API и operator
surface отсутствуют в sitemap и не получают разрешение через этот файл.

## Threat review

Защищаемый инвариант: публичный CTA может выбрать только продуктовый маршрут
обучения и не меняет аутентификацию, сессии или backend-права.

| Актор | Может записать intent | Может изменить backend-состояние | Результат |
| --- | --- | --- | --- |
| Неаутентифицированный пользователь | Только `tutorial` в своём tab storage | Только через штатную регистрацию/вход | После успешной auth открывается `/tutorial` |
| Аутентифицированный игрок | Только `tutorial` | Нет новых прав | Внутренняя навигация в доступное обучение |
| Другой участник / оператор | Не может влиять на чужой tab storage | Без изменений | Изоляция не меняется |

STRIDE-проверка границы URL → browser storage → router:

- tampering/open redirect отклонён белым списком из одного literal;
- spoofing/elevation отсутствуют: intent не является credential или permission;
- disclosure отсутствует: в storage нет идентификатора, email, токена или URL;
- replay ограничен одним tab и однократным consume после auth;
- denial ограничен потерей необязательной навигации при очистке tab storage;
  регистрация и вход продолжают работать.

Гонки, duplicate delivery, backend transaction, аудит и rollback не применимы:
изменение не отправляет новую команду backend и не пишет серверные данные.
Активный DAST не запускался: срез не меняет API; граница доказана unit-тестом и
реальным auth E2E. Не доказан Yandex OAuth round-trip у внешнего провайдера;
сохранение intent до перехода и чтение после возврата покрыто тем же tab-scoped
контрактом, но production smoke остаётся обязательным после настройки redirect URI.

## Audit checklist

- Product/public website: REQUIRED, PASS.
- Architecture/feature boundary: REQUIRED, PASS; auth helper экспортирован через
  публичную границу feature.
- UI behavior and accessibility semantics: REQUIRED, PASS для ссылок, заголовков,
  landmark-навигации и FAQ; полный автоматизированный axe-аудит не запускался.
- Responsive/visual: REQUIRED, PASS по трём размерам.
- Auth/security/privacy: REQUIRED, PASS; подтверждённых уязвимостей нет.
- Shared API contracts, persistence, migrations, concurrency: N/A.
- Analytics consent/refusal: N/A — аналитика в этом срезе отсутствует.
- DAST: NOT RUN; остаточный риск описан выше.
- Production release/domain migration: BLOCKED отдельными пунктами 1–2 плана;
  DNS, TLS, CORS, cookies и OAuth redirect URI не менялись.
