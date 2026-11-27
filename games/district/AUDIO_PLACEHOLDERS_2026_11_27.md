# Район — звуковые плейсхолдеры и проверка, 27 ноября 2026

## Состояние

В рабочую версию добавлен отдельный локальный банк **56 коротких WAV**, включая **45 стадий всех 25 семейств новостей** и 11 игровых подтверждений. Реальные исходники — CC0-записи Kenney, LisadiKaprio и OwlStorm; дополнительные шумовые, ритмические и тональные слои созданы процедурно для Района. Звук Colonist и принятые звуки шахмат не использованы.

Это выполненная техническая подготовка, **не слуховая приёмка**. Автор этого изменения не прослушивал звук через реальный аудиоканал. Настройки, анализ PCM, успешное декодирование и тесты не подтверждают тембр, узнаваемость или комфортную громкость на устройствах владельца.

## Первичные источники и лицензии

- **K — Kenney, Impact Sounds 1.0.** [Страница издателя](https://kenney.nl/assets/impact-sounds) указывает CC0. Из реально скачанного архива сохранены девять используемых OGG и оригинальный `License.txt`.
- **W — LisadiKaprio, Short Whisper / 584650.** [Страница записи](https://freesound.org/people/LisadiKaprio/sounds/584650/) указывает CC0. Скачан публичный HQ preview. Это короткий человеческий шёпот без определённого слова; в `H04-forecast` он смешан тихо.
- **C — OwlStorm / Ashe Kirk.** [Cough (2) / 151212](https://freesound.org/people/OwlStorm/sounds/151212/) и [Cough Female / 151213](https://freesound.org/people/OwlStorm/sounds/151213/) указывают CC0. Скачаны публичные HQ preview. Короткий коллаж кашля для E01 собран из двух отдельных записей; он не является документальной записью толпы.
- **P — исходные процедурные композиции и аранжировки проекта.** Генератор `scripts/build-district-audio.py`; выделены под CC0-1.0. Погодные, механические, животные и водные текстуры синтезированы: им не приписываются реальные полевые записи.

Страницы источников и [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) прочитаны 27 ноября 2026. [Публичные кредиты](../../apps/portal/public/assets/district/audio/CREDITS.md), [лицензия банка](../../apps/portal/public/assets/district/audio/LICENSE.txt) и [машиночитаемый манифест](../../apps/portal/public/assets/district/audio/manifest.json) содержат происхождение, названия исходных файлов, обработку и SHA-256. Для каждого cue манифест перечисляет точные использованные исходники.

## Семейство → стадия → cue → источник

Файлы находятся в `apps/portal/public/assets/district/audio/`. Таблица содержит только стадии, которые реально публикует действующий каталог. Звуки не создают несуществующих прогнозов для одноступенчатых событий.

| Семейство | Стадия и файл | Источник и лицензия |
| --- | --- | --- |
| G01 · Ore discovery | `applied` → `G01-applied.wav` | K: Kenney CC0 |
| G02 · Supply trucks | `applied` → `G02-applied.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| G03 · Harvest | `applied` → `G03-applied.wav` | P: original synthesis, CC0 |
| G04 · Renovation | `applied` → `G04-applied.wav` | K: Kenney CC0 |
| G05 · Port trade fair | `applied` → `G05-applied.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| G06 · Funded roads | `applied` → `G06-applied.wav` | K: Kenney CC0 |
| G07 · Building subsidy | `applied` → `G07-applied.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| G08 · University grant | `applied` → `G08-applied.wav` | P: original synthesis, CC0 |
| G09 · Exchange fair | `applied` → `G09-applied.wav` | K: Kenney CC0 |
| G10 · Repair fund | `applied` → `G10-applied.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| B01 · Street dogs | `applied` → `B01-applied.wav` | P: original synthesis, CC0 |
| B02 · Work crews sick | `applied` → `B02-applied.wav` | K: Kenney CC0; C: OwlStorm CC0 |
| B03 · Granary pests | `applied` → `B03-applied.wav` | P: original synthesis, CC0 |
| B04 · Port storm | `applied` → `B04-applied.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| B05 · Rain on building sites | `applied` → `B05-applied.wav` | P: original synthesis, CC0 |
| B06 · Delayed roadworks | `applied` → `B06-applied.wav` | K: Kenney CC0 |
| B07 · Cranes stopped by wind | `applied` → `B07-applied.wav` | P: original synthesis, CC0 |
| B08 · Harbour fog | `applied` → `B08-applied.wav` | P: original synthesis, CC0 |
| H01 · Wildfire | `forecast` → `H01-forecast.wav`; `confirmed` → `H01-confirmed.wav`; `applied` → `H01-applied.wav`; `cancelled` → `H01-cancelled.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| H02 · River flood | `forecast` → `H02-forecast.wav`; `confirmed` → `H02-confirmed.wav`; `applied` → `H02-applied.wav`; `cancelled` → `H02-cancelled.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| H03 · Tsunami | `forecast` → `H03-forecast.wav`; `confirmed` → `H03-confirmed.wav`; `applied` → `H03-applied.wav`; `cancelled` → `H03-cancelled.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| H04 · Meteor | `forecast` → `H04-forecast.wav`; `confirmed` → `H04-confirmed.wav`; `applied` → `H04-applied.wav`; `cancelled` → `H04-cancelled.wav` | K: Kenney CC0; W: LisadiKaprio CC0; P: original synthesis, CC0 |
| P01 · Oil exploration | `applied` → `P01-applied.wav`; `success` → `P01-success.wav`; `cancelled` → `P01-cancelled.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| P02 · City funding | `applied` → `P02-applied.wav`; `success` → `P02-success.wav`; `cancelled` → `P02-cancelled.wav` | K: Kenney CC0; P: original synthesis, CC0 |
| E01 · Fictional epidemic | `applied` → `E01-applied.wav`; `forecast` → `E01-forecast.wav`; `update` → `E01-update.wav`; `success` → `E01-success.wav`; `cancelled` → `E01-cancelled.wav` | K: Kenney CC0; C: OwlStorm CC0; P: original synthesis, CC0 |

У H01/H02/H03 тихая короткая текстура прогноза усиливается на подтверждении; наступление получает удар или всплеск, отмена — затухание. H04 использует настоящий шёпот на прогнозе, отдельное подтверждение траектории, компактный удар и проход мимо. P01 отличается механическим ритмом разведки: успех и остановка имеют разные окончания. E01 различает локальную вспышку, прогноз, обновление риска, состоявшееся распространение и локализацию. Звук выбирается по уже опубликованным `templateId` и `stage`, а не по скрытому исходу цепочки.

## Действия на столе

| Действие | Файл | Основа |
| --- | --- | --- |
| Размещение дома в расстановке и обычная стройка | `house.wav` | Деревянный контакт и лёгкий стук крыши, K |
| Дорога | `road.wav` | Два контакта камня и короткая крошка, K+P |
| Улучшение | `upgrade.wav` | Три разных строительных контакта, K |
| Бросок | `roll.wav` | Серия деревянных контактов с замедлением, K |
| Раздача | `production.wav` | Шорох карточек и два лёгких контакта, K+P |
| Исполненная сделка или обмен банка | `trade.wav` | Парные металлические контакты и завершающий стук, K |
| Покупка/применение карты | `card.wav` | Шорох и контакт, K+P |
| Перенос блокады | `blockade.wav` | Низкий металлический контакт, K |
| Победа по очкам | `win.wav` | Короткое трёхнотное окончание, K+P |
| Начало собственного хода | `turn.wav` | Два мягких деревянных контакта, K |
| Получено предложение сделки | `offer.wav` | Короткий бумажный шорох, K+P |

Размещение, дороги и улучшения берутся из подтверждённой истории, включая действия бота. Отправка ещё не принятой сделки не воспроизводит `trade.wav`; принятие и банк подтверждаются отдельными записями. Запись `offer-closed` не дублирует звук уже исполненного `accept`.

## Поведение проигрывателя

`useTerritorialAudio(view, { enabled, master, effects, news })` использует отдельные группы эффектов и новостей. Значения громкости — 0–1, несуществующего музыкального канала нет. Аудиоконтекст создаётся/разблокируется только после нажатия или клавиши. По умолчанию звук выключен. Ручное «Проверить звук» вызывает `preview`.

Первый снимок матча — тихая начальная отметка. ID обработанных записей привязаны к матчу и участнику, сохраняются в sessionStorage; повторный снимок, выбор клетки и открытие журнала не запускают их снова. Возврат видимости, offline/online и длительный разрыв устанавливают новую тихую отметку. Несколько новых ревизий за один обычный poll обрабатываются без требования «строго +1», поэтому короткая цепочка действий бота не теряется только из-за частоты опроса.

Одновременно играют не более одного эффекта и одной новости; очереди ограничены. Угрозы и эпидемия имеют приоритет в одновременном выпуске. Очередь не может долго догонять старую игру: запросы старше четырёх секунд отбрасываются. Mute прекращает активный звук и очередь. Все сетевые загрузки идут с того же сайта; внешние Freesound/Kenney URL используются только как происхождение в манифесте.

## Выполненная проверка

- Генератор выполнен: 56 файлов, 2 580 106 байт WAV, PCM 16 bit, mono, 22 050 Hz; максимальная длина 1,65 с; численный пик не превышает 0,52.
- Семь проверок `territorialAudio.test.ts` прошли: реальные переходы дома/дороги через rules core, пропущенные poll-ревизии, повтор, reload, reconnect, невидимая вкладка, журнал, muted-курсор, различение прогноза и эффекта, приватная адресность предложения, соответствие всех стадий реальному каталогу, форматы и хеши исходников/клипов.
- Отдельные TypeScript (strict, Vite/DOM/Node types) и ESLint модуля и тестов прошли. Интеграционную сборку и браузерные результаты следует читать в итоговом отчёте переработки; этот документ не объявляет их выполненными заранее.

Воспроизведение: `python scripts/build-district-audio.py` (Python 3 и ffmpeg), затем `npx vitest run --config apps/portal/vitest.config.ts src/territorialAudio.test.ts`.

## Техническая интеграция в Chromium

Добавлен воспроизводитель `scripts/district-audio-browser.mjs`. Он запускает реальный сервер на loopback с отдельной SQLite, копией собранного портала и явно тестовыми позициями. Вызовы игровых API и аудиобуферы не подменяются. Наблюдатели вокруг `Response.arrayBuffer`, `decodeAudioData`, `AudioBufferSourceNode.start/stop` вызывают исходные методы браузера; звук в headless-выходе намеренно выключен флагом `--mute-audio`.

Финальный прогон в Chromium **158.0.8127.0** прошёл **11 проверок**, без `pageerror`. Основа исходников — локальный commit `1941ae633116a6bf5ba47d8b54a986d63b21fb66`; сценарий QA добавлен отдельно. Сверены байты JS/CSS, реально полученные браузером, с отдельной копией сборки. Модуль стола — `TerritorialDistrict-DPs8tcaf.js`, SHA-256 `ac0bdf917dfbbc0adaefe284bea11effa0fecbe758ac272e2569a2528077d6d1`; сервер — `9fca37ee6bcf429cdd669f696b203a847ab36a6009703bb1d4b115d9d46906b6`. Проверено:

- Разрешение звука в Settings запускает настоящий AudioContext; выключенный preview не играет, mute останавливает текущий источник.
- Все 56 WAV получены с `audio/wav`, совпали с SHA-256 манифеста и декодировались браузером. Длительности и число каналов соответствуют файлам; текущий AudioContext декодирует их на своей частоте 44,1 кГц.
- Настоящие действия над SQLite через UI и HTTP запустили `house`, `road`, `upgrade`, `roll`, `production`, `trade`; расстановка ботов также дала дом, дорогу и раздачу.
- Следующая опубликованная стадия реальной цепочки E01 запустила `E01-update`. Повторный опрос, открытие истории ходов и журнала новостей не повторили её.
- Действие во время mute осталось обработанным после включения. Reload с сохранённым включённым звуком и новый пользовательский жест не проиграли прежнюю историю. Настоящее переключение браузерной сети offline/online тихо установило исходную отметку для предложения, пришедшего во время разрыва. Следующее новое входящее предложение воспроизвело `offer` один раз.

В этом же прогоне шесть действий ботов в расстановке наблюдались через HTTP с настоящим `Date.now()`: **861, 866, 1130, 953, 1190 и 1188 мс**. Первое значение — от начала измерения до наблюдения первого действия; остальные — между наблюдениями последующих действий. Опрос выполнялся примерно каждые 80 мс параллельно обычному UI-опросу 1100 мс; верхняя измеренная задержка от сохранённого `scheduledAt` до наблюдения — **75 мс**. Точный момент исполнения ограничен соседними наблюдениями и отдельно сервером не записан. Это не controlled-clock измерение и не замер обычного хода или полной партии.

Запуск: `npm run build:portal`, затем `node scripts/district-audio-browser.mjs`. Полные результаты, нативные наблюдения, хеши сборки и HTTP-времена сохраняются только в игнорируемом `.qa/district-feedback/run-*/audio-browser/`. Техническая интеграция не подтверждает слышимость, тембр, комфортную громкость, Safari или Яндекс Браузер.

Остаётся прослушать дом/дорогу/улучшение, раздачу/сделку и стадии H04/E01/P01 на реальном аудиовыходе, затем все 25 семейств на выбранной общей громкости. Проверить слышимость при расстановке ботов и отсутствие навязчивого наложения. Принятие этого банка владельцем пока не зафиксировано.
