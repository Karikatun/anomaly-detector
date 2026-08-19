# Аудит прототипа MVP-лендинга

## Scope

- Этап: design prototype.
- Решение: утверждён вариант A «Командный центр».
- Primary signal: выбранная композиция использует актуальные экраны реального
  игрового сценария и остаётся пригодной для production-реализации.
- Production behavior, CTA-интеграция, аналитика, DNS и deploy не меняются.

## Зафиксированное направление

- A — «Командный центр»: обещание и игровой экран сразу образуют tactical
  split-screen; ниже объясняется трёхшаговый цикл исследования.
- Варианты B/C и переключатель удалены после утверждения.
- Свежие кадры сняты из полного E2E-матча двух синтетических игроков на
  состояниях «Разведка», «Лаборатория» и «Тендер завершён».

## Проверки

| Проверка | Статус | Доказательство |
| --- | --- | --- |
| Website typecheck | PASS | `bun run --cwd website typecheck` — 0 diagnostics. |
| Production build | PASS | Обычный `astro build` не содержит prototype variants, switcher или screenshot assets. |
| Prototype build | PASS | `astro build --mode prototype`; три актуальных изображения собраны как fingerprinted assets. |
| Screenshot provenance | PASS | `rooms-and-tender.spec.ts` прошёл 1/1 на изолированной PostgreSQL; снимки 1440×900 получены во время реального сценария. Временные точки захвата удалены из теста. |
| Responsive render | PASS | Утверждённый A проверен на `1440×900` и `390×844`: CTA виден, horizontal overflow отсутствует. |
| Assets and console | PASS | 3/3 изображений загружены с `naturalWidth=1440`; console errors/warnings отсутствуют. |
| Prototype cleanup | PASS | Один вариант, один `h1`, переключатель и варианты B/C отсутствуют. |
| Accessibility smoke | PASS | Один `h1`, подписанные navigation/buttons, содержательные `alt`, видимый focus contract; полный WCAG-аудит остаётся для production-варианта. |
| Active DAST | NOT RUN | Статический локальный прототип без backend и мутаций. |

## Остаточный риск и следующий gate

Прототип намеренно не реализует production CTA, полный лендинг, SEO-схемы,
analytics consent или error states. Следующий gate — переписать утверждённую
композицию как production implementation с полным содержанием, тестами и
rendered review.
