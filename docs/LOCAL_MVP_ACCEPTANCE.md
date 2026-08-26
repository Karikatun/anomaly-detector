# Local-only acceptance Public MVP Journey

Этот harness нужен только для управляемого человеческого прогона на одном
доверенном локальном компьютере. Он открывает отдельный browser context для
каждого реального участника, но не автоматизирует игру и не заменяет людей.
Каждый состав запускается отдельно: 2, затем 3, затем 4 игрока.

Harness не является deploy, не обращается к production и не закрывает сам по
себе [Issue #24](https://github.com/Karikatun/anomaly-detector/issues/24).
Production, DNS/TLS, реальные OAuth/SMTP/recovery, legal/operations readiness,
support routing и физические mobile Safari/Chrome остаются `NOT RUN`.

## Почему это не ещё один E2E

Playwright уже отдельно проверяет landing CTA → registration → продолжение
tutorial, полный tutorial с Recovery Email offer, пятирундовый Tender для двух
игроков и раннее завершение комнаты на четырёх.
Backend отдельно покрывает нормальный Tender для 2, 3 и 4 игроков. Здесь нет
gameplay assertions, fixture/admin API, прямых записей в БД или ускорения фаз:
люди создают аккаунты и комнату и выполняют команды только через реальный UI.

Harness находится вне `webapp/e2e/specs`, поэтому обычный E2E его не запускает.
Если ручной прогон обнаружит воспроизводимую регрессию, автоматический тест
добавляется позже на owning boundary, а не копируется в этот сценарий.

## Подготовка и запуск

Нужны уже установленные Bun, pinned PostgreSQL image в локальном Docker с Unix
socket и браузеры текущей версии Playwright. Runner использует `--pull never` и
не скачивает image или зависимости во время acceptance.
Полный запуск требует чистое рабочее дерево и интерактивный терминал. Сначала
проверьте startup/cleanup без открытия браузера:

```bash
bun run acceptance:mvp --players 2 --smoke
```

Затем проведите три независимых прогона, не параллельно:

```bash
bun run acceptance:mvp --players 2
bun run acceptance:mvp --players 3
bun run acceptance:mvp --players 4
```

Для отдельного Firefox-прогона добавьте `--browser firefox`. В одном запуске
нельзя смешивать браузеры: это отдельная матрица, а не цель группового harness.

Runner сам:

- удаляет inherited Docker/Compose/database/proxy/provider/release selectors;
- передаёт дочерним процессам allowlist системного окружения и использует
  пустые Bun env-file и Vite/Astro envDir вместо checkout `.env`;
- принимает только локальный Unix-socket Docker context;
- создаёт уникальный Compose project, свежую базу `*_test` и случайные
  loopback-порты;
- привязывает PostgreSQL, API, worker, webapp и website только к `127.0.0.1`;
- отключает analytics, SMTP, OAuth, object storage, admin access и browser
  artifacts;
- открывает 2–4 отдельных contexts без trace, video, screenshot, downloads и
  сохранения `storageState`;
- при обычном завершении, ошибке, `SIGINT` или `SIGTERM` останавливает только
  свои процессы и удаляет только свой project и volume.

Не используйте `--smoke` как acceptance evidence: он проверяет только готовность
стека и cleanup. Не меняйте loopback на LAN/`0.0.0.0` и не подставляйте внешние
URL или базы. Физические устройства требуют отдельной trust boundary.

## Короткий сценарий фасилитатора

До приглашения участников назначьте MVP Initiator и incident owner, а также
проверьте приватный канал из [SECURITY.md](../SECURITY.md). Участники не должны
видеть приватные экраны друг друга. Не включайте запись экрана, trace или общий
clipboard. Для каждого состава используйте новый запуск.

1. В окне 1 MVP Initiator начинает с локального публичного сайта, нажимает
   «Пройти обучение», создаёт новый синтетический password-аккаунт и завершает
   tutorial до First Player Value.
2. Убедитесь, что показано необязательное предложение Recovery Email. Не вводите
   и не отправляйте реальный или вымышленный адрес: в этом harness проверяется
   только появление предложения, не доставка и не восстановление.
3. Остальные участники в своих изолированных окнах создают новые синтетические
   password-аккаунты. Не используйте личные логины, реальные пароли или
   `seed:test-users`; ничего из credentials не записывайте.
4. Initiator создаёт стандартную комнату точной вместимости. Передайте код
   устно, все участники присоединяются, отмечают готовность и запускают Tender.
   Не копируйте код или object identifiers в терминал, чат или заметки.
5. Сыграйте все пять раундов и финальную научную модель штатно: без намеренного
   выхода, forfeit и искусственного ожидания deadline. Для четырёх игроков
   целевой ориентир полного Tender — 40–50 минут; runner измерит фактическое
   время и длительности наблюдённых фаз.
6. После завершения откройте итоговый audit и убедитесь, что участники могут
   объяснить результат, не показывая друг другу приватные данные во время игры.
7. Один участник отправляет один Feedback Report с нейтральным синтетическим
   содержанием без персональных данных, полных URL, идентификаторов и приватного
   игрового состояния. Оставьте выключенными reply contact и account linkage.
   Проверьте receipt визуально, но не копируйте его номер.
8. Нажмите Enter в терминале. Сначала дождитесь подтверждения удаления project
   и volume, затем ответьте на короткую анкету только кодами из подсказки.

Если обнаружена security/privacy-проблема, прекратите пользовательский сценарий
и нажмите Enter, а не `Ctrl-C`: после cleanup укажите blocker `security`, outcome
`contained` или `unresolved`, owner `security` и используйте приватный канал, не
публикуя детали. `SIGINT`/`SIGTERM` предназначены для аварийного abort без
evidence. Любая находка, делающая прогон
недействительным, должна дополнительно получить подходящую blocker category;
без этого findings сами по себе не меняют итоговый status. Один эпизод
balance/timing фиксируется только как наблюдение и не меняет правила.

## Disposable data и безопасный результат

Аккаунты и комнаты не удаляются продуктовым account-delete flow. Disposable
гарантия достигается удалением целого уникального PostgreSQL volume после
закрытия browser contexts и локальных процессов. Если cleanup не подтверждён,
команда завершается с ошибкой, не создаёт evidence и печатает точное имя своего
Compose project. После проверки local Unix-socket context удаляйте только этот
project; не используйте broad prune:

```bash
docker compose --file docker-compose.yml --project-name <printed-project> down -v --remove-orphans
```

После успешного cleanup создаётся один игнорируемый Git файл с правами `0600`:

```text
.scratch/local-mvp-acceptance/<timestamp>-<players>p-<browser>.json
```

В нём разрешены только:

- полный Git SHA, время, browser class/version и число игроков;
- агрегированные количества disposable accounts, rooms, tutorial completions,
  Tenders и Feedback Reports;
- исход штатного/раннего/незавершённого Tender, общая длительность и
  длительности наблюдённых фаз;
- `pass` / `fail` / `not_run` для пяти шагов Public MVP Journey;
- количество findings по фиксированным category/owner, категории blockers и
  `none` / `contained` / `unresolved` для incident outcome;
- явные `local_isolated`, `productionAcceptance: not_proven` и внешние
  `NOT RUN` gates.

Во время прогона продукт неизбежно держит synthetic login, password hash,
sessions/cookies, Feedback Report и приватное состояние Tender в disposable БД
и эфемерных browser profiles. Только aggregate observer и итоговый evidence не
читают и не сохраняют эти значения, Account/Recovery Email, room code, public
Feedback number, UUID, IP-адреса, полный URL или тексты Feedback Report. Raw
stdout/stderr сервисов и browser artifacts также не сохраняются. Эти временные
продуктовые данные считаются удалёнными только после подтверждённого cleanup;
при его ошибке exact project volume может сохраниться для точечного удаления.
