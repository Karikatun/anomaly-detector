# Аудит прототипа MVP-лендинга

## Scope

- Этап: design prototype.
- Вопрос: какая информационная композиция лучше объясняет ценность Anomaly
  Detector и ведёт нового игрока в обучение?
- Primary signal: три структурно разных направления доступны на существующем
  маршруте `/` через `?variant=A|B|C` и пригодны для осознанного выбора.
- Production behavior, CTA-интеграция, аналитика, DNS и deploy не меняются.

## Варианты

- A — «Командный центр»: обещание и игровой экран сразу образуют tactical
  split-screen; ниже объясняется трёхшаговый цикл исследования.
- B — «Научное досье»: редакционная типографика, измеримые факты и крупное
  доказательство реальным экраном лаборатории.
- C — «Путь исследователя»: эмоциональный центрированный hero и явный переход
  от одиночного обучения к частному Тендеру с друзьями.

## Проверки

| Проверка | Статус | Доказательство |
| --- | --- | --- |
| Website typecheck | PASS | `bun run --cwd website typecheck` — 0 diagnostics. |
| Production build | PASS | Обычный `astro build` не содержит prototype variants или switcher. |
| Prototype build | PASS | `astro build --mode prototype`; реальные изображения собраны как fingerprinted assets. |
| Responsive render | PASS | A/B/C проверены на `1440×900`, `1024×768`, `390×844`: один видимый вариант, CTA виден, horizontal overflow отсутствует. |
| Assets and console | PASS | Во всей матрице 0 broken images; console errors отсутствуют. |
| Variant control | PASS | URL `?variant=` стабилен; клавиша `→` циклически переключает C → A. |
| Accessibility smoke | PASS | Один `h1`, подписанные navigation/buttons, содержательные `alt`, видимый focus contract; полный WCAG-аудит остаётся для production-варианта. |
| Active DAST | NOT RUN | Статический локальный прототип без backend и мутаций. |

## Остаточный риск и следующий gate

Прототип намеренно не реализует production CTA, полный лендинг, SEO-схемы,
analytics consent или error states. После выбора направления проигравшие
варианты и переключатель удаляются, а победившая композиция переписывается как
production implementation с полным содержанием, тестами и rendered review.
