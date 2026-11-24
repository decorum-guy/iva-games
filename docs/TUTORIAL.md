# Mandatory interactive play-through tutorial

The project owner explicitly requested learning **by playing on the board**, fixed educational dice where useful, and a choice to continue the resulting game or start a new one. This is a required product feature.

The lesson structure below is our design. Its rules come from the supplied transcript plus `RULES_DIGITAL_V1.md`. Implement it through the **same core, legal-command API, events and animations** as a normal game.

## Format and interface

Use nine short, named training positions in one coherent tutorial session. Start with an actual normal initial position. Later curated positions let the player see every mechanic without an excessively long forced match. Announce each reset clearly as **«Следующая учебная позиция»**. Do not pretend that a fixture reset is an ordinary move or that the entire session is one historically continuous game.

Offer «Пройти обучение» and «Сразу играть» at first entry. Learning remains available from the menu. Save progress and the active lesson state so refresh can resume correctly. Keep the active normal match in a separate save slot/session; entering learning must not overwrite it, and leaving learning allows the original match to resume.

Tutorials and every continuation from a tutorial are **practice**, never rated, including after reload. Opening learning only suspends an existing rated match; it must neither award Elo nor silently resign, replace or downgrade that match. Follow the active-match policy in `RATING_AND_DIFFICULTY.md` when the player later starts or resumes ordinary play.

## Complete Russian and English coverage

Both **Russian (`ru`) and English (`en`) are mandatory in the first release**, following `LOCALIZATION.md`. Russian wording elsewhere in this brief is an illustrative source string, not permission to leave its English equivalent missing. The entire tutorial must have complete authored text in both locale catalogs: lesson names, every coachmark and step explanation, action/target instructions, buttons, progress labels, rule help, piece/state tooltips, dice notices, invalid-action explanations, accessibility labels, errors, exit/restart dialogs and both finish paths. Translating only the navigation or lesson titles is insufficient. Do not show raw catalog keys or silently fall back to Russian in an English lesson.

Use stable language-independent lesson/step/objective IDs and catalog keys. Scenario branching, expected actions, fixed-roll matching and progress must never depend on translated titles or text comparisons. Interpolate piece names, sides, squares and counters with localized terms and suitable plural forms instead of concatenating untranslated fragments. The original PDF/transcript and normative rules document need not be duplicated in translation; all corresponding **in-game** rule explanations and digital exceptions must be available in both languages.

Allow language switching during any lesson through the common language control. It changes presentation only: preserve the lesson/step, targets, selected piece, board, timers, dice/RNG position, pending decision, event history and completed objectives. Do not restart the controller, replay an event, consume another educational die, add a repetition occurrence or award completion again. Reposition/reflow the translated coachmark without blocking its target, including on a phone; restore appropriate keyboard focus. Refresh resumes the same step in the user's selected language.

Representative fixed catalog entries to implement consistently:

| Stable purpose/key | Русский | English |
|---|---|---|
| `tutorial.start` | Пройти обучение | Start tutorial |
| `tutorial.skip` | Сразу играть | Play now |
| `tutorial.try` | Попробовать | Try it |
| `tutorial.repeat` | Повторить объяснение | Repeat explanation |
| `tutorial.restartLesson` | Начать урок заново | Restart lesson |
| `tutorial.exit` | Выйти из обучения | Exit tutorial |
| `tutorial.nextPosition` | Следующая учебная позиция | Next training position |
| `tutorial.progress` | Урок {current} из {total} | Lesson {current} of {total} |
| `tutorial.allowedButNotTarget` | Этот ход разрешен, но сейчас попробуем выделенный ход | That move is legal, but let’s try the highlighted move for this step |
| `tutorial.finish.continue` | Продолжить эту партию | Continue this game |
| `tutorial.finish.continueDetail` | С текущей учебной позиции, без подсказок · тренировка | From this training position, without guidance · practice |
| `tutorial.finish.newGame` | Начать новую партию | New game |
| `tutorial.practiceNotice` | Учебная партия не меняет ваш рейтинг | This training game does not change your rating |

These entries are not the complete catalog: author the full ru/en text of every implemented step and contextual explanation once the verified lesson fixtures determine their exact actions.

## Guided steps and interaction

Each teaching step has:

1. One short coachmark explaining the current idea and intended action.
2. A highlighted source piece, target square and subtle directional cue.
3. A real player action accepted by the normal rules core.
4. A real, validated scripted opponent response when necessary.
5. The real effect animation and a concise required explanation of its cause, result and practical rule, held until acknowledgement.

