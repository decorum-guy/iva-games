# Russian and English in the first release

The owner explicitly requires **complete Russian and English versions in the first release**. This supersedes any earlier suggestion that English is optional or deferred. Implement both without asking the owner to supply translations. These are product and implementation decisions, not rules from the source transcript.

Russian (`ru`) is the default for a fresh profile, including on an English-language browser. Provide a clear **«Рус / EN»** language selector on the home screen and in settings accessible during a game or lesson. Preserve an explicit choice locally and restore it on reload. The selector uses recognizable language names/codes, not flags. Only these two languages are required.

## Complete product coverage

Every player-facing string must have a finished Russian and English version:

| Surface | Required coverage |
|---|---|
| Home and setup | Play modes, player side, all ten bot profiles, approximate rating explanation, Rated/Practice choice, resume/new-game actions and local-profile information. |
| Game HUD | Player/side labels, turn and bonus-action status, selection, legal/illegal-action explanations, promotion choices, draw/resignation controls and dialogs. |
| Captured pieces and material | Row/group labels, accessible piece names, `+N` explanation, empty/custom-root descriptions and friendly-loss explanations. |
| Rating and results | Current/best rating, W/D/L labels, rating changes, provisional-scale explanation, eligibility restrictions, technical aborts and local-storage limitations. |
| Tutorial | All nine lesson titles, every step and substep, coachmarks, action feedback, progress, fixed-die labels, restart/exit/resume and both final choices. |
| Rules and glossary | All source mechanics and the explicit digital decisions exposed in player help, full-cycle timing, precedence, piece exceptions and ordinary-chess help. |
| Event history and die | Captures, reactions, cures, shame, conversion, removal, promotion, bonus/end-turn events and all die outcomes, including previously recorded events. |
| System and accessibility | Loading/empty states, asset/worker/WebGL/storage/import errors, recovery actions, tooltips, aria labels, keyboard help, focus/status announcements and fallback explanations. |

Russian UI examples in the other project documents illustrate copy and behavior; they are **not permission to leave an English surface partly Russian**. Add equivalent English text with the same meaning. English is a complete selectable product language, including tutorials and rules, rather than a machine-translation link or a label-only switch.

Do not translate user-entered nicknames, the REMORSE/Remorse product name, source-author names or URLs. Board coordinates remain `a1`–`h8`. Stable command, piece, lesson, state and event IDs, schema versions and canonical move notation remain language-independent. Use standard chess terminology for ordinary pieces: in Russian, the knight is **«конь»**, not «рыцарь»; English uses **knight**. Piece names and explanatory prose are localized around stable coordinates/notation.

## Shared terminology

Use one glossary in HUD badges, rules, tutorial, history and accessibility strings. These Russian choices preserve the terminology already used in the project; sentence wording may inflect naturally without inventing another name for the same mechanic.

| Semantic concept / original term | Russian display term | English display term |
|---|---|---|
| Guilt / guilt-ridden | Вина | Guilt-ridden |
| Devastation / devastated | Опустошение | Devastated |
| Berserk | Ярость | Berserk |
| Bloodlust | Жажда крови | Bloodlust |
| Absolution | Отпущение вины | Absolution |
| Shame | Стыд | Shame |
| Conversion | Обращение | Conversion |
| Rally the Troops | Сбор войск | Rally the Troops |
| Mercy capture | Милосердное взятие | Mercy capture |
| Self-removal | Исчезновение | Self-removal |
| Promotion | Превращение | Promotion |
| Unaffected capture reaction | Без изменений | Unaffected |

Explain «Обращение / Conversion» as a change of army and «Превращение / Promotion» as a change of pawn type; never use these interchangeably. Explain «Отпущение вины / Absolution» in plain words as the bishop clearing guilt or devastation. An unaffected **remembered reaction** is distinct from a figure's current neutral state. Preserve that distinction in both languages.

Use a separate message for complete sentences when Russian grammatical gender/case makes assembly awkward. For example, a history presenter can use a neutral construction such as «Взятие: …» rather than concatenating fragments with the wrong agreement. Do not build English sentences by replacing isolated Russian words.

Some paired copy to establish tone:

| Russian | English |
|---|---|
| Играть с ИИ | Play against AI |
| Вдвоем | Two players |
| Обучение | Tutorial |
| Рейтинговая | Rated |
| Тренировка | Practice |
| Завершить ход | End turn |
| Учебный бросок: результат задан для примера | Tutorial roll: a fixed result for this example |
| Продолжить эту партию | Continue this game |
| С текущей учебной позиции, без подсказок · тренировка | From this tutorial position, without guidance · practice |
| Начать новую партию | Start a new game |
| Условный баланс фигур на доске. Не учитывает состояния и позицию | Conventional material balance on the board. Does not account for piece states or position |

These examples are not the entire catalog. Translate every remaining required surface with equally concise, natural wording.

## Locale is presentation only

The locale preference belongs to presentation/settings, outside the authoritative game state and replay hash. Changing it must not start a new game, tick a turn, increment a game revision, reroll a die, consume RNG, settle a rating, change a preset, alter a capture ledger or append a gameplay event.

Keep semantic codes and structured parameters in saves/events rather than already translated text. For example, a capture stores its existing victim/capturer snapshot and squares; the presenter maps the event type and parameters to the active catalog. A rule rejection stores/returns a stable reason code and relevant values. Tutorial objectives use stable lesson/step IDs and core events, never comparison with translated labels. Map or migrate older semantic codes explicitly when needed.

