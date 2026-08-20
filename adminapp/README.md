# Операторское приложение

`adminapp` — отдельный минимальный клиент для эксплуатационного обзора. Текущая реализация read-only: она не входит в сборку игрового `webapp`, не содержит операций создания, изменения или удаления и использует только защищённый backend-маршрут `/api/operations/overview`. Полный список пользователей загружается серверными страницами по 20 записей, поэтому объём ответа остаётся ограниченным при росте базы.

В Production MVP эта граница расширяется только перечисленными в ADR 0011
аудируемыми командами: публикация политики Approved Mail Service и обработка
очереди Feedback Report. Универсальный CRUD, ручная смена Account Email,
password reset, просмотр recovery credentials и отправка писем из adminapp
запрещены. Продуктовая воронка и состояние почтового контура остаются
агрегированными read-only projections без перехода к пользователю или сырому
событию.

Локально:

```bash
bun run dev:backend
bun run dev:adminapp
```

Backend должен содержать UUID оператора в `ADMIN_USER_IDS`. По умолчанию приложение открывается на `http://localhost:5174`, а локальный Vite-сервер проксирует same-origin запросы `/api` в backend на `http://localhost:3000`. Нестандартный или production API задаётся при сборке через `VITE_API_URL`. Frontend-проверка не заменяет backend allowlist, version precondition, idempotent `commandId` и аудит каждой разрешённой команды.

Production-сборка:

```bash
VITE_API_URL=https://api.anomaly-detector.ru bun run build:adminapp
```

Публиковать `adminapp/dist` в открытый Object Storage нельзя. В текущем Yandex VM-контуре его обслуживает отдельный Caddy-host `ops.anomaly-detector.ru`, защищённый HTTP Basic Auth до выдачи любых файлов. После edge-проверки оператор дополнительно входит обычной учётной записью приложения, а backend проверяет её UUID по `ADMIN_USER_IDS`.

Не помещайте Basic Auth пароль или его открытое значение в репозиторий, команды, логи либо frontend-переменные. Caddy получает только хеш пароля из закрытого runtime environment.