Use one anchored modal/coachmark at a time with a spotlight, one idea, one expected action and about 1–3 short sentences. Show lesson/step progress and put optional exceptions in expandable help. The first dice mapping, cause of an emotion, its functional rule and the timer's unit are required learning content, never optional-only detail. Release board interaction when the step asks for a move; pointer events must reach the highlighted target through the spotlight. Reposition the callout after camera/viewport changes if it would cover the source, destination or promotion controls. On a phone use a compact bottom sheet and a fitted board/camera; never shrink the desktop coachmark until its text or target is unusable.

Support keyboard focus, touch, 2D and reduced motion. Supply «Повторить объяснение», «Начать урок заново» and exit controls. Do not allow a modal, AI request or missing animation event to trap the player.

Some steps can restrict input to their educational goal. If another move is legal, explain «Этот ход разрешен, но сейчас попробуем выделенный ход». Reserve “illegal” explanations for real rule violations. An invalid-action teaching step does not mutate the game.

## Lesson sequence

The exact coordinates beyond the first example must be constructed and **verified by executable fixtures**, not invented in documentation and assumed legal. Each fixture includes exactly one king per side, no unpromoted pawn on rank 1/8, coherent movement rights and a legal nonterminal state unless it is explicitly demonstrating a terminal rule. A new fixture starts its own capture ledger and repetition context: count its stable root once, never import occurrences or captures from a previous lesson, and do not count refresh/resume as another occurrence.

| Lesson | Required actual interaction and observable result |
|---|---|
| 1. Первое взятие | Start from normal setup. A simple verified sequence such as `e4`, `…d5`, `exd5` can introduce selection, legal targets, taking turns and a tutorial die of 4. Explain checkmate as the goal, all d6 outcomes, and that the rolled reaction stays with that figure. Point to the static captured-pawn icon under the capturer's nickname and explain the separate conventional `+N` material badge. |
| 2. Вина | Make a real capture with a scripted 2 or 3. Try a forbidden capture with the guilty piece and receive the correct explanation; make an allowed quiet move. Demonstrate that it no longer checks but still occupies/blockades its square. |
| 3. Опустошение и милосердие | Capture with a scripted 1. Inspect immobility and the exact countdown. In prepared substeps, capture a devastated non-bishop without a reaction and let another unsaved devastated piece expire. The actual enemy capture adds its usual icon; self-removal changes material without crediting a capture to either side. Advance time with real legal moves, not a hidden pass/advance-timer command. |
| 4. Помощь слона | Move a friendly bishop next to two afflicted pieces and observe both cures after the correct full-cycle delay. Make a later capture with a cured piece to demonstrate remembered reaction without reroll. Demonstrate bishop pacifism, then a normal piece capturing a bishop and becoming devastated. |
| 5. Стыд и обращение | Move a bishop beside an enemy; observe guilt → devastation → ownership conversion at actual deadlines. Demonstrate cancellation by a bishop friendly to a target and its delayed healing. Use a converted piece to show rebirth and a newly assigned reaction. Explain no stacking and berserk immunity through visible examples/contextual inspection. Point out that conversion changes the current material balance without creating a captured-piece icon. |
| 6. Король собирает войска | Safely move the king next to friendly guilt/devastation and observe immediate cure. Make a safe king capture without a roll. A neighboring berserker stays unchanged. Explain own-king safety, friendly-only rally and why no king can be captured. |
| 7. Конь, ярость и жажда крови | A knight gets a first free capture, then scripted 6 on its second. Use the earned second action; the third total capture triggers bloodlust. Show capture-only movement, a legal friendly non-king capture, maximum two actions, and deliberately decline one available bonus. The friendly capture is a recorded own loss, not an enemy trophy under the nickname. Demonstrate that a berserker can capture a bishop without devastation. |
| 8. Превращение | Use two short subpositions/pawns to demonstrate inherited reaction/affliction for Q/R/N and cleansing rebirth on bishop promotion. Use the real Q/R/B/N chooser before any capture-roll reveal. Explain that counts/reactions are not erased by knight promotion and that promotion changes `+N` without adding a captured-pawn icon. |
| 9. Последнее решение с подсказкой | Provide a legal mixed middlegame with relevant states, several allowed choices and optional contextual help. The learner chooses a legal move, and the tutorial opponent responds legally. End on a live, nonterminal complete-turn boundary that can be continued as an actual game. |

Lessons may contain small substeps, but avoid long blocks of passive reading. Reuse state inspection for minor exceptions instead of making a separate screen for each rule. Explain the two-player-turn timing definition early and show that a berserk bonus does not tick it.

Use stable lesson IDs with these localized titles; all internal substeps also need stable IDs and complete ru/en copy:

