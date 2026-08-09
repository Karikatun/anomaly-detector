# Anomaly Detector: аудит UI foundation

Статус: baseline-инвентаризация от 9 августа 2026 года. Код ещё не
нормализован.

Документ фиксирует фактическое состояние визуального foundation и целевое
направление постепенной нормализации. Это не новая дизайн-система и не
разрешение на redesign. Нормативные продуктовые правила находятся в
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), порядок пользовательских исправлений — в
[UI_IMPROVEMENT_PLAN.md](UI_IMPROVEMENT_PLAN.md), проверка результата — в
[UX_CHECKLIST.md](UX_CHECKLIST.md).

Фактическим runtime source of truth до завершения миграции остаются
`webapp/src/index.css`, `webapp/src/components/ui` и feature CSS modules. После
каждой волны нормализации этот документ нужно сверять с кодом, а выполненные
пункты отмечать ниже.

## Scope и метод

Проверены 26 CSS-файлов, общие UI primitives и React-композиции в
`webapp/src`. Инвентаризация охватывает colors, typography, размеры и веса
шрифта, line heights, spacing, gaps, padding, radius, borders, shadows,
opacity, z-index, motion и breakpoints, а также повторяющиеся component
patterns.

Подсчёты ниже относятся к CSS declarations. Tailwind utilities в TSX
проверялись отдельно, но не включены в количество уникальных raw-значений.

| Метрика | Текущий baseline |
|---|---:|
| CSS-файлы | 26 |
| Уникальные hex-цвета | 142 |
| Уникальные `rgb/rgba` | 407 |
| Уникальные локальные `font-size` | 69 |
| Уникальные значения `gap` и `padding` | 147 |
| Уникальные `border-radius` | 39 |
| Уникальные border patterns | 121 |
| Уникальные shadows | 36 |
| Уровни `z-index` | 10 |
| Варианты media query | 17 |
| Использования `!important` | 103 |

Эти числа — индикатор фрагментации, а не самостоятельная метрика качества.
Цель миграции — убрать случайные дубли, не уничтожив контекстные игровые
акценты и проверенные responsive-композиции.

## Инвентаризация foundation

| CURRENT PATTERN | WHERE USED | PROBLEM | RECOMMENDED NORMALIZATION |
|---|---|---|---|
| Семантические `--background`, `--card`, `--popover`, `--primary`, `--success`, `--warning`, `--destructive` | `index.css`, UI primitives | Хорошая основа применяется неравномерно | Считать существующие semantic roles основным цветовым API |
| `#010408`, `#02070c`, многочисленные `rgba(1–3, 7–20, 12–35, .7–.99)` | Auth, Rooms, Profile, Tender surfaces | Десятки визуально близких тёмных поверхностей | Свести к page background, surface/card, elevated/popover и input/subtle; прозрачность получать через `color-mix()` |
| Десятки почти белых и blue-gray значений | Заголовки, body, labels, metadata | Нет устойчивых уровней primary/secondary text | Использовать `foreground`, `card-foreground`, `muted-foreground`; tertiary/disabled получать семантически |
| `--primary` плюс множество cyan/blue literals | CTA, links, focus, selected | Один action-смысл имеет несколько оттенков | Общие действия — `--primary`; alpha через `color-mix()`; signal accent не смешивать с action primary |
| Несколько green/amber/red семейств | Ready, correct, warning, error | Status colors расходятся между features | Общие статусы переводить на `success`, `warning`, `destructive` |
| `--signal-accent`, `--slot-accent`, `--contract-accent`, `--audit-accent`, `--player-accent` | Tender и completed audit | Контекстные цвета могут выглядеть как дубли, но кодируют игровые сущности | Сохранить scoped custom properties; не превращать каждый цвет сущности в global token |
| Figtree Variable и локальный monospace | Весь UI, timer, room code | Основа едина, но font-family местами задаётся повторно | Figtree — единственный UI font; monospace только для ID, code, timer и tabular data |
| `Typography` variants `h1–h6`, `body`, `bodySm`, `caption`, `control`, `timer` | `components/ui/typography.tsx` | Каноническая шкала обходится 69 локальными размерами | Использовать `Typography`; raw size оставлять wordmark, крупным данным и уникальной игровой графике |
| Частые `.58`, `.62`, `.68`, `.72`, `.78`, `.82rem` | Gameplay metadata и audit | Micro-sizes дрейфуют, содержательный текст местами слишком мал | Содержательный минимум — `caption`/12px; меньшие размеры только необязательным техническим markers |
| Weights `400`, `500`, `600`, а также `520`, `620`, `650`, `700` | Typography, Profile, Lobby | Variable font создаёт псевдоуникальные веса | Основная шкала: 400, 500, 600; 700 только редкому strong numeric/accent |
| Line heights `1–1.65` с множеством `1.1–1.3` | Все features | Близкие значения не несут отдельной роли | Controls/numbers `1`; compact heading `1.2–1.25`; body `1.5`; long copy `1.65–1.75` |
| Частые spacing `.45`, `.55`, `.65`, `.75`, `1rem` | Dense game surfaces | Естественная шкала видна, но дрейфует на 1–2px | Свести к шкале 4, 8, 10, 12, 16, 20, 24, 32px |
| Responsive `clamp()` padding | Shell, Profile, Home | Полезный page pattern используется и для локальных блоков | Оставить `clamp()` page gutters и hero; component internals держать на spacing scale |
| Radius `.55–.75rem`, `7–10px`, `16px`, `999px` | Cards, controls, badges | 39 значений без сопоставимых визуальных ролей | Свести к 6, 8, 10, 16px и full |
| Множество 1px blue-gray borders | Все surfaces | 121 комбинация в основном отличается alpha | Три роли: subtle divider, default surface, strong/interactive |
| 2px border и ring | Focus и selected | Focus и выбор местами выглядят одинаково | Focus — внешний ring; selected — accent border плюс label/icon |
| Inset highlight, selected glow, sticky shadow, modal elevation | Cards, selected states, sticky/footer, dialogs | 36 shadows и чрезмерное использование glow | Оставить четыре роли: inset hairline, selected ring, sticky separator, overlay elevation |
| Opacity `.18`, `.42–.6` | Decoration, disabled, empty slots | Состояние и декор смешаны | Disabled около `.5–.6`; decoration отдельно; не ослаблять весь содержательный контейнер без причины |
| `z-index -1, 0, 1, 2, 10, 20, 50, 60, 101, 102` | Background, sticky, dialog, reconnect, tutorial | Структура существует, но не названа | Закрепить background, content, local-sticky, overlay, reconnect, tutorial layers |
| Durations `100ms`, `160ms`, `220ms`, `1.2–1.3s` | Dialog, controls, tutorial, pulse/skeleton | Почти готовая шкала; primitives используют `transition-all` | Целевая шкала 120/160/220ms; infinite только skeleton/status; перечислять properties |
| `ease`, `ease-in-out`, `cubic-bezier(.22,1,.36,1)` | Controls, ambient motion, tutorial | Небольшая естественная база | `ease` controls, emphasized curve overlays, `ease-in-out` только cycles |
| Breakpoints `370–1280px`, две главные границы `760/761` и `48rem` | CSS modules и Tailwind | Один mobile/desktop переход раздвоен между 760 и 768px | Основные 640, 768, 1024, 1280px; локальный breakpoint только при доказанном overflow |