After a language change, **existing history** and the currently visible explanation/result must render in the new language without modifying the recorded facts. Preserve user nicknames as entered. Importing a game does not silently override the viewer's chosen language. Source-file metadata and original evidence remain unchanged.

Do not key/remount the application, game session, Web Worker, scene or tutorial controller by locale. A pending AI response retains its request identity and remains valid; an in-progress tutorial retains its current lesson, step, highlighted targets, fixed-roll provider and scheduled command identities. A pending die still reveals the same committed face. Preserve the current selection, promotion dialog, bonus phase and camera; update text and reposition overlays if their dimensions change.

Locale changes can trigger layout measurement and accessible status feedback, but cannot replay an effect or re-execute a scripted move. Do not announce the entire event history again through a live region just because its language changed. Set the document's `lang` attribute and localized accessible labels appropriately.

## Catalog implementation and checks

Use two explicit local message catalogs with stable, typed keys or an equivalent maintained i18n implementation. No translation service, API key or runtime machine translation is needed. Useful namespaces are `common`, `setup`, `game`, `pieces`, `states`, `events`, `tutorial`, `rules`, `rating`, `errors` and `accessibility`; names may be adjusted while preserving clear ownership.

Both languages must cover the same **semantic message keys** with compatible parameter contracts. Keep plural forms in the chosen library's supported format. Russian and English legitimately require different plural branches; compare normalized semantic keys and validate each locale's own required forms rather than forcing identical plural-suffix lists.

Provide an automated catalog validation command and include it in `npm run check`. It must reject missing/blank entries, unknown lookups, incompatible interpolation parameters and incomplete plural handling. Typed keys plus tests should cover dynamic event/state/lesson mappings. An English screen silently falling back to Russian does not pass validation. In a production error path, show a safe localized generic error if necessary; do not expose a raw key or stack trace to the player. Record missing-key diagnostics for development and fix them before delivery.

Use `Intl.PluralRules`, `Intl.NumberFormat` and `Intl.DateTimeFormat`, or the chosen library's equivalent locale-aware message formatting. Verify Russian examples for 1, 2, 5, 11, 21 and 22, and English singular/plural behavior. Format complete messages such as remaining full cycles and captured-piece counts; do not append a fixed noun to every number. Keep the documented Elo calculation/rounding unchanged: localization formats its result and never recalculates it. Store numeric values and timestamps canonically, then format at the presentation boundary.

Keep both modest catalogs locally available so a midgame switch cannot depend on an external request. Avoid untranslated strings baked into textures, images or generated SVG. Piece silhouettes, die pips and the wordmark can remain language-neutral; their accessible names and surrounding labels are localized.

## Layout and accessibility

Use fonts with complete Cyrillic and Latin coverage, including Russian «ё», punctuation, numerals and symbols used by ratings and material. Verify actual glyph rendering and font loading; mojibake, missing-glyph boxes and fallback font jumps are defects.

Give buttons, lesson panels, result cards, tooltips and rule dialogs room for both languages. Wrap by words and let an explanation grow or scroll where appropriate; do not shrink text until it is unreadable or truncate the required action. Recompute coachmark placement after a switch. The selected piece, requested square, promotion choices and bonus control must remain accessible at 360×800 and 390×844 in both languages.

Keep the language selector keyboard- and touch-accessible. Localize accessible names, dialog titles, validation feedback and relevant announcements, including the 2D board. A letter-only button must still expose an understandable accessible label in the selected language. Keyboard shortcuts use stable actions; their descriptions are translated.

## Required verification

These are checks for the implementing agent; this preparation document does not claim they have passed.

1. A fresh profile opens in Russian; selecting English persists across reload. Both controls reach the same preference, including the in-game settings control.
2. Catalog validation is strict for both locales: no missing/blank key, untranslated fallback, raw key, mismatched placeholder or broken plural branch. Review natural wording and glossary consistency, not only key counts.
3. Inspect home/setup, all bot labels, both play modes, rating/result views, captured rows and material help, rules, history, loading/error/recovery states and accessibility labels in **both** languages.
4. Drive every tutorial lesson and both finish choices with the real UI in both locales, reusing the same deterministic fixtures where appropriate. The glossary and all substep explanations are translated; ordinary game logic does not need a duplicated implementation per locale.
5. Switch RU→EN→RU midgame, during AI thinking, at a pending promotion/bonus and during a tutorial step/die reveal. Compare authoritative state, revision, RNG cursor, capture ledger, active request IDs and lesson progress before/after: only presentation/preference may change. Let the pending work finish and verify it commits exactly once.
6. Switch after capture/conversion/removal and after a completed rated result. Previously recorded history/result text changes language while saved facts and rating ledger remain unchanged. Reload/export/import preserves the same gameplay data and the correct local language preference.
7. Inspect laptop and both phone sizes in each language, including the crowded phone state from `ART_DIRECTION.md`, long text, orientation change, reduced motion and 2D fallback. No required target or finish action is covered or clipped by translation length.
8. Check the language selector, dialogs and board help with keyboard focus and localized accessible labels. Test representative singular/plural counts and numeric/date formatting separately from rules tests.

Debug logs, code identifiers, engineering documentation and the supplied original English PDF/transcript do **not** need translation. Player-facing help explaining that source and the implemented digital decisions does. Do not alter the source PDF to create an apparent translated original, and do not expand this release to a third language.
