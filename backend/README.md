# Backend

Backend-слой шаблона для API, auth, интеграций и серверной бизнес-логики. Web и mobile опираются на один контракт данных из `packages/contracts`.

## Стек

- Bun
- Hono
- Prisma 7
- PostgreSQL
- Zod
- jose JWT
- TypeScript

## Команды

```bash
docker compose up -d postgres
cp backend/.env.example backend/.env
bun run dev
bun run typecheck
bun run test
bun run test:unit
bun run test:integration
bun run smoke:docker
DATABASE_URL="postgresql://postgres:postgres@localhost:54329/web_app_demo?schema=public" bun run prisma:validate
bun run prisma:generate
bun run prisma:migrate
bun run prisma:deploy
```

Из корня репозитория используйте `bun run dev:backend`, `bun run build:backend`, `bun run typecheck:backend` и `bun run test:backend`.

`bun run test:integration` поднимает `postgres_test` из `../docker-compose.yml`, применяет Prisma migrations к `web_app_demo_test` и запускает DB-backed auth API tests. Если Docker уже управляется отдельно, задайте `TEST_SKIP_DOCKER=1` и `TEST_DATABASE_URL`.

`bun run smoke:docker` собирает backend Docker image, стартует его против `postgres_test`, ждёт `/health` и затем удаляет только созданный smoke-контейнер.

## Auth API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /openapi.json`

Пароли хешируются через `Bun.password` с Argon2id. Access token - короткоживущий JWT через `jose`. Refresh token - opaque random token; в базе хранится только SHA-256 hash, refresh делает rotation и отзывает старую session.

## Архитектура

`src/index.ts` только загружает env, создаёт Prisma client и запускает Bun server. Hono app создаётся в `src/app.ts`. Auth feature живёт в `src/auth`: routes валидируют и делегируют, service владеет session/user логикой, token helpers изолируют JWT и refresh-token механику.

Prisma migration SQL не пишется руками. Меняйте `prisma/schema.prisma`, затем запускайте `bun run prisma:migrate`.
