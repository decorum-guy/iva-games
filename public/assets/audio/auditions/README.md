# REMORSE — кандидаты SFX для сравнения с настоящими анимациями

Это отдельные записи для выбора звука. Они не подключены к игровому банку; выбор пользователя ещё не сделан. Длительности, геометрия анимаций, правила и профиль игрока не изменены.

Упаковка основана на существующих lossless WAV и манифестах ранее подготовленных подборок R1/R2/P1/P2. Звук при этой работе не проигрывался. Проверены хеши исходников, точность извлечения/пересборки, декодирование, число отсчётов и sample peaks. Оценка звучания остаётся за прослушиванием.

## Четыре общие подборки

Эти MP3 включены в репозиторий для быстрого знакомства. Для синхронизации с одной сценой используйте отдельные файлы из следующей таблицы.

- [R1 — четыре реакции, CC0](R1_Reactions_CC0.mp3).
- [R2 — четыре реакции, JC Sounds](R2_Reactions_JCSounds_CC_BY_4.mp3).
- [P1 — слон/конь, ладья, ферзь, Stone / Lightning](P1_STONE_LIGHTNING_CC0.mp3).
- [P2 — слон/конь, ладья, ферзь, Arc / Stone](P2_ARC_STONE_CC_BY_4.mp3).

Отдельно: [каменный раскол ферзя без удара и молнии](promotion-p1-queen-fracture-only.mp3). Это изолированный слой уже существующего варианта P1, а не новый выбранный звук.

## Отдельные события и тайминг

Все файлы: MP3 192 kbit/s, 48 kHz, stereo. В таблице указана длительность декодированного аудио с учётом gapless-метаданных; контейнерная длительность может быть немного больше. Точные значения, SHA256, размеры, источники и рецепты — в `catalog.json`.

| Событие | Кандидат | Файл | Длительность, с | Привязка внутри клипа, с |
|---|---|---|---:|---|
| `reaction.guilt` | R1 | `reaction-r1-guilt.mp3` | 3.000000 | начало клипа на cue реакции |
| `reaction.devastated` | R1 | `reaction-r1-devastated.mp3` | 2.427417 | начало клипа на cue реакции |
| `reaction.berserk` | R1 | `reaction-r1-berserk.mp3` | 2.997333 | начало клипа на cue реакции |
| `reaction.bloodlust` | R1 | `reaction-r1-bloodlust.mp3` | 3.920833 | начало клипа на cue реакции |
| `reaction.guilt` | R2 | `reaction-r2-guilt.mp3` | 1.433333 | начало клипа на cue реакции |
| `reaction.devastated` | R2 | `reaction-r2-devastated.mp3` | 1.200000 | начало клипа на cue реакции |
| `reaction.berserk` | R2 | `reaction-r2-berserk.mp3` | 1.200000 | начало клипа на cue реакции |
| `reaction.bloodlust` | R2 | `reaction-r2-bloodlust.mp3` | 6.000000 | начало клипа на cue реакции |
| `promotion.formation` | P1 | `promotion-p1-formation.mp3` | 3.000000 | основной слой 0.160 |
| `promotion.rook` | P1 | `promotion-p1-rook.mp3` | 3.500000 | контакт 0.420 |
| `promotion.queen` | P1 | `promotion-p1-queen.mp3` | 5.000000 | контакт 0.420 |
| `promotion.formation` | P2 | `promotion-p2-formation.mp3` | 3.000000 | основной слой 0.120 |
| `promotion.rook` | P2 | `promotion-p2-rook.mp3` | 3.500000 | контакт 0.420 |
| `promotion.queen` | P2 | `promotion-p2-queen.mp3` | 5.000000 | контакт 0.420 |
| `promotion.queen.fracture` | P1-STONE-SOLO | `promotion-p1-queen-fracture-only.mp3` | 3.600000 | контакт 0.420; камень 0.490 |

`formation` — один кандидат и для слона, и для коня. В исходном реакционном исследовании использовано имя `devastation`; здесь оно сопоставлено игровому состоянию `devastated` без изменения аудио.

## Что именно сохранено

Реакции извлечены по точным границам отсчётов из существующих 24-bit WAV-подборок. Убраны только паузы между отдельными записями. Полный звук каждой исходной записи, прежний постоянный gain и пик около −6 dBFS сохранены. Новых fades, обрезки звука, синтеза и нормализации нет. **R2 bloodlust — полный шестисекундный chant для выбора тембра. Его нельзя автоматически устанавливать целиком как игровой cue.** Если он выбран, короткий фрагмент подбирается после прослушивания.

Шесть превращений перекодированы из готовых отдельных 16-bit WAV. Их прежние длительности 3 / 3.5 / 5 с, слои, смещения, обработки и пики около −8 / −5 / −3 dBFS сохранены. Это длительности аудио, а не новые длительности анимаций.