## Повторяющиеся component patterns

| CURRENT PATTERN | WHERE USED | PROBLEM | RECOMMENDED NORMALIZATION |
|---|---|---|---|
| Базовый `Button` плюс `.submit`, `.startButton`, `.detailsButton`, `.backButton`, `.readyButton` | Auth, Rooms, Profile, Tender | Повторяются background, border, radius, hover; много `!important` | Добавить только доказанные semantic variants: tactical primary, quiet navigation, success action |
| Интерактивные menu cards как отдельные большие buttons | Home | Feature pattern имеет собственные typography и motion | Сохранить navigation card, но перевести foundation values на общие tokens |
| `Card` плюс `.panel`, `.surface`, `.profileCard`, `.history`, `.credentials` | Все features | Standard Card слишком просторный для tactical gameplay и обходится локально | Не делать super-card; оставить standard card и dense game surface на общих tokens |
| Одинаковые page titles | Home, Profile, History, Lobby | Повторяются цвет, condensed, weight 500, tracking и clamp | Выразить одним typography treatment или компактной `PageHeader` composition |
| Feature overrides для dialog title | Rooms, Auth, Profile | `DialogTitle` обходится через `!important` | Добавить semantic compact dialog heading treatment |
| `Badge` плюс ruleset, selected, audit и status chips | Header, History, Access Slot, Results | Разные padding, radius и font sizes | Общие status badges собирать на `Badge`; игровые chips выровнять по scale |
| Badge, glowing dot и plain label для одинаковых statuses | Tender, Lobby, History | Нет общей anatomy статуса | Icon/dot + label + semantic tone; glow не является единственным признаком |
| `Dialog` плюс три почти одинаковых Tender workspace layouts | Research, Contracts, Working Model | Дублируются viewport geometry, sticky offset, scroll body и close z-index | Добавить один gameplay workspace placement к существующему `Dialog` |
| Teal Join и purple Create room dialogs | Rooms | Одинаковый layout продублирован цветовой темой | Один layout плюс scoped room accent |
| Разные selected patterns | Access Slot, Signals, Laboratory, Contracts, Working Model | Glow, inset, badge и background используются непоследовательно | Общая anatomy: accent border + explicit marker; focus отдельно |
| Spinner containers, skeleton и pending copy | Session, Rooms, History, Profile, Tender | Reserved geometry и feedback различаются | Общая loading composition; skeleton только при известной будущей геометрии |

## Целевые шкалы

Шкалы извлечены из наиболее частых текущих значений. Они применяются при
постепенном рефакторинге, а не через механическую глобальную замену.

### Spacing

