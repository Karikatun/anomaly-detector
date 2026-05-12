# Architecture

Этот репозиторий задаёт “golden path” для web/mobile продуктов: общие контракты, один backend, два клиента и минимум самописной инфраструктуры.

## Контракты

`packages/contracts` - источник истины для API payload/DTO/error shape. Новые endpoint-ы сначала получают Zod-схемы в contracts, затем backend использует их для request validation, а web/mobile - в TanStack Form и API-клиентах.

Не дублируйте shape руками в клиентах. Если контракт меняется, проверяйте producer и consumers одним проходом: backend route/service, web API client/form, mobile API client/form.

## Backend

Поток backend-кода:

```text
Hono route -> Zod validation -> auth/session guard -> feature service -> Prisma -> DTO
```

- `src/index.ts` - только runtime entrypoint.
- `src/app.ts` - Hono app, CORS, secure headers, error handling, route mounting, OpenAPI.
- `src/env.ts` - Zod-валидация env.
- `src/db.ts` - Prisma client.
- `src/auth/*` - auth feature: routes, service, JWT, password hashing, refresh-token hashing.

Routes должны оставаться тонкими. Не добавляйте бизнес-логику в Hono handlers, UI-клиенты или child components, если решение принадлежит backend service.

## Auth

Auth v1 - custom JWT:

- Пароль: `Bun.password.hash/verify`, Argon2id.
- Access token: короткоживущий JWT через `jose`.
- Refresh token: opaque random token, в БД хранится только SHA-256 hash.
- Web: refresh token в HttpOnly `SameSite=Lax` cookie, access token в памяти.
- Mobile: refresh token в `expo-secure-store`, access token в памяти.

Refresh token rotation создаёт новую session и отзывает старую. `/api/auth/me` проверяет и JWT, и активность session в БД.

## Frontend

Web и mobile используют одинаковые принципы:

- TanStack Query владеет server state.
- TanStack Form владеет form state.
- Zod-схемы берутся из `@web-app-demo/contracts`.
- API client централизует base URL, auth headers, refresh/retry и error shape.

Не создавайте новый form/query/auth abstraction, пока существующий паттерн не перестал решать задачу.

`Landing` - отдельный Astro workspace для статической landing-страницы. Он не владеет auth-flow и не должен дублировать browser-клиент из `web`; если landing начинает читать API или общие DTO, подключайте `@web-app-demo/contracts` и проверяйте producer/consumer стороны так же, как для `web` и `mobile`.

## Testing

Backend unit/integration tests проверяют контракты и auth-механику на уровне owning layer. Web E2E использует Playwright и запускает настоящий backend + Vite через `webServer`; mobile E2E использует Maestro и стабильные React Native `testID` selectors.

Client E2E в этом шаблоне - happy-path smoke, а не место для больших матриц валидации. Негативные payloads, password/JWT/session rules и error shape держите в backend tests; form validation и API state edge cases - в быстрых client-level tests, когда они появятся.

## Prisma

Не пишите migration SQL руками. Меняйте `backend/prisma/schema.prisma`, затем используйте:

```bash
bun run --cwd backend prisma:migrate
```

Для продакшена применяйте уже созданные миграции:

```bash
bun run --cwd backend prisma:deploy
```
