# Anomaly Detector

`Anomaly Detector` — синхронная соревновательная браузерная игра на дедукцию для 2–4 игроков.

Игроки выступают в роли исследователей орбитальной станции: получают образцы сигналов, проводят направленные эксперименты, строят модель неизвестной аномалии и конкурируют за корпоративные контракты. Партия длится пять раундов, а победитель определяется по итоговому рейтингу после финального аудита.

Скрытая конфигурация аномалии, допустимые действия, таймеры и результаты рассчитываются авторитетным сервером. Приватные измерения и рабочая модель доступны только их владельцу во время партии; после завершения участники получают полный аудит матча.

В проект входят игровой React-клиент, отдельный read-only операторский React-клиент, backend на Bun и Hono, PostgreSQL и общие Zod-контракты. Серверное ядро целевого набора правил реализовано; игровой интерфейс и подготовка к публичному тестированию продолжаются.

Подробности:

- [правила и описание игры](docs/GAME_DESIGN_BRIEF.md);
- [план и текущий статус реализации](docs/MVP_IMPLEMENTATION_PLAN.md);
- [дорожная карта после MVP](docs/POST_MVP_ROADMAP.md).

## Запуск

Понадобятся [Bun 1.3.14](https://bun.sh/) и Docker с поддержкой Compose.

Установите зависимости, запустите PostgreSQL, создайте локальную конфигурацию backend и примените миграции:

```bash
bun install
docker compose up -d postgres
cp backend/.env.example backend/.env
bun run --cwd backend prisma:deploy
```

Затем запустите backend и webapp в отдельных терминалах:

```bash
bun run dev:backend
```

```bash
bun run dev:webapp
```

Операторский клиент запускается отдельно и требует UUID пользователя в backend-переменной `ADMIN_USER_IDS`:

```bash
bun run dev:adminapp
```

API будет доступен по адресу `http://localhost:3000`, адрес webapp появится в терминале. Подробности о локальной базе данных и её сбросе находятся в [docs/LOCAL_DATABASE.md](docs/LOCAL_DATABASE.md).

## Проверки перед commit и push

После `bun install` проект автоматически подключает версионируемые Git hooks из `.githooks`. Если зависимости были установлены до появления hooks, подключите их один раз:

```bash
bun run hooks:install
```

- `commit-msg` проверяет формат Conventional Commits: `type(scope): lowercase imperative subject`;
- `pre-commit` проверяет staged-файлы на секреты и запускает быстрый `bun run check:commit` без integration, Docker и E2E;
- `pre-push` запускает полный `bun run check`, включая PostgreSQL integration, build, backend Docker smoke и Playwright E2E.

Локальные hooks можно обойти через `--no-verify`, поэтому обязательной удалённой гарантией остаётся GitHub Actions CI. Штатный игнорируемый `backend/.env` не сканируется; tracked или staged `.env`, credential-файлы и известные token/private-key patterns блокируются без вывода найденного значения.
