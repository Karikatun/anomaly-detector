# Agent Audit Checklist

Это автоматический рабочий протокол агента для каждой нетривиальной задачи.
Пользователь не обязан просить об аудите, выбирать профиль или напоминать о
проверках. Источник профилей и точных доказательств —
[карта аудитов](../AUDIT_GUIDE.md) и документы-владельцы затронутых поверхностей.

## 1. Маршрутизация

- [ ] Определить этап и touched surfaces: contracts, backend, DB/migrations,
      webapp, website, adminapp, auth/privacy, storage, infrastructure, legal.
- [ ] Назвать основной observable signal.
- [ ] Автоматически выбрать `ordinary`, только если high-risk триггеров нет;
      иначе выбрать и совместить все сработавшие профили из карты аудитов.
- [ ] Для `ordinary` выбрать 1–3 проверки, которые лучше всего могут опровергнуть
      готовность. Не составлять исчерпывающий список `N/A`.
- [ ] Для полного профиля покрыть все относящиеся к риску границы и явно назвать
      существенные `BLOCKED`, `NOT RUN` и только информативные `N/A`.
- [ ] Автоматически выбрать `TDD-first`, когда меняются поведение, контракты,
      доступ, persistence, state transitions или concurrency; очевидный тестовый
      seam не требует согласования.

Полный профиль обязателен для cross-layer/product contract, auth/security/
privacy, persistence/migrations/concurrency, существенного UI/UX,
performance-sensitive path или regression, release/production и incident. Он
не означает запуск всех
сканеров: нужно полностью покрыть соответствующий риск минимальным надёжным
набором evidence.

## 2. Выполнение

- [ ] Прочитать owning docs и проверить producer/consumer или соседние слои,
      которые могут изменить основной сигнал.
- [ ] Начать с самой узкой надёжной проверки, затем расширить покрытие только по
      риску или полученному failure.
- [ ] Для shared contract проверить producer, consumers и error path; для
      persistence — реальную PostgreSQL-границу и recovery/compatibility; для
      существенного UI/UX — `$anomaly-ui` и rendered desktop/mobile/focus/
      recovery; для security — автоматический режим `$anomaly-security-review`.
- [ ] Запустить `bun run architecture:check`, exact-image scan, полный release
      checklist или provider runbook только когда сработал их documented trigger.
- [ ] Использовать repository scripts и pinned dependencies. Не считать scanner
      score, green CI, VM `RUNNING`, container `healthy`, screenshot или axe
      доказательством всей продуктовой, security или usability-границы.

## 3. Safety boundary

- [ ] Не выводить secrets, cookies, tokens, personal/private data или полный
      чувствительный scanner report.
- [ ] Не направлять ZAP, DHEat, нагрузочные или иные активные атаки на production.
- [ ] Не устанавливать packages, не передавать private repository content и не
      менять production, firewall, SSH, sysctl или cloud resources без явного
      разрешения.
- [ ] Зафиксировать любую применимую невыполненную проверку как `BLOCKED` или
      `NOT RUN` с причиной, остаточным риском и следующим шагом.

## 4. Завершение

- [ ] Основной сигнал доказан; failure или timeout не выдан за PASS.
- [ ] Выбранные secondary checks выполнены и связаны с touched surfaces.
- [ ] Находки отделены от гипотез; security finding соответствует finding bar
      `$anomaly-security-review`.
- [ ] Task-scoped diff и обязательные gates проверены. Commit создаётся только
      в рамках действующих Git-инструкций; push/deploy требуют отдельного запроса.

```text
Audit profiles and touched surfaces: <profiles; surfaces>
Primary signal status: PASS/FAIL/PARTIAL — <evidence>
Secondary signal status:
- PASS/FAIL — <selected check and result>
Coverage gaps: <BLOCKED/NOT RUN with risk and next step, or none>
Security/UX/production status: <only when that full profile applied>
Residual risk: <risk or none identified>
Commit: <sha title> or <why no commit>
```
