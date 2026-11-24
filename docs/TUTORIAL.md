# Mandatory interactive play-through tutorial

The project owner explicitly requested learning **by playing on the board**, fixed educational dice where useful, and a choice to continue the resulting game or start a new one. This is a required product feature.

The lesson structure below is our design. Its rules come from the supplied transcript plus `RULES_DIGITAL_V1.md`. Implement it through the **same core, legal-command API, events and animations** as a normal game.

## Format and interface

Use nine short, named training positions in one coherent tutorial session. Start with an actual normal initial position. Later curated positions let the player see every mechanic without an excessively long forced match. Announce each reset clearly as **«Следующая учебная позиция»**. Do not pretend that a fixture reset is an ordinary move or that the entire session is one historically continuous game.

Offer «Пройти обучение» and «Сразу играть» at first entry. Learning remains available from the menu. Save progress and the active lesson state so refresh can resume correctly. Keep the active normal match in a separate save slot/session; entering learning must not overwrite it, and leaving learning allows the original match to resume.

Each teaching step has:

1. One short coachmark explaining the current idea and intended action.
2. A highlighted source piece, target square and subtle directional cue.
3. A real player action accepted by the normal rules core.
4. A real, validated scripted opponent response when necessary.
5. The real effect animation and a concise explanation of what changed.

Use one anchored modal/coachmark at a time with a spotlight, one idea, one expected action and about 1–3 short sentences. Show lesson/step progress and put detail in expandable help. Release board interaction when the step asks for a move; pointer events must reach the highlighted target through the spotlight. Reposition the callout after camera/viewport changes if it would cover the source, destination or promotion controls. On a phone use a compact bottom sheet and a fitted board/camera; never shrink the desktop coachmark until its text or target is unusable.

Support keyboard focus, touch, 2D and reduced motion. Supply «Повторить объяснение», «Начать урок заново» and exit controls. Do not allow a modal, AI request or missing animation event to trap the player.

Some steps can restrict input to their educational goal. If another move is legal, explain «Этот ход разрешен, но сейчас попробуем выделенный ход». Reserve “illegal” explanations for real rule violations. An invalid-action teaching step does not mutate the game.

## Lesson sequence

The exact coordinates beyond the first example must be constructed and **verified by executable fixtures**, not invented in documentation and assumed legal. Each fixture includes exactly one king per side and a legal nonterminal state unless it is explicitly demonstrating a terminal rule.

| Lesson | Required actual interaction and observable result |
|---|---|
| 1. Первое взятие | Start from normal setup. A simple verified sequence such as `e4`, `…d5`, `exd5` can introduce selection, legal targets, taking turns and a tutorial die of 4. Explain checkmate as the goal, all d6 outcomes, and that the rolled reaction stays with that figure. |
| 2. Вина | Make a real capture with a scripted 2 or 3. Try a forbidden capture with the guilty piece and receive the correct explanation; make an allowed quiet move. Demonstrate that it no longer checks but still occupies/blockades its square. |
| 3. Опустошение и милосердие | Capture with a scripted 1. Inspect immobility and the exact countdown. In prepared substeps, capture a devastated non-bishop without a reaction and let another unsaved devastated piece expire. Advance time with real legal moves, not a hidden pass/advance-timer command. |
| 4. Помощь слона | Move a friendly bishop next to two afflicted pieces and observe both cures after the correct full-cycle delay. Make a later capture with a cured piece to demonstrate remembered reaction without reroll. Demonstrate bishop pacifism, then a normal piece capturing a bishop and becoming devastated. |
| 5. Стыд и обращение | Move a bishop beside an enemy; observe guilt → devastation → ownership conversion at actual deadlines. Demonstrate cancellation by a bishop friendly to a target and its delayed healing. Use a converted piece to show rebirth and a newly assigned reaction. Explain no stacking and berserk immunity through visible examples/contextual inspection. |
| 6. Король собирает войска | Safely move the king next to friendly guilt/devastation and observe immediate cure. Make a safe king capture without a roll. A neighboring berserker stays unchanged. Explain own-king safety, friendly-only rally and why no king can be captured. |
| 7. Рыцарь, ярость и жажда крови | A knight gets a first free capture, then scripted 6 on its second. Use the earned second action; the third total capture triggers bloodlust. Show capture-only movement, a legal friendly non-king capture, maximum two actions, and deliberately decline one available bonus. Demonstrate that a berserker can capture a bishop without devastation. |
| 8. Превращение | Use two short subpositions/pawns to demonstrate inherited reaction/affliction for Q/R/N and cleansing rebirth on bishop promotion. Use the real Q/R/B/N chooser before any capture-roll reveal. Explain that counts/reactions are not erased by knight promotion. |
| 9. Последнее решение с подсказкой | Provide a legal mixed middlegame with relevant states, several allowed choices and optional contextual help. The learner chooses a legal move, and the tutorial opponent responds legally. End on a live, nonterminal complete-turn boundary that can be continued as an actual game. |

