# Vibe Coding Template

Шаблон для быстрого старта web/mobile продуктов: один репозиторий с готовым backend, browser-клиентом, Expo-приложением и общими API-контрактами. Цель шаблона - дать AI-агентам чистую начальную архитектуру, чтобы новые фичи продолжали писаться по уже заданным границам.

## Install With a Codex Agent

When installing this template from a GitHub URL in a fresh Codex session, give the agent this initial prompt:

```text
Install this repository into the project. First read README.md, AGENTS.md, and docs/*.md. Before setup, ask me what I want to build first, which surfaces I need now (web, mobile, backend/API, or full-stack), and whether I need deployment now. If deployment is needed, ask whether to use DigitalOcean or Yandex Cloud. Do not require cloud credentials for local development.
```

Local development does not require DigitalOcean or Yandex Cloud. Cloud tokens, `doctl auth init`, `yc init`, registry access, managed PostgreSQL, and Expo/EAS/App Store/Google Play accounts are needed only when the user chooses deployment or mobile release work. The agent may create local uncommitted `.env` files from `.env.example`, generate a local-only `JWT_SECRET`, start Docker PostgreSQL, apply migrations, and run validation. Anything that requires external authorization or a paid account must be called out before the agent attempts it.

## Что внутри

- `backend` - Bun + Hono + Prisma + PostgreSQL, custom JWT auth, Zod validation, OpenAPI.
- `web` - React + Vite + TanStack Query/Form/Router, готовый auth-flow.
- `landing` - отдельный Astro-проект для статической landing-страницы.
- `mobile` - Expo + React Native + Expo Router + TanStack Query/Form, auth-flow с SecureStore.
- `packages/contracts` - общие Zod-схемы и TypeScript-типы API.
- `docker-compose.yml` - локальный PostgreSQL на порту `54329`; test DB по умолчанию использует repo-derived port в тестовых runner-ах, либо `POSTGRES_TEST_PORT`.
- `docs/TESTING.md` - backend, Playwright и Maestro testing contract.

## Быстрый старт

```bash
bun install
docker compose up -d postgres
cp backend/.env.example backend/.env
bun run --cwd backend prisma:migrate
bun run dev:backend
bun run dev:web
bun run dev:landing
bun run dev:mobile
```

Для web можно создать `web/.env`:

```bash
VITE_API_URL=http://localhost:3000
```

Для Expo можно создать `mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
```

На Android emulator вместо localhost обычно нужен `http://10.0.2.2:3000`.

## Основные команды

- `bun run dev` - запустить workspace-проекты в dev-режиме параллельно.
- `bun run dev:landing` - запустить Astro landing-проект.
- `bun run typecheck` - TypeScript-проверка всех workspace-проектов.
- `bun run typecheck:landing` - Astro typecheck landing-проекта.
- `bun run build` - build/typecheck/export проектов, где есть build-скрипт.
- `bun run build:landing` - production build landing-проекта.
- `bun run test:backend` - backend unit/integration tests.
- `bun run test:backend:integration` - DB-backed auth tests через `postgres_test`.
- `bun run e2e:web` - Playwright auth smoke через backend + Vite.
- `bun run e2e:mobile` - Maestro auth smoke по установленному mobile build.
- `bun run --cwd backend prisma:migrate` - создать/применить Prisma migration в dev.
- `bun run --cwd backend prisma:deploy` - применить готовые миграции на сервере.

## Архитектурные ориентиры

Контракты API живут в `packages/contracts` и импортируются всеми слоями. Backend валидирует вход через эти Zod-схемы, web/mobile используют их же в TanStack Form и API-клиентах.

Backend устроен по потоку `route -> validation -> auth/session guard -> service -> Prisma -> DTO`. Routes остаются тонкими, бизнес-логика auth живёт в feature service, а `src/index.ts` только поднимает Bun server.

Подробнее: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), тесты: [docs/TESTING.md](docs/TESTING.md), деплой: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
