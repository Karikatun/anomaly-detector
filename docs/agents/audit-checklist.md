# Agent Audit Checklist

Этот чек-лист обязателен для каждой нетривиальной задачи. Он связывает изменение
с применимыми аудитами из [карты проверок](../AUDIT_GUIDE.md), но не требует
бездумно запускать весь набор команд.

## 1. До изменения

- [ ] Указать этап: design, implementation, PR/CI, release, post-deploy,
      periodic audit или incident.
- [ ] Назвать основной observable signal и 1–3 вторичных проверки.
- [ ] Перечислить изменяемые поверхности: contracts, backend, DB/migrations,
      webapp, website, adminapp, auth/privacy, storage, infrastructure, legal.
- [ ] Прочитать документы-владельцы для этих поверхностей.
- [ ] Если затронуты security-sensitive границы, выполнить threat review по
      `SECURITY.md`; если открыта продуктовая/архитектурная развилка — остановить
      реализацию до решения.

## 2. Выбор проверок

Отметить каждую применимую строку как `REQUIRED`, `N/A` с причиной или
`BLOCKED` с остаточным риском. Нельзя молча пропускать проверку.

| Триггер | Минимальное доказательство |
| --- | --- |
| Shared contract/API shape | producer + все consumers, schema tests, error path |
| Auth/permissions/privacy/object ID | actor-resource matrix, negative integration tests, safe projection |
| State change/async/realtime | duplicate, replay, race, timeout, reconnect и recovery |
| Prisma/persistence | real PostgreSQL integration, migration/rollback compatibility |
| Module/platform dependency | `bun run architecture:check` |
| UI behavior | user-visible test; relevant UX states and rendered inspection |
| Visual-only UI | desktop/mobile rendered review; accessibility semantics if touched |
| Public website | production build, initial HTML/SEO/assets/links, responsive rendering |
| Secrets/dependencies/source | repository security commands and relevant CI job |
| Docker/IaC/image | Trivy config + exact built image, pinned tool/image evidence |
| Release | full `docs/RELEASE_CHECKLIST.md` and exact green CI commit |
| Production/network/VM | provider runbook, read-only evidence, explicit mutation approval |
| SSH/OS hardening | external ssh-audit and/or Lynis when cadence or change trigger applies |
| Backup/storage/cleanup | restore evidence, exact resources, recovery and no broad prune |
| Incident | evidence preservation, containment, impact, recovery and regression guard |

## 3. Безопасное выполнение

- [ ] Начать с самой узкой проверки, способной доказать основной сигнал.
- [ ] Использовать repository scripts и pinned dependencies; не подменять их
      случайной latest-версией инструмента.
- [ ] Не выводить secrets, cookies, tokens, personal/private data или полный
      чувствительный scanner report.
- [ ] Не направлять ZAP, DHEat, нагрузочные или иные активные атаки на production.
- [ ] Не устанавливать пакеты, не менять firewall/SSH/sysctl/cloud resources и
      не исправлять production автоматически без явного разрешения.
- [ ] Не считать scanner score, отсутствие CVE, green CI, VM `RUNNING` или
      container `healthy` достаточным доказательством всей границы.

## 4. Перед завершением

- [ ] Основной сигнал действительно доказан; failure/timeout не выдан за PASS.
- [ ] Выполнены вторичные checks для напрямую связанных поверхностей.
- [ ] Для exact-image scan доказано, какой image reference проверялся; для
      release сопоставлен deployed image ID/digest.
- [ ] Все `BLOCKED`/`NOT RUN` перечислены с причиной, риском и следующим шагом.
- [ ] Находки отделены от гипотез; finding содержит attacker/path/control/impact
      и доказательство.
- [ ] Документация обновлена только там, где изменился долговечный контракт.
- [ ] Task-scoped diff проверен, обязательные gates зелёные, создан один
      Conventional Commit; push/deploy выполняются только по отдельному запросу.

## Обязательный итог агента

```text
Primary signal status: PASS/FAIL/PARTIAL — <доказательство>
Secondary signal status:
- PASS/FAIL/NOT RUN/N/A — <проверка и результат>
Security audit status: <scope, findings or no proved findings, coverage gaps>
Active DAST status: NOT RUN или точная isolated target
Residual risk: <остаток или none identified>
Commit: <sha title> или причина отсутствия commit
```