Lessons may contain small substeps, but avoid long blocks of passive reading. Reuse state inspection for minor exceptions instead of making a separate screen for each rule. Explain the two-player-turn timing definition early and show that a berserk bonus does not tick it.

Ordinary castling, en passant, pawn movement, check and checkmate are available in contextual basic-chess help with verified examples. Additional playable basics lessons are optional only after all mandatory acceptance gates pass. Include the digital precedence decisions in a collapsible appendix, with links from relevant lessons. The Remorse-specific rules must all appear in the main learning coverage table.

## Scripted play and randomness

Disable the ordinary AI controller during directed lessons. A `TutorialController` submits scripted opponent moves through the same legality and command path as a human/AI seat. A scripted move that becomes illegal is a scenario error to fix, not permission to force the board.

Use an injected **`TutorialRollProvider`**, separate from the ordinary provider. Show «Учебный бросок: результат задан для примера» on the die reveal. Bind each planned result to lesson ID, step ID, expected capturer/target and command/chance-event identity. Unexpected captures must not silently consume the next queued number.

No hidden production setting such as `forceNextRoll` may survive lesson completion. Save tutorial state as tutorial state; an imported normal save must not accidentally reactivate a script. Reject or explicitly route tutorial-save imports to the tutorial controller.

Use objective/event predicates rather than arbitrary delays: e.g. a cure event for a particular piece, a completed-turn serial, a selected promotion, or a validated illegal-attempt explanation. Presentation completion may coordinate the next explanation but cannot create a rule outcome. Reduced motion must still emit the completion signal. Restart/exit cancels all obsolete scheduled commands and presentation waits.

## Finish and continue

The final tutorial checkpoint must be legal, nonterminal, at a completed-turn boundary, with at least one legal action and no pending roll, promotion or bonus.

Show two real actions:

- **«Продолжить эту партию»**, with subtitle «С текущей учебной позиции, без подсказок». Keep every board position, type, owner, reaction, affliction, capture count, right, en-passant field, timer and side-to-move exactly as it is. Destroy the tutorial controller/roll queue, invalidate outstanding tasks, connect the ordinary RNG for future rolls and an actual Normal AI on the opposing seat. Record a session handoff event. The already observed educational outcomes remain part of the game's history.
- **«Начать новую партию»**. Open normal setup for AI or two local players, then create a clean standard position with normal randomness and reset metadata. Keep only the user's preferences and completed-learning flag.

Do not finish with checkmate and then offer an impossible continuation. Do not silently start a new board behind the Continue button. Do not randomize/reassign existing reactions when switching providers.

Create the ordinary game's root checkpoint and undo lower bound at this handoff. Keep earlier tutorial history read-only for explanation, but ordinary undo/replay must never cross lesson fixture resets or revive a destroyed tutorial controller. Preserve the previous normal match, if any, as a recoverable checkpoint in a separate slot.

For early exit, offer leaving to the home screen or continuing the **current stable** teaching position. If the position is in a pending controlled transition, resolve/cancel that transition coherently before offering free play; do not allow a half-resolved state to escape.

## Verification

Create a lesson manifest connecting each source rule/digital rule to a step, actual action or explicit contextual explanation. Mechanically verify all fixtures and scripted legal commands through the core. Then drive the entire tutorial through real browser controls, including piece/square clicks, promotion selection and final buttons.

Required checks:

1. All forced outcomes produce actual core events; lessons do not directly set an affliction to fake a demonstration.
2. Cure, shame, conversion and removal use real completed turns and correct timing.
3. Both the strict and open-ended lesson branches finish without deadlock.
4. Restart lesson, repeat explanation, refresh/resume and exit invalidate stale commands.
5. “Continue” preserves full game state and hands off to the actual worker AI.
6. A later real capture cannot consume an old tutorial die. Verify provider replacement and session generation explicitly; do not rely on observing a different random face by chance.
7. “New game” resets board/state/scripted randomness properly.
8. Final completion appears only after educational objectives were achieved.
9. Phone layouts at 390×844 and 360×800 allow every required target and button to be reached, and keyboard/2D/reduced-motion flows work.

Keep test shortcuts/fixture loading in a development-only route or harness; normal sessions cannot silently enable predetermined dice.