`promotion-p1-queen-fracture-only.mp3` — отдельное прослушивание уже существующего каменного слоя P1 queen. Сначала полная сцена ферзя была пересобрана исходными функциями `build_auditions.py`: результат побитно совпал с прежним 16-bit WAV. Затем сохранены только `break_stone`, `rock_break1`, `rock_break2`, их исходные задержки, обработка и общий gain сцены −0.9143270437807192 dB. Новая нормализация не применялась. Остались контактная отметка 0.420 с и начало первого каменного слоя 0.490 с. Убрана только подтверждённая цифровая тишина 3.600–5.000 с. В этом solo-файле нет звука приземления, молнии, whoosh или низкого взрыва. **Не добавлять его поверх полного P1 queen: там эти каменные слои уже есть.**

## Синхронизация демонстрации

Использовать существующую реальную сцену и её временную шкалу. Не менять длительности анимаций ради кандидата. Реакционный клип начинается на существующем cue раскрытия реакции. Контакт ладьи и ферзя расположен на 0.420 с внутри аудио: `audioStart = visualImpact − 0.420`. Это отметка монтажа, а не подтверждённый на слух transient. Для minor formation основной слой начинается на 0.160 с (P1) или 0.120 с (P2); оба рецепта сохранены в каталоге.

В reduced motion контакт наступает раньше 0.420 с. Исполнитель должен явно выбрать аудио-only offset/pre-roll, синхронизированный с тем же контактом, и указать его в локальной демонстрации. Анимацию растягивать нельзя. На остановке, повторе или смене варианта прекращать голоса предыдущего запуска. Кандидат заменяет только соответствующий звук в локальной демонстрации; параллельно проигрывать штатный аналог нельзя. Хвост аудио не должен задерживать ходы или менять игровой таймер.

Предложенный порядок просмотра: четыре реакции — текущий звук / R1 / R2; затем слон или конь, ладья, ферзь — текущий звук / P1 / P2; отдельно solo разлома; в конце обычная сцена превращения, после которого возникает шах или мат. Профиль, партия, рейтинг и основной банк звуков остаются нетронутыми.

## Источники и лицензии

Точные файлы, хеши исходников, URL загрузки и индивидуальные рецепты перечислены в `catalog.json`. Сведения о лицензиях перенесены из существующих исследовательских манифестов.

- [Energy Drain — qubodup](https://opengameart.org/content/energy-drain), CC0. В исследовании сохранена оговорка автора от 2024-06-23 о переходе к CC0 и неприменимости прежних ограничений внутри архива.
- [3 dark magic spells — qubodup](https://opengameart.org/content/3-dark-magic-spells), CC0.
- [Basic Spell Impacts — lentikula](https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx), CC0.
- [Various Sound Effects — Julie Damsgaard / Spring Spring / Spring Enterprises](https://opengameart.org/content/various-sound-effects-0), CC0.
- [75 CC0 breaking / falling / hit SFX — rubberduck](https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx), CC0.
- [Air whoosh — pyranostudios](https://opengameart.org/content/air-whoosh), CC0.
- [Magic Spell SFX — JaggedStone](https://opengameart.org/content/magic-spell-sfx), CC0.
- [Fantasy SFX Pack Vol 1 — JC Sounds](https://opengameart.org/content/jc-sounds-fantasy-sfx-pack-vol-1), CC BY 4.0. Используется в R2 и P2.

Лицензии: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### Атрибуция для R2

“Fantasy SFX Pack Vol 1” by JC Sounds, licensed under CC BY 4.0. Source: https://opengameart.org/content/jc-sounds-fantasy-sfx-pack-vol-1 . License: https://creativecommons.org/licenses/by/4.0/ . Existing audition edits: resampling to 48 kHz stereo and constant per-clip gain. Individual candidates are exact full-source windows from the lossless comparison WAV, with comparison gaps excluded and MP3 encoding. No source-content trimming, layering or pitch change in R2.

### Атрибуция для P2

Includes audio from “Fantasy SFX Pack Vol 1” by JC Sounds, licensed under CC BY 4.0. Source: https://opengameart.org/content/jc-sounds-fantasy-sfx-pack-vol-1 . License: https://creativecommons.org/licenses/by/4.0/ . Existing audition changes: trimming, resampling, pitch/time changes on selected layers, filtering, fades, gain and layering with additional CC0 audio. Individual candidate packaging adds MP3 encoding from existing lossless scene WAVs without new creative edits.

## Проверки упаковки

Все 15 MP3 декодированы инструментально: длительности совпадают с числом отсчётов входного PCM; NaN/Inf и отсчётов с модулем ≥ 1 нет. Это проверка отсутствия sample clipping в декодированных файлах, не заявление о true peak, воспринимаемой громкости или художественном качестве. Результаты и SHA256 приведены для каждого файла в каталоге.
