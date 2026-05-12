# Testing

Цель тестов в шаблоне - дать будущим агентам понятный пример, где проверять поведение, а где не раздувать E2E.

## Пирамида

- Backend unit/integration: контракты, env parsing, JWT, password hashing, refresh rotation, auth guards, стабильный error shape.
- Web Playwright: короткие happy-path E2E через настоящий backend и Vite UI.
- Mobile Maestro: короткие happy-path smoke flows по установленному Expo development build.

Негативные матрицы валидации, edge cases и чистые правила должны жить в unit/integration tests. Client E2E нужен для главных пользовательских цепочек: нажал кнопку, прошёл реальный API flow, увидел устойчивое состояние.

## Backend

```bash
bun run test:backend
bun run test:backend:integration
bun run test:web
DATABASE_URL="postgresql://postgres:postgres@localhost:54329/web_app_demo?schema=public" bun run --cwd backend prisma:validate
bun run smoke:backend:docker
```

Backend tests находятся рядом с backend-кодом и проверяют auth-механику на уровне contracts/services/routes. Integration runner поднимает `postgres_test`, применяет migrations и прогоняет register/login/refresh/logout/guard/error-shape сценарии. По умолчанию test DB port вычисляется от абсолютного пути репозитория, чтобы параллельные checkout-ы не конфликтовали; задайте `POSTGRES_TEST_PORT`, если нужен фиксированный порт.

Docker smoke собирает backend image, стартует его против `postgres_test`, ждёт `/health` и удаляет только свой smoke-контейнер.

## Web E2E

Playwright настроен в `web/playwright.config.ts`.

```bash
bun run --cwd web e2e:install
bun run e2e:web
```

Что делает web E2E:

- запускает `docker compose up -d postgres_test`, если не задан `E2E_SKIP_DOCKER=1`;
- генерирует Prisma client и применяет миграции;
- поднимает backend на `E2E_BACKEND_PORT` (по умолчанию порт вычисляется от пути репозитория);
- поднимает Vite на `E2E_WEB_PORT` (по умолчанию порт вычисляется от пути репозитория);
- прогоняет auth smoke: register -> cookie refresh after reload -> protected route -> logout.

Полезные env:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:<test-port>/web_app_demo_test?schema=public"
E2E_BACKEND_PORT=<backend-port>
E2E_WEB_PORT=<web-port>
E2E_SKIP_DOCKER=1
```

По умолчанию Playwright вычисляет `POSTGRES_TEST_PORT` от абсолютного пути репозитория и откажется запускаться на базе без suffix `_test`, чтобы E2E случайно не писал в dev/prod данные.

Playwright artifacts лежат в `web/e2e/.artifacts/` и не коммитятся. Для интерактивной отладки:

```bash
bun run --cwd web e2e:ui
```

## Mobile Maestro E2E

Maestro flow находится в `mobile/.maestro/flows/auth-smoke.yaml`, runner - `mobile/scripts/e2e/run-maestro.mjs`.

Установка CLI:

```bash
bun run --cwd mobile e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version
```

Prerequisites:

- Java 17+;
- Xcode/iOS Simulator для iOS или Android Studio/emulator для Android;
- установленный Expo development build с `bundleIdentifier/package` `com.webappdemo.mobile`;
- backend доступен по тому `EXPO_PUBLIC_API_URL`, с которым собран или запущен bundle.
- для runner preflight задайте host-reachable `E2E_API_HEALTH_URL`, например `http://127.0.0.1:3000/health`.

Development build пример:

```bash
cd mobile
EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 bunx eas-cli build --profile development --platform ios
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 bunx eas-cli build --profile development --platform android
```

Запуск smoke flow:

```bash
bun run --cwd mobile e2e:maestro
```

Полезные env:

```bash
MAESTRO_DEVICE="iPhone 16 Pro"
MAESTRO_APP_ID=com.webappdemo.mobile
E2E_DISPLAY_NAME="Mobile E2E User"
E2E_EMAIL="mobile-e2e@example.com"
E2E_PASSWORD=password123
E2E_API_HEALTH_URL=http://127.0.0.1:3000/health
```

Mobile E2E использует `testID` selectors из `mobile/src/constants/testIds.ts`; новые flows должны добавлять стабильные selectors в UI, а не полагаться на хрупкие координаты. Текстовые selectors допустимы для финальных пользовательских сообщений. Auth smoke проверяет register, session restore after app relaunch и logout.

## Источники

- Playwright: `webServer`, `baseURL`, traces/screenshots/video - https://playwright.dev/docs/test-webserver и https://playwright.dev/docs/test-use-options
- Playwright CLI/browser install - https://playwright.dev/docs/test-cli и https://playwright.dev/docs/browsers
- Maestro CLI install/run - https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli и https://docs.maestro.dev/maestro-cli/run-your-first-test-with-the-maestro-cli
- Maestro selectors and launch reset - https://docs.maestro.dev/api-reference/selectors и https://docs.maestro.dev/reference/commands-available/launchapp
