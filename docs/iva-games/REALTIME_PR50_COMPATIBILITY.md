# Realtime: совместимость draft PR50 и Forpost

## Статус и источники — 28 ноября 2026

Основной исполнитель проверил через GitHub metadata: [PR50](https://github.com/decorum-guy/iva-games/pull/50) — **draft, не принят и не опубликован**. Совпадение имени протокола не является подтверждением совместимости. `games/tyaga/STATUS.md` в новой вершине сообщает о четырёх браузерных раундах, нуле полных доставок и завершённой с дефектами R04; повтор R05 после исправлений ещё не выполнен. Это отчёт исполнителя Tyaga, а не независимое прохождение в данном аудите. Указанный внутри STATUS предыдущий опубликованный commit `b7ab9ed…` является снимком до нового commit; фактическая вершина сверена через git ниже.

Аудит выполнен чтением `git show`/`git diff`, без переключения ветки, изменения production-кода, запуска тестов или браузера.

Историческая повторная проверка перед R4: PR50 оставался draft, вершина `b7ab9ed4265b819299d082e21a6a3957ba1d07de`, tree `14c2e7b9b4992c096fd5d6530aec683294ec8b08`, была получена в отдельный ref `refs/remotes/qa/pr50-audit-b7ab9ed`. Единственный тогда новый commit менял девять CI/fixture/dev-browser scripts. Сравнение `apps/realtime-server/src`, `packages/realtime-kit/src`, `packages/session-kit`, `apps/platform/src` и `packages/game-registry` с указанным ниже `6ab92545` дало нулевую дельту. Выводы о wire/crypto/storage/runtime/catalog сохранялись; старые результаты исполнения не объявлялись результатами новой вершины. Изменённый `deploy/iva-games/verify-realtime-image.sh` требует отдельного согласования с нашей retention-проверкой при будущем объединении. Тогда ещё непринятый PR53 `a148aff7aaccef9820504755e24d849c35980484` содержал предложенные документы полного цикла; дальнейшее принятие отмечено ниже.

Последний delta-аудит после R5: `refs/pull/50/head` получен без checkout/merge в `refs/remotes/qa/pr50-audit-848c626`. Фактический commit — `848c626481a8ada589fb7e3d742af1f47d028e73`, tree — `c1aed62a254744803655048cff4e41d6c369ddd9`. Его родители — ровно `b7ab9ed4265b819299d082e21a6a3957ba1d07de` и принятый main `7c2be21db5743b15b4a42d708ac959039c6b725e`. Таким образом, diff включает уже принятые изменения main и новую работу PR50. Определение «только fixtures» к этой дельте **не применимо**. Детали чтения закреплены в [sanitized evidence](evidence/realtime-pr50-delta-848c626-2026-11-28.json).

| Источник | Commit | Tree |
|---|---|---|
| PR50, последний delta-аудит | `848c626481a8ada589fb7e3d742af1f47d028e73` | `c1aed62a254744803655048cff4e41d6c369ddd9` |
| PR50, предыдущий delta-аудит | `b7ab9ed4265b819299d082e21a6a3957ba1d07de` | `14c2e7b9b4992c096fd5d6530aec683294ec8b08` |
| PR50 / `refs/remotes/origin/qa-pr50-head` | `6ab9254523c7359bbd174f0304be19d0f68bf40b` | `209a8db27a9df66a7a1c4c832841ffa866947d48` |
| Forpost, исходная база сравнения контрактов | `e88be1a203142a40801195cbfad1eafe8ea47574` | `f3ff57573fb9ce7f3399e6cc0312aee56160943e` |

В исходном аудите дополнительно прочитаны тогдашние рабочие версии Forpost, ещё не составлявшие новую опубликованную ревизию. Git blob identities на тот момент: `apps/realtime-server/src/store.ts` — `a80d83d8d33214b684268e90294b1f535e8d22f7`; `artifacts.ts` — `ff4d1a5e97134633bd8b717b421d3faa3836c228`; `content.ts` — `323b720897b703ae03b0882494e4797beb38a227`; `runtime.ts` — `31b69091e9a601622ce36aa987e4574c8df8a291`. Эти исторические identities не выдаются за новые сборки; перечисленные ниже различия контрактов сохраняются.

## Новая дельта `b7ab9ed…` → `848c626…`

Полное сравнение содержит 99 изменённых путей. В истории появились один новый merge commit PR50 и 14 уже принятых commits main. В общем runtime изменены ровно три production-файла; это расширение диагностики, а не только обновление QA:

| Путь | Подтверждённое изменение |
|---|---|
| `apps/realtime-server/src/engine.ts` | Добавлены длительности последнего step/batch/serialize/commit, счётчики overload pause/recurrence и последнее наблюдение на игру. События `overload-pause`/`overload-recurred` теперь сохраняют измеренный контекст в payload журнала вместе с прежним полным snapshot. Порог паузы и число catch-up steps не изменены. |
| `apps/realtime-server/src/server.ts` | Диагностические счётчики `rateLimitKinds` различают input/action/ACK/heartbeat/resync/claim. Выбор существующего limiter вынесен в `charge`; его бюджеты и `RATE_LIMIT` не изменены. |
| `apps/realtime-server/src/worker-host.ts` | Агрегируются optional overload counters и `overloadMeasuredWorkers`; старые retained workers явно не считаются оснащёнными новой диагностикой. |
| `games/tyaga/src/client/connection.ts` | Рабочий клиент объединяет ACK до 20 раз/с, сохраняет последние acknowledged/server/pending baselines, блокирует команды до актуального full после смены scope и игнорирует сообщения старого сокета. Это изменение жизненного цикла клиента при прежних wire полях. |

Публичный health по-прежнему удаляет `diagnostics`. Подробный `lastOverload` с worldTick/timing context и per-message counters доступны через прежний подписанный internal metrics route; публичные агрегированные overload counters расширяют health JSON. Наличие этих полей не подтверждает причину перегрузки или принятую ёмкость. Проверено чтением [engine](https://github.com/decorum-guy/iva-games/blob/848c626481a8ada589fb7e3d742af1f47d028e73/apps/realtime-server/src/engine.ts), [gateway](https://github.com/decorum-guy/iva-games/blob/848c626481a8ada589fb7e3d742af1f47d028e73/apps/realtime-server/src/server.ts), [worker host](https://github.com/decorum-guy/iva-games/blob/848c626481a8ada589fb7e3d742af1f47d028e73/apps/realtime-server/src/worker-host.ts) и [клиента](https://github.com/decorum-guy/iva-games/blob/848c626481a8ada589fb7e3d742af1f47d028e73/games/tyaga/src/client/connection.ts).

Побайтово не изменены относительно `b7ab9ed…`: весь `packages/realtime-kit`, `packages/session-kit`, `packages/game-registry`, ticket/bridge crypto, SQLite storage, `GameAdapter` bridge, artifact/client-content code, `main.ts` и `simulation-worker.ts`, `Dockerfile.realtime`, activation и image-verification scripts. Поэтому прежние несовместимости wire/signature/admission/schema/archive/route/registry из таблицы ниже сохраняются. Ни новый Forpost adapter в PR50, ни поддержка его guest practice или RTT context этой дельтой не добавлены.

В `apps/platform/src` дельта ограничена `database.ts`, `http.ts`, `service.ts`: это принятая в main обратимая очистка terminal room history (`room_list_hidden`, `hiddenRoomCount`, clear/restore), уже сохранённая в нашей ветке. Она не является новым согласованием realtime API. Из main также включены District trade fixes и документы полного цикла PR53.

QA-дельта включает connection/recovery/rate-counter regressions, явный control claim при reconnect в network harness, отдельный affinity/CPU-budget учёт и тяжёлые fixture-сцены. `browser-connection.test.ts` использует настоящий TCP/WebSocket с управляемой доставкой browser-like событий и подставленным ticket HTTP; это не rendered browser, Rapier или capacity benchmark. Документы PR50 отделяют пять не прошедших полный gate коротких N2 calibration, частичный netem и ещё не выполненные hour/heavy/R05 проверки. Эти результаты сообщены автором PR50; данный delta-аудит не запускал их повторно и не засчитывает их Forpost.

Текущий PR50 остаётся непринятым. Производственные изменения из него не переносились. Будущее объединение требует прежнего явного согласования протоколов, схем, readers, двух адаптеров и каталога; новый diagnostics/ACK код этого согласования не заменяет.

## Подтверждённые границы

Обновление после повторного аудита: PR53 затем принят в main `7c2be21db5743b15b4a42d708ac959039c6b725e` и включён обычным merge. Его документация теперь действует; production-контракты PR50 от этого не изменились.

| Область | PR50 | Forpost и следствие |
|---|---|---|
| Wire | JSON `protocolVersion: 'iva-realtime@1'`; claim требует `expectedGeneration`, heartbeat — `nonce`; delta содержит `changes[]` с путями; `hasControl`. | JSON `protocolVersion: 1`; claim/heartbeat без этих дополнительных полей; delta содержит верхнеуровневый `patch`; `controlling`. Одинаковые `/ws/realtime/v1` и subprotocol `iva-realtime-v1` не делают клиентов взаимозаменяемыми. |
| Ticket и service bridge | Подписываемый ticket-префикс `iva-ticket-v1\n`; claims `sessionId`, permission `play`, issuer платформы. Bridge передаёт подписанный envelope. | Префикс `iva-ticket-v1.`; claims `admissionId`, permission `control`, включая гостевую practice. Bridge использует подпись тела и отдельные headers. Односторонняя замена ломает проверку подписи и admission. |
| Platform API | `realtimeTicket`, `syncAdmissions`, `confirmResult`; маршруты `participant`, `ack-result`, GET status. | `issueRealtimeTicket`, `acknowledgeResult`, `validateStart`; `view`, `admission`, `result-ack`, POST status. В PR50 отсутствует Forpost hook проверки равных команд `validateStart`; его требуется сохранить. |
| SQLite | `rt_matches`: `id/start/meta/fence`; `rt_admissions` хранит очередь запуска; отдельные `rt_snapshots` и `rt_receipts`. | `rt_matches`: `match_id/record_json/owner_epoch`; `rt_admissions` хранит действующие admission, очередь — `rt_start_queue`. Совпадают также имена несовместимых `rt_journal`/`rt_checkpoints`. `CREATE TABLE IF NOT EXISTS` не мигрирует эти схемы; существующий файл базы нельзя просто открыть другим store. |
| Runtime и client archives | Worker manifest `protocol: 'iva-worker@1'`, `sha256`, per-file hashes; runtime ID адаптера дополняется fingerprint. Client manifest `.iva-client-manifest.json`, route `/play/<game>/versions/<hex>/`. | Manifest `format: 1`, `artifactId: 'sha256:…'`, другой hash и worker RPC; client `_content-manifest.json`, route `/realtime-assets/<hex>/`. Существующий Forpost route whitelist не принимает маршрут PR50. Нужны сохранённые readers и маршруты для старых партий, а не переименование hash. |
| Регистрация и доставка | Generic engine существует, но `simulation-worker.ts`, `main.ts`, platform registration и каталог включают только Tyaga. Registry требует строковую версию, `launch: 'platform-room'` и game-specific health. Caddy overlay направляет Tyaga на4320. | Forpost имеет числовую версию, `roomLaunch`, `developmentUrl`, собственные registration и guest practice. Текущий Caddy направляет обе игровые группы путей на4331. Требуется согласование каталога, build/deploy, admission и маршрутов с сохранением обеих игр. |

Исходники PR50, закреплённые указанным SHA: [wire и GameAdapter](https://github.com/decorum-guy/iva-games/blob/6ab9254523c7359bbd174f0304be19d0f68bf40b/packages/realtime-kit/src/index.ts), [crypto](https://github.com/decorum-guy/iva-games/blob/6ab9254523c7359bbd174f0304be19d0f68bf40b/apps/realtime-server/src/crypto.ts), [storage](https://github.com/decorum-guy/iva-games/blob/6ab9254523c7359bbd174f0304be19d0f68bf40b/apps/realtime-server/src/storage.ts), [artifacts](https://github.com/decorum-guy/iva-games/blob/6ab9254523c7359bbd174f0304be19d0f68bf40b/apps/realtime-server/src/artifacts.ts), [client content](https://github.com/decorum-guy/iva-games/blob/6ab9254523c7359bbd174f0304be19d0f68bf40b/apps/realtime-server/src/client-content.ts). Дополнительные сравниваемые пути в обоих деревьях: `packages/session-kit/src/types.ts`, `packages/game-registry/{games.json,src/index.ts}`, `apps/realtime-server/src/{server,simulation-worker,main}.ts`; Forpost bridge — `apps/platform/src/realtime-adapter.ts`, PR50 bridge — `apps/realtime-server/src/adapter.ts`.

## Реальная граница повторного использования

`GameAdapter<W>` и registry в PR50 `apps/realtime-server/src/engine.ts` действительно обобщают create/restore/serialize/input/step/action/view/outcome и выбор по game/rules/content versions. Это подходящая точка последующего объединения. Фактический entrypoint пока создаёт только `createTyagaAdapter()`.

Forpost-адаптер должен сохранить сброс input stream при смене controller generation, ограниченный RTT rewind, разрешённый `viewForPlayer`, подтверждённые action receipts и согласованную идентичность матча в core/view/envelope. `StepContext` PR50 сейчас не передаёт RTT, поэтому одной обёртки методов недостаточно.

Небольшой изолированный кандидат — `packages/realtime-kit/src/view-projection.mjs` с `tests/projection.test.ts`: detached baseline и защита от prototype paths. Его blob: `2c41f204511a19909155e898074d83234476a922`. Текущий Forpost использует другой формат delta, поэтому перенос требует явного согласования codec. `src/snapshot-transfer.ts` предлагает отдельное negotiated расширение trusted worker transport с кешем по observer/epoch/generation; необходимость этого расширения для текущих Forpost views не установлена.

**Принятая общая основа пока не установлена этим аудитом.** При дальнейшем объединении сохраняются оба игровых адаптера, обе записи каталога, проверка состава команд, guest/account сценарии, старые protocol/storage/artifact readers и pinned client routes. Совместимость должна подтверждаться соответствующими сетевыми и recovery проверками объединённой сборки. Этот документ не предлагает слияние общих файлов целиком и не засчитывает игровую, нагрузочную или публичную приёмку.

## Повторная проверка `f3a8347…` и включение нового main

Новая фактическая вершина PR50 — `f3a8347a11241ffdea677ff5ec391f227907cb29`, дерево `a26cca311ff918630aa55c1189be45a3b792d179`. GitHub metadata подтверждает open/draft/unmerged. От предыдущей вершины `848c626…` добавлены один commit и 10 изменённых путей. [Очищенный отчёт сравнения](evidence/realtime-pr50-delta-f3a8347-2026-11-28.json) основан на полученных точных Git objects и чтении исходников; игровые проверки Тяги в этом аудите не запускались.

В двух production-файлах Тяги решения ботов распределены по фазам `seatIndex % 6` при прежних 10 решениях в секунду и physics 60 Hz; при смене controller kind/generation сбрасывается cached bot input. `BOT_VERSION` изменена с `tyaga-bots@2` на `tyaga-bots@3`, physics build hash — с suffix `v9` на `v10`. Сам adapter не изменён, но читает новые константы, поэтому его эффективный manifest изменился. Restore по-прежнему требует точного physics build hash: при будущем объединении старые snapshots должны обслуживаться сохранёнными соответствующими workers.

Общие runtime/platform sources и все 14 критичных областей предыдущего аудита побайтно не изменились. Новая дельта не согласует wire, signatures, admission, SQLite, artifact/client readers, entrypoints, каталог или deploy. Поэтому перенос production-кода PR50 сейчас не выполнен; предыдущая таблица несовместимостей остаётся применимой.

Новый принятый main `fc91c1c68f4b81d9a2ab4ad64274d11aaa0a3d4e`, дерево `347ab6ef3ebb19362efa926f3924913a68837755`, содержит 43 изменённых пути: входные меню шахмат, торговый интерфейс Района, их проверки и документы. Общие realtime/session/registry/platform-service контракты имеют нулевую дельту. Main включён в Forpost обычным локальным merge `cd0e15c0299bbfb2d7fc57dcc92cd0494b67fd09`; игровые изменения сохранены, общая проверка кандидата R7 ещё впереди. PR50 на момент аудита этот main не включал: merge base оставался `7c2be21…`.

Новая принятая realtime-основа в main этим повторным аудитом не обнаружена. Каталоги непосредственно проверены: в main шесть базовых игр, в PR50 добавлена Тяга, в рабочем Forpost добавлен Форпост. Это текущее состояние отдельных веток, а не утверждение о совместной публикации.
