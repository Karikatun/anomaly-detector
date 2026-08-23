# Пилот агентного UX-loop

## Итог

- **Статус:** `ADJUST`, пилот закрыт 23 августа 2026 года.
- **Плановый объём:** три подходящие UI/UX-задачи player webapp.
- **Фактический объём:** семь задач со статусом `UX pilot: RUN`.
- **Решение:** сохранить основной rendered loop как постоянную автоматическую
  практику `$anomaly-ui`, но прекратить pilot-классификацию, сбор pilot-метрик и
  обязательную церемонию в каждой задаче.

Результат именно `ADJUST`, а не `ADOPT`: процесс продолжил выполняться после
плановой третьей задачи, а таблица ручных замечаний, времени и циклов
согласования не поддерживалась. Поэтому заявленные количественные пороги
улучшения нельзя доказать. При этом сами task audit records последовательно
подтверждают полезность отрисованного прохода, responsive-проверки, keyboard/
focus и проверки ошибки и восстановления.

## Evidence семи запусков

1. [Yandex Account Email](../audits/2026-08-22-yandex-account-email.md#ux-pilot-and-rendered-inspection)
2. [Первый Recovery Email](../audits/2026-08-22-first-recovery-email.md#ux-pilot-and-rendered-inspection)
3. [Замена Recovery Email](../audits/2026-08-22-recovery-email-replacement.md#ux-pilot-and-rendered-inspection)
4. [Recovery Codes](../audits/2026-08-22-recovery-codes.md#ux-pilot-and-rendered-inspection)
5. [Password reset](../audits/2026-08-23-password-reset.md#ux-pilot-and-rendered-inspection)
6. [Feedback Report](../audits/2026-08-23-feedback-report.md#ux-pilot-and-rendered-inspection)
7. [Privacy-aware analytics](../audits/2026-08-23-privacy-aware-analytics.md#ux-pilot-and-rendered-inspection)

В запусках проверялись реальные отрисованные flows на desktop, mobile и, где
поверхность поддерживалась, `1024×768`, а также keyboard/focus и применимые
error/recovery states. Проход обнаружил, среди прочего, vertical overflow
Recovery Codes на `1024×768` и два blocking-дефекта analytics UI. Это
воспроизводимые task-level результаты, но не измерение общей экономии времени и
не usability-исследование с реальными игроками.

Одноразовый CUJ/evidence-эксперимент в privacy-aware analytics получил свой
локальный результат `ADOPT`: формальная матрица нашла два недублирующих дефекта,
оба были исправлены. Этот результат не делает матрицу обязательной для каждого
локального UI-изменения.

## Постоянный процесс после пилота

Для существенной UI/UX-задачи агент без напоминания пользователя:

1. использует `$anomaly-ui` и применимые пункты
   [UX Checklist](../UX_CHECKLIST.md);
2. фиксирует цель игрока, primary action, момент принятия действия и основной
   наблюдаемый сигнал;
3. проходит реальный rendered flow на desktop и mobile, а также на
   промежуточном viewport, если он относится к поверхности;
4. проверяет keyboard/focus, применимые error, waiting, retry и recovery states;
5. исправляет подтверждённый дефект в owning layer и повторяет тот же проход.

Формальный CUJ с устойчивыми `UXC-*`/`UXF-*` ID и evidence-матрицей применяется
только к новому или существенно перепроектированному критическому flow. Для
локального исправления или эволюции существующего flow достаточно обычного
UX-контракта, выбранных проверок и rendered evidence.

## Что прекращено

- статусы `UX pilot: RUN/N/A/BLOCKED` и `PASS/PARTIAL/FAIL`;
- таблица pilot-метрик, подсчёт handoff-комментариев и циклов согласования;
- обязательный отчёт о наличии Agentation-аннотаций; Agentation остаётся
  необязательным каналом точной обратной связи;
- повтор пилота и установка gstack, browser daemon, dependencies или production
  analytics ради UX-loop.

Зелёные E2E, axe, accessibility snapshot или набор скриншотов не являются
самостоятельным usability PASS. Они дополняют, но не заменяют экспертный
cognitive walkthrough и отдельное исследование с реальными игроками.
