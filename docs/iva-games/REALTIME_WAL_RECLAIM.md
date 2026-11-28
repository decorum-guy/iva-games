# Realtime: восстановление бюджета WAL после checkpoint

Дата проверки: 28 ноября 2026. Статус: узкий дефект воспроизведён и исправлен в исходном сценарии. Причина отказа R6 hour и задержки браузерных R6-прогонов этим не установлена. Нового часового прогона, браузерной приёмки или публичного выпуска в этой проверке нет.

## Подтверждённый дефект

`assertCheckpointBudget` проверяет физический размер WAL до записи. При размере не менее 64 MiB он запрещает мутации. Прежний checkpointer выполнял только `PASSIVE`, а после полного backfill переставал запускать checkpoint. Уже обработанный WAL мог остаться физически большим; следующая запись, которая обычно позволяет SQLite переиспользовать и уменьшить его до `journal_size_limit`, оказывалась запрещена самим guard.

Это соответствует описанному SQLite различию между [checkpoint и reset WAL](https://www.sqlite.org/fileformat2.html#wal_reset). [TRUNCATE checkpoint](https://www.sqlite.org/c3ref/wal_checkpoint_v2.html) выполняет освобождение через собственные блокировки SQLite; ручное изменение файла WAL небезопасно и здесь не используется.

В baseline-проверке настоящие `RealtimeStore`, отдельный `checkpoint-worker` и четыре легальных мира FP01 использовали `synchronous=FULL`, `wal_autocheckpoint=0`, прежние ограничения 64/16 MiB. Явно удерживаемый тестовый reader позволил WAL вырасти до 67 296 112 B. После его освобождения `PASSIVE` обработал все 16 334 frames, `quick_check` вернул `ok`, однако guard продолжал возвращать `CHECKPOINT_WAL_LIMIT`, в том числе после следующего свежего poll. Диагностический native `TRUNCATE` устранял блокировку без изменения четырёх сохранённых world hashes.

Это fault injection с явно закреплённым reader, а не свидетельство существования такого reader в R6 CI.

## Изменение

Изменены только `apps/realtime-server/src/checkpoint.ts` и его focused tests.

- Отдельное checkpoint-соединение пробует native `PRAGMA wal_checkpoint(TRUNCATE)`, когда все известные frames обработаны и выделенный WAL превышает существующую цель 16 MiB.
- Прежний `busy_timeout=0` не позволяет ожидать освобождения reader/writer locks. Занятость учитывается отдельно; следующая попытка допускается только на последующем poll спустя не менее 250 ms по монотонным часам. Даже `poll(true)` не обходит это ограничение.
- Если между проверкой прогресса и вызовом появились новые writers/readers, корректность обеспечивает SQLite, а не предположение checkpointer о неизменности файла.
- Сохранены `FULL`, hard guard 64 MiB, проверки устаревшего/ошибочного checkpointer, FIFO writer, durable publication и порядок закрытия worker. Уже помеченная failed room автоматически не возобновляется.

Четыре дополнительных числовых поля `CheckpointStatus`: `reclaimAttempts`, `reclaimBusy`, `reclaimMaxMs`, `reclaimP99Ms`. Прежние `runs/maxMs/p99Ms` продолжают измерять `PASSIVE`. Ограничение ожидания locks не гарантирует нулевую или ограниченную длительность файлового I/O.

## Проверка исходного сценария

Исходный `.qa` case повторён побайтно: SHA-256 `4a460be1151b6bfa185dc0a713e2c52aa1bafc6f797409b248e3ed68f7fc5c84`. Из 26 фактических входных модулей сборки изменился только `checkpoint.ts`.

| Наблюдение | Baseline | После исправления |
|---|---:|---:|
| Контроль без reader injection | 480 переходов, guard PASS | 480 переходов, guard PASS |
| Переходы до отказа при закреплённом reader | 520 | 520 |
| Физический WAL при отказе | 67 296 112 B | 67 296 112 B |
| Guard при закреплённом reader | `CHECKPOINT_WAL_LIMIT` | `CHECKPOINT_WAL_LIMIT` |
| WAL после reader release и poll | 67 296 112 B | 0 B |
| Guard после reader release | `CHECKPOINT_WAL_LIMIT` | PASS |
| Следующий свежий poll | guard FAIL | guard PASS |
| Четыре сохранённых world hashes | совпали | совпали |
| `quick_check` | `ok` | `ok` |

В новой сборке восстановление произошло до отдельного ручного диагностического `TRUNCATE` контрольного этапа case. Зафиксирована одна успешная native reclaim-попытка длительностью 18.268328 ms. Это один диагностический sample, не latency acceptance.

Baseline завершился за 4.028212 s с `complete=true/reproduced=true`. Повтор занял 4.310882 s, `complete=true/reproduced=false`. Неизменённый детектор старого дефекта вернул exit 2 именно потому, что больше не воспроизвёл блокировку; функциональный результат проверен по полям guard, WAL, integrity и hashes. Оба случая закрыли свои соединения и workers. Запись ускоренная, не с реальной частотой 30 Hz, поэтому ёмкость сервера этим не измеряется.

## Focused regression

Новый тест на native SQLite сначала упал на старом коде с `CHECKPOINT_WAL_LIMIT` после reader release. После исправления — 7/7 focused tests PASS. Покрыты:

- старый reader, мешающий backfill, и сохранение hard guard при WAL более 64 MiB;
- актуальный reader, позволяющий full backfill, но запрещающий truncate, для payload 17/64 MiB;
- busy status без превращения его в storage failure;
- отсутствие повторов на частых вызовах и точная граница 249/250 ms;
- native освобождение, неизменность сохранённого мира и следующая разрешённая durable admission-операция;
- прежние stale/failure/size guards и whitelist метрик.

`tsc --noEmit`, focused ESLint и `git diff --check` прошли. Общая сборка, CI и другие приёмочные проверки относятся к отдельному раунду.

## Идентичность и локальные свидетельства

[Сопоставление двух фактических прогонов](evidence/realtime-wal-reclaim-2026-11-28.json) сохранено вместе с кодом; оно не содержит игровых миров, персональных данных или сырых ошибок.

| Объект | SHA-256 |
|---|---|
| Старый `checkpoint.ts` | `6a487bedd0d51eedae507e697625c6abb663652b2107fe1ea2e6166e2a27ce79` |
| Исправленный `checkpoint.ts` | `305c9e4da57cc477b9ede555d72d676f2a37e51b951e320b1e13a40004a9a50e` |
| Итоговый `checkpoint.test.ts` | `5eaca36de09e87c8ca824dd583305d24afdd7259a67fb713353f7d180ab87098` |
| Baseline executable inventory | `fb93b2fd9adde12a8b81f834b25d9983d5db44bfec101e4cd1d0ce35bb801d3a` |
| Повтор executable inventory | `ab251d70c2451d55c0f56458b0955035903b73abd47ed035a793432a3c90a7c6` |
| Baseline report | `6a2017d2e2740e2a1371a20f611adfa9d5f18414fecb3938754f1093b4feba17` |
| Повтор report | `f1df9d725a4dd960b090e89f71ebf1a14471e77c4b40f658eebd915e0af2fcd8` |
| Сопоставление двух фактических прогонов | `b0dd0e516127b08072e64cbae8903a8f17b26c31cc03d6fb2288743e0b35fefe` |

Локальные отчёты: `.qa/wal-budget-imQKz2/report.json`, `.qa/wal-budget-replay-wtqH20/report.json`; проверки модулей и executable inventory записаны рядом. Итоговое `.qa/wal-budget-replay-evidence.json` также подтверждает read-only сравнением БД точное совпадение `world_hash` и `journal_seq` всех четырёх миров в обоих сценариях. Focused logs: `.qa/checkpoint-reclaim-{red,green,eslint,types}.log`. Базы, raw logs и локальные QA fixtures остаются вне GitHub artifacts.

## Что остаётся неизвестным

В R6 hour последний показанный WAL был 61 960 712 B, то есть ещё меньше hard limit, а исходный `failRoom` не сохранял причину исключения. Его `storageFailures=4` включал также worker, scheduler и stale-authority paths. Поэтому связать конкретный R6 отказ с исправленным дефектом пока нельзя.

В R6 FP01/2D длинная writer operation 1754.367 ms почти совпала с `maxTransactionMs=1754.316796`. Это локализует задержку внутри SQLite transaction; ни per-operation fsync, ни совпадающий checkpoint interval этой трассой не измерены. WAL reclaim не объявляется исправлением этой задержки. Цели latency, полный час, итоговая браузерная приёмка и production capacity сохраняют свои самостоятельные gates.