| Role | Value | Поглощает текущие значения |
|---|---:|---|
| `space-0` | `0` | `0` |
| `space-1` | `0.25rem` / 4px | `.2–.3rem` |
| `space-2` | `0.5rem` / 8px | `.4–.55rem` |
| `space-3` | `0.625rem` / 10px | `.6–.65rem` |
| `space-4` | `0.75rem` / 12px | `.7–.8rem` |
| `space-5` | `1rem` / 16px | `.85–1rem` |
| `space-6` | `1.25rem` / 20px | `1.1–1.25rem` |
| `space-7` | `1.5rem` / 24px | `1.4–1.5rem` |
| `space-8` | `2rem` / 32px | `1.75–2rem` |

### Radius

| Role | Value | Natural use |
|---|---:|---|
| `radius-none` | `0` | edge-to-edge mobile surface |
| `radius-sm` | `0.375rem` / 6px | compact control, chip |
| `radius-md` | `0.5rem` / 8px | button, input, dense card |
| `radius-lg` | `0.625rem` / 10px | panel, dialog, major card |
| `radius-xl` | `1rem` / 16px | elevated result/profile surface |
| `radius-full` | `9999px` | badge, dot, circular marker |

### Typography

| Role | Size / line height | Weight |
|---|---|---:|
| Caption / control-xs | 12px / normal или `1` для control | 400–500 |
| Body-sm / control | 14px / normal или `1` для control | 400–500 |
| Body | 16px / 28px | 400 |
| H6 | 16px / snug | 500 |
| H5 | 18px / snug | 500 |
| H4 | 20px / snug | 600 |
| H3 | 24px / snug | 600 |
| H2 | 30px / tight | 600 |
| H1 | 36px / tight | 600 |
| Timer | 20px / snug, monospace | 600 |

Допустимые исключения: wordmark, крупные итоговые цифры, slot number и
profile display name. Они не становятся общими typography tokens.

### Motion

| Role | Duration | Easing | Use |
|---|---:|---|---|
| Fast | `120ms` | `ease` | immediate feedback, overlay fade |
| Standard | `160ms` | `ease` | control, hover, selected state |
| Panel | `220ms` | `cubic-bezier(.22, 1, .36, 1)` | modal/panel entrance |
| Ambient | `1.2–1.3s` | `ease-in-out` | skeleton или critical status pulse |

Разрешённые animated properties: `transform`, `opacity`, `color`,
`background-color`, `border-color`, `box-shadow`. Не использовать
`transition: all` и не анимировать layout properties.

### Breakpoints и layers

Основные layout boundaries: `40rem` / 640px, `48rem` / 768px, `64rem` /
1024px и `80rem` / 1280px. `390×844` и `1440×900` остаются обязательными
validation viewports, но не отдельными layout tokens. Content-specific
breakpoint допустим только для устранения подтверждённого overflow или
нечитаемой композиции.

| Layer | z-index |
|---|---:|
| Background | `-1` / `0` |
| Content | `1` |
| Local overlay/sticky | `10` / `20` |
| Dialog/overlay | `50` |
| Reconnect/system blocker | `60` |
| Tutorial guidance | `100–102` |

## Правила миграции

1. Нормализовать по семантической роли, а не по совпадению чисел.
2. Не менять все literals одним механическим search/replace.
3. Сначала расширять существующий primitive semantic variant; локальный
   wrapper использовать, если composition уникальна.
4. Новый global token добавлять, только если роль повторяется минимум в трёх
   местах и не выражается существующим token.
5. Signal, slot, contract, audit и player accents оставлять scoped.
6. Не объединять focus, local selected, saved draft и server accepted.
7. После каждой волны запускать приложение и сравнивать populated desktop и
   mobile states; косметические детали не тестировать assertions по CSS.
8. Не объявлять значение устаревшим, пока все его потребители не
   проинвентаризированы и не проверены визуально.

## Порядок реализации foundation

- [ ] F-01. Нормализовать semantic colors поверхностей, текста и borders.
- [ ] F-02. Уточнить `Button`, `Badge` и `Dialog` variants и сократить
  feature-level `!important`.
- [ ] F-03. Перевести содержательную typography на существующие variants.
- [ ] F-04. Нормализовать spacing и radius в dense game surfaces.
- [ ] F-05. Унифицировать focus, selected, saved, accepted и status anatomy.
- [ ] F-06. Свести gameplay dialogs к одному workspace placement.
- [ ] F-07. Ограничить motion properties и закрепить reduced-motion behavior.
- [ ] F-08. Свести основные breakpoints и именовать z-index layers.
- [ ] F-09. Повторить инвентаризацию и обновить baseline counts.

## Definition of Done

- semantic role не имеет нескольких случайных raw-реализаций;
- новые feature styles используют утверждённые scales и primitives;
- исключения документированы рядом с уникальной продуктовой причиной;
- общие компоненты не требуют массовых `!important` overrides;
- desktop `1440×900`, desktop `1024×768` и mobile `390×844` визуально
  проверены на populated states;
- полный игровой flow остаётся рабочим, без layout shift и horizontal overflow;
- baseline counts пересчитаны, а этот документ и `DESIGN_SYSTEM.md` приведены в
  соответствие с фактическим кодом.