| Lesson ID | Русский | English |
|---|---|---|
| `first-capture` | Первое взятие | First capture |
| `guilt` | Вина | Guilt |
| `devastation-mercy` | Опустошение и милосердие | Devastation and mercy |
| `bishop-help` | Помощь слона | Help from a bishop |
| `shame-conversion` | Стыд и обращение | Shame and conversion |
| `king-rally` | Король собирает войска | The king rallies the troops |
| `knight-berserk-bloodlust` | Конь, ярость и жажда крови | Knight, berserk, and bloodlust |
| `promotion` | Превращение | Promotion |
| `final-decision` | Последнее решение с подсказкой | One last guided decision |

Keep the two nickname/captured-piece rows visible throughout the teaching scene, following `CAPTURED_PIECES_AND_MATERIAL.md`. These are ordinary static HUD icons, not a new flying-trophy animation. Explain `+N` as current-board material using P1/N3/B3/R5/Q9, excluding kings and without adjusting for afflictions. It is neither an engine evaluation nor Elo, and it is not calculated from the capture icons. Reuse the real lesson events above to teach the differences; do not add unrelated forced moves just for this display.

Ordinary castling, en passant, pawn movement, check and checkmate are available in contextual basic-chess help with verified examples. Additional playable basics lessons are optional only after all mandatory acceptance gates pass. Include the digital precedence decisions in a collapsible appendix, with links from relevant lessons. The Remorse-specific rules must all appear in the main learning coverage table.

## Scripted play and randomness

Disable the ordinary AI controller during directed lessons. A `TutorialController` submits scripted opponent moves through the same legality and command path as a human/AI seat. A scripted move that becomes illegal is a scenario error to fix, not permission to force the board.

Use an injected **`TutorialRollProvider`**, separate from the ordinary provider. The owner explicitly removed preset-dice notices from the interface: do not explain predetermined rolls in a label, modal, coachmark or event-log prefix. Bind each planned result to lesson ID, step ID, expected capturer/target and command/chance-event identity. Unexpected captures must not silently consume the next queued number.

### Playtest corrections

- Keep each instruction concise while teaching the actual reason and rule. Hold the new result before an opponent demonstration or another exercise; do not replace explanation with coordinates. State clearly whether the player should read, select, move, or press the primary button.
- On `read` and completed-position steps, hide move affordances and prevent dragging. A legal chess move must not be advertised while the tutorial expects a UI transition. The primary button stays in the viewport.
- Selecting a counter in an `inspect` step does not immediately launch the next scripted turn. Show the count, allow a camera close-up, and advance only after «Понятно» / “Got it”. The controller IDs and old checkpoints remain compatible.
- Use authored focus targets for the current event/inspection; never zoom to an empty/removed figure or scan old events after an exercise. Start focus at the die's settled reveal, together with the material state and required result text. Keep the surface emphasis strong through camera arrival, then show the counter and return to the board before the next action. Input and scripts wait for that return, including transitions to a new prepared position.
- Fit the board and essential instructions in one dynamic viewport on laptops and phones. Only deliberately opened secondary details may scroll internally.

### Required result checkpoints

`Step.after` supplies authored bilingual `TeachingBeat` observations attached to completed actions. `pendingTeaching` is saved independently of the underlying next step. While a beat is pending, no next instruction, script or board exercise is available. Acknowledgement changes learning progress only; it cannot roll, settle a turn or modify the authoritative game. Correct requested illegal attempts also use a held, constructive rule explanation without replaying the previous action.

Preserve old step IDs, order and fixtures. Version-1 saves without the optional field resume their existing index without retroactively injecting old observations. Validate new pending references against the completed source step and committed action. The last beat may directly advance an otherwise empty position boundary in one Cabinet persistence operation. A failed save retains the old position and explanation. See [the current review](TUTORIAL_CLARITY_REVIEW.md) and [Mac completion brief](../prompts/FINISH_TUTORIAL.md).

No hidden production setting such as `forceNextRoll` may survive lesson completion. Save tutorial state as tutorial state; an imported normal save must not accidentally reactivate a script. Reject or explicitly route tutorial-save imports to the tutorial controller.

Use objective/event predicates rather than arbitrary delays: e.g. a cure event for a particular piece, a completed-turn serial, a selected promotion, or a validated illegal-attempt explanation. Presentation completion may coordinate the next explanation but cannot create a rule outcome. Reduced motion must still emit the completion signal. Restart/exit cancels all obsolete scheduled commands and presentation waits.

## Finish and continue

The final tutorial checkpoint must be legal, nonterminal, at a completed-turn boundary, with at least one legal action and no pending roll, promotion or bonus.

