# Deployment

Use this document after the user has chosen deployment. Local setup from `README.md` does not require DigitalOcean or Yandex Cloud credentials.

Перед деплоем выберите облако по аудитории проекта:

- International/default: DigitalOcean.
- РФ-аудитория: Yandex Cloud, потому что DigitalOcean может быть недоступен без VPN.

Секреты не храните в репозитории. Минимальные backend env:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-random-characters>
CORS_ORIGINS=https://web.example.com,https://mobile-preview.example.com
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_SECURE=true
```

## DigitalOcean через doctl

1. Установите `doctl`.
2. Создайте token в DigitalOcean и выполните:

```bash
doctl auth init
```

3. Создайте Managed PostgreSQL или укажите внешний PostgreSQL.
4. Соберите backend image из корня репозитория:

```bash
docker build -f backend/Dockerfile -t registry.digitalocean.com/<registry>/web-app-demo-backend:latest .
```

5. Залогиньтесь в registry и отправьте image:

```bash
doctl registry login
docker push registry.digitalocean.com/<registry>/web-app-demo-backend:latest
```

6. Создайте App Platform spec с backend web service, healthcheck `/health`, env-переменными и managed database connection. Можно сгенерировать spec через `doctl apps spec create` или подготовить YAML по текущей структуре сервиса, затем выполнить `doctl apps create --spec <path-to-spec.yaml>`. Если app уже создан, используйте `doctl apps update <app-id> --spec <path-to-spec.yaml>`.

7. Примените миграции в one-off console/job:

```bash
bun run --cwd backend prisma:deploy
```

## Yandex Cloud через yc

1. Установите Yandex Cloud CLI.
2. Настройте профиль:

```bash
yc init
```

3. Создайте Container Registry и соберите backend image:

```bash
docker build -f backend/Dockerfile -t cr.yandex/<registry-id>/web-app-demo-backend:latest .
docker push cr.yandex/<registry-id>/web-app-demo-backend:latest
```

4. Создайте Serverless Container:

```bash
yc serverless container create --name web-app-demo-backend
```

5. Задеплойте revision. Приложение читает порт из `PORT`, Yandex задаёт его автоматически.

```bash
yc serverless container revision deploy \
  --container-name web-app-demo-backend \
  --image cr.yandex/<registry-id>/web-app-demo-backend:latest \
  --cores 1 \
  --memory 512MB \
  --execution-timeout 30s \
  --environment DATABASE_URL=<postgres-url>,JWT_SECRET=<secret>,CORS_ORIGINS=<origins>,COOKIE_SECURE=true
```

6. Подключите PostgreSQL: Managed PostgreSQL, внешний Postgres или другой совместимый endpoint. После деплоя примените Prisma migrations через защищённый one-off запуск с теми же env:

```bash
bun run --cwd backend prisma:deploy
```

## Expo / EAS

1. Войдите в Expo account:

```bash
bunx eas-cli login
```

2. Привяжите проект:

```bash
cd mobile
bunx eas-cli project:init
```

3. Настройте публичный API URL:

```bash
bunx eas-cli env:create --name EXPO_PUBLIC_API_URL --value https://api.example.com --environment production
```

4. Development build:

```bash
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

5. Production build:

```bash
bunx eas-cli build --profile production --platform all
```

Для App Store нужен Apple Developer Program. Для Google Play нужен Google Play Developer account.
