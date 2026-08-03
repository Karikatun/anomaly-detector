# Операторское приложение

`adminapp` — отдельный минимальный read-only клиент для эксплуатационного обзора. Он не входит в сборку игрового `webapp`, не содержит операций создания, изменения или удаления и использует только защищённый backend-маршрут `/api/operations/overview`. Полный список пользователей загружается серверными страницами по 20 записей, поэтому объём ответа остаётся ограниченным при росте базы.

Локально:

```bash
bun run dev:backend
bun run dev:adminapp
```

Backend должен содержать UUID оператора в `ADMIN_USER_IDS`. По умолчанию приложение открывается на `http://localhost:5174`, а API ожидается на `http://localhost:3000`. Нестандартный API задаётся при сборке через `VITE_API_URL`.

Production-сборка:

```bash
VITE_API_URL=https://api.anomaly-detector.ru bun run build:adminapp
```

Публиковать `adminapp/dist` в открытый Object Storage нельзя. В текущем Yandex VM-контуре его обслуживает отдельный Caddy-host `ops.anomaly-detector.ru`, защищённый HTTP Basic Auth до выдачи любых файлов. После edge-проверки оператор дополнительно входит обычной учётной записью приложения, а backend проверяет её UUID по `ADMIN_USER_IDS`.

Не помещайте Basic Auth пароль или его открытое значение в репозиторий, команды, логи либо frontend-переменные. Caddy получает только хеш пароля из закрытого runtime environment.
