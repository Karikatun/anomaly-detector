# Mobile

Мобильное приложение шаблона на Expo и React Native. Здесь уже есть минимальный auth-flow, который работает с теми же API-контрактами, что и web.

## Стек

- Expo SDK 55
- React Native
- TypeScript
- Expo Router
- TanStack Query
- TanStack Form
- Expo SecureStore
- Zod contracts из `@web-app-demo/contracts`
- Maestro E2E smoke flow

## Команды

```bash
bun run dev
bun run android
bun run ios
bun run web
bun run typecheck
bun run lint
bun run build
bun run e2e:maestro
```

Из корня репозитория используйте `bun run dev:mobile`, `bun run build:mobile` и `bun run typecheck:mobile`.

## Env

Создайте `mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
```

На Android emulator используйте:

```bash
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

`EXPO_PUBLIC_*` переменные попадают в клиентский bundle, поэтому не кладите туда секреты.

## Development Build

1. Зарегистрируйтесь или войдите в Expo account.
2. Установите EAS CLI, если его нет: `bunx eas-cli --version`.
3. Войдите: `bunx eas-cli login`.
4. Привяжите проект: `bunx eas-cli project:init`.
5. Соберите development build:

```bash
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

`expo-dev-client` уже установлен. Нативные `ios` и `android` папки не хранятся в шаблоне; их генерирует Expo prebuild/development build workflow.

## Maestro E2E

Maestro smoke flow проверяет `register -> current user -> logout` по установленному development build.

```bash
bun run e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
bun run e2e:maestro
```

Перед запуском backend должен быть доступен по `EXPO_PUBLIC_API_URL`, с которым собран или запущен mobile bundle. Для iOS simulator обычно подходит `http://127.0.0.1:3000`, для Android emulator - `http://10.0.2.2:3000`.

Стабильные selectors лежат в `src/constants/testIds.ts`, flow - в `.maestro/flows/auth-smoke.yaml`, runner - в `scripts/e2e/run-maestro.mjs`. Подробный runbook: `../docs/TESTING.md`.

## Практика

Для серверного состояния используйте TanStack Query, для форм - TanStack Form, для валидации - общие Zod-схемы. Refresh token хранится в `expo-secure-store` на native; access token хранится только в памяти приложения.