Show two real actions:

- **«Продолжить эту партию»**, with subtitle «С текущей учебной позиции, без подсказок · тренировка». Keep every board position, type, owner, reaction, affliction, capture count, right, en-passant field, timer and side-to-move exactly as it is. Destroy the tutorial controller/roll queue, invalidate outstanding tasks, connect the ordinary RNG for future rolls and the actual **level 4 bot, ≈1000 Elo Remorse**, on the opposing seat. This continuation is always practice and cannot change the player's Elo. Record a session handoff event, which does not tick a turn or add a repetition occurrence. The already observed educational outcomes remain part of the game's history.
- **«Начать новую партию»**. Open normal setup for AI or two local players; AI setup includes Rated/Practice, the human's side and the bot level under `RATING_AND_DIFFICULTY.md`. Only after confirming setup create a clean standard position with normal randomness and reset game metadata. Canceling setup returns to the final tutorial screen without changing the lesson position/progress, another normal/rated save, the profile or its history. Preserve the user's preferences and completed-learning flag. Do not transfer tutorial constraints or silently replace an existing active rated match.

Do not finish with checkmate and then offer an impossible continuation. Do not silently start a new board behind the Continue button. Do not randomize/reassign existing reactions when switching providers.

Create the practice game's root checkpoint and undo lower bound at this handoff. Preserve **only the final lesson position's** real capture ledger as an immutable root ledger and its existing repetition context as the root repetition context; neither earlier lessons nor an extra artificial occurrence belong in it. Append later ordinary events and completed-turn occurrences normally. Keep earlier tutorial history read-only for explanation, but practice undo/replay must never cross lesson fixture resets or revive a destroyed tutorial controller. Undo restores the active branch's RNG, ledger and repetition counts without re-counting the restored position. Preserve the previous normal match, including any suspended rated match, as a recoverable checkpoint in a separate slot.

For early exit, offer leaving to the home screen or continuing the **current stable** teaching position as practice, using the same root-ledger, repetition and controller-handoff rules. If the position is in a pending controlled transition, resolve/cancel that transition coherently before offering free play; do not allow a half-resolved state to escape. This option never grants undo in a separate rated match or turns a rated match into practice.

## Verification

Create a lesson manifest connecting each source rule/digital rule to a step, actual action or explicit contextual explanation. Mechanically verify all fixtures and scripted legal commands through the core. Then drive the entire tutorial through real browser controls, including piece/square clicks, promotion selection and final buttons.

Required checks:

1. All forced outcomes produce actual core events; lessons do not directly set an affliction to fake a demonstration.
2. Cure, shame, conversion and removal use real completed turns and correct timing.
3. Both the strict and open-ended lesson branches finish without deadlock.
4. Restart lesson, repeat explanation, refresh/resume and exit invalidate stale commands.
5. “Continue” preserves full game state and hands off to the actual level 4 worker AI as practice; continuation and reload cannot affect Elo.
6. A later real capture cannot consume an old tutorial die. Verify provider replacement and session generation explicitly; do not rely on observing a different random face by chance.
7. “New game” opens ordinary setup and creates a clean standard game only on confirmation, with the chosen mode/side/level and normal RNG. Cancel returns to the intact finish screen; no saved match, tutorial progress or rating record is lost or changed.
8. Final completion appears only after educational objectives were achieved.
9. Phone layouts at 390×844 and 360×800 allow every required target and button to be reached, and keyboard/2D/reduced-motion flows work.
10. Nickname capture rows and `+N` reflect actual committed captures/current material, including conversion, self-removal, friendly captures and promotion; no extra capture animation substitutes for the required static rows.
11. Each fixture starts an independent ledger/repetition context. The final handoff preserves only the current position's context without adding an occurrence; refresh, practice undo/redo and replay do not manufacture repetition claims or trophies.
12. Entering/exiting learning preserves a suspended rated session and its locked controls. Practice continuation cannot award Elo or re-enable undo/difficulty changes in that separate rated session.
13. Complete every lesson and both finish paths in ru and en through the real UI. Every coachmark, rule explanation, control, error and accessible label has authored text in both catalogs; no missing keys or mixed-language fallbacks appear.
14. Switch ru → en → ru during a directed move, a revealed die, a pending promotion/bonus where the lesson permits it, and the finish screen. Targets, game state and progress remain unchanged; no duplicate event, roll, repetition or completion occurs. Refresh resumes the selected language and current step, and English/Russian coachmarks fit both phone widths.

Keep test shortcuts/fixture loading in a development-only route or harness; normal sessions cannot silently enable predetermined dice.
