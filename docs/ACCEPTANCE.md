# Acceptance — a finished playable game

Use these requirements to review each game revision. The [current report](VALIDATION_PLAYABILITY.md) records the playability revision and [the first delivery](VALIDATION.md) records the earlier run.

## Completion gates

| Gate | Evidence required |
|---|---|
| Clean start | Documented install and start work; production build and preview load all local models/textures/workers without 404s or uncaught exceptions. |
| Correct rules | Executable fixtures cover the source rules, the explicit digital decisions and the critical cases at the end of `RULES_DIGITAL_V1.md`. |
| Local two-player | Play a real sequence with legal/illegal input, capture, reaction, bonus, promotion and a terminal result. Rules/state are authoritative in both 3D and 2D. |
| Real AI | All ten profiles in `RATING_AND_DIFFICULTY.md` produce legal evaluated moves and materially different search/choice behavior; search handles special mechanics and repetition history, stays off the main thread and cannot consume future live dice. Approximate anchors are not presented as measured external Elo. |
| Rating | Real win/draw/loss updates use the specified formula, float storage and consistent display. Rated restrictions are enforced by the session API; one unfinished rated slot and atomic exactly-once settlement survive refresh and multiple tabs. |
| Captured pieces | Under both nicknames, show actual enemy-capture icons and positive-only `+N` from current board material. Conversion, self-removal, promotion and friendly captures follow `CAPTURED_PIECES_AND_MATERIAL.md`; the HUD is visible on phone and laptop. |
| Interactive teaching | Complete every lesson through actual controls, then test both Continue and New Game. Coverage manifest demonstrates that no Remorse rule is omitted. |
| Russian and English | Complete player-facing ru/en catalogs, including every tutorial lesson, rules/help, event history, errors, empty/loading states and accessibility labels. Language switches and reload preserve the same game and tutorial step. |
| Laptop interface | Readable board/controls at 1440×900 and 1280×800; usable with mouse, trackpad and keyboard. |
| Phone interface | Distinct usable touch layout at 390×844 and 360×800, plus a landscape/resize check. No horizontal overflow, hidden mandatory controls or coachmarks covering required targets. |
| Visual and motion quality | Inspect actual 3D geometry, lighting and effects on the models' surfaces, not only badges/rings. Observe moving trails and transitions, white/black readability and independent per-piece materials. Fix visible defects. |
| Persistence | Refresh, import/export, permitted practice undo/redo and tutorial resume preserve complete state, timers, reaction memory, bonus phase, pawn rights, repetition context and capture ledgers. Export/import cannot award or reactivate rated results. |
| Lifecycle | Reset/load/undo/tutorial exit reject stale AI/script actions; no double move, stuck die, modal deadlock or duplicated animation. |
| Graceful fallback | WebGL failure/context loss and asset/environment loading failure preserve access to a functional 2D game; reduced motion preserves all actions. |
| Delivery | Working local preview, actual LAN URL for a phone on the same network when available, reproducible commands, source push, third-party notices and a factual concise validation report. |

## Test strategy

Use Vitest (or an equally appropriate existing runner) for deterministic rules, replay, tutorial scripts, search fixtures, rating arithmetic, locale consistency and adapter contracts. Use Playwright for end-to-end user flows, including actual browser persistence transactions. Tests must verify behavior that can fail, not merely restate implementation constants.

Required integration paths:

1. New normal AI game → human move → real worker response → second human decision. Repeat with the human as Black and with a berserk bonus.
2. Hotseat → legal movement and capture → assigned reaction → appropriate next decision → save/reload.
3. Full tutorial progression → Continue from final position → unrated practice against level 4 → real AI play → future capture with normal RNG provider. Preserve only this lesson's capture root ledger and repetition context; Elo does not change.
4. Full/tutorial-completion checkpoint → New Game → normal setup → clean standard position after confirmation. Cancel setup returns to the completed lesson without losing saves or progress.
5. Mid-tutorial reload and lesson restart; all callouts/targets recover and stale scripted moves are canceled.
6. Practice undo during/after AI thinking, new game during animation and load during a pending bonus; old responses cannot alter the new state. Rated attempts to undo/change difficulty fail without altering the position or rating contract.
7. Phone pointer/touch input on near and far ranks, promotion chooser, bonus End Turn, bottom-sheet management, rotation and tutorial target visibility.
8. Invalid import, worker failure and WebGL fallback produce useful recovery instead of a blank screen.
9. Entering/leaving learning preserves the original normal match; continuing a lesson position creates an undo barrier and cannot undo into a removed tutorial controller.
10. Capture A → undo → different action B → undo → capture A retains A's outcome from the restored RNG checkpoint; a new command ID cannot reroll it.
11. Rated win/draw/loss → atomic finalization → refresh/reopen/duplicate result delivery/two tabs: exactly one ledger entry and one profile update. Test a crash between logical stages and reservation of a pending rated match before the first human move.
12. Suspend a rated match → play separate practice/tutorial → resume the same rated match; no erased loss, accidental settlement, second rated slot or changed starting rating. Application/worker failure uses recovery or a factual technical abort, not an invented game result.
13. Both capture rows and material respond correctly to ordinary/mercy/en-passant captures, promoted/converted victims, friendly losses, self-removal, conversion and promotion; undo/replay/reload restore the current branch without phantom trophies. AI search leaves the live HUD unchanged.
14. Equal semantic boards with different repetition histories expose different claim rights to human and AI. Test pawn conversion removing double-step rights, and a first roll of 6 after four or more captures immediately enabling bloodlust.
15. Play and finish the tutorial in Russian and English. Switch ru → en → ru mid-game and mid-lesson, including existing history and an active AI request; no reset, duplicate event or lost target. Reload retains the selected language. Missing keys, mismatched placeholders and Russian plural forms are checked.

For tutorial/rare-rule scenarios, it is reasonable to use deterministic test fixtures. Clearly distinguish them from seeded ordinary games. Browser tests must still click the real UI; directly calling an internal reducer does not prove that the tutorial controls work.

Drive both Chromium and available WebKit. A Playwright mobile viewport is an emulation, and WebKit automation is not evidence of a physical iPhone or real Safari run. State the actual environments used. If an actual phone is accessible without user intervention, use it; otherwise do all automated checks and accurately name the remaining physical-device limitation.

## Visual inspection checklist

- Both army colors and all six types are recognizable; no missing texture, upside-down knight, shared-material recoloring, hover clipping, floating base or board misalignment.
- Place two same-kind/same-army figures in different states next to each other. Change/move one and rotate the camera: surface masks remain attached, each material stays independent and both states are readable at normal scale. Repeat for white/black, mobile low quality and reduced motion.
- Every logical square is clickable correctly after board flip, camera change, resize and touch interaction.
- Trails are visible while moving, fade out, do not pile up and do not obscure legal targets.
- The visible 3D die drops, tumbles and settles on the committed face for both colors and AI; state badge and event log agree. State effects reveal after the shared settling time. Restores/undo do not replay throws. Preset-dice notices are absent from the tutorial UI; no production roll is forced accidentally.
- Capture/reaction/bonus and cure/shame/conversion/removal events appear in an understandable order.
- Countdown text matches the digital full-cycle rule and never decreases on each berserk movement.
- Tutorial callouts never cover the requested piece, square, promotion option or finish action on laptop or phone.
- Mobile browser chrome, safe areas and changing viewport height do not hide the board controls. During play/tutorial the document does not scroll; required controls remain inside the viewport. Optional help/history scroll internally. Preserve browser zoom.
- In the counter lesson, select the figure, inspect the close-up and its highlighted counter, then explicitly acknowledge. The camera returns smoothly; manual board flips are eased. Reduced motion retains visible static focus.
- In a congested 360×800 view show both nicknames/capture rows, material advantage, a selected afflicted figure, tutorial guidance and a bonus-action control simultaneously. Keep source/target accessible. Test both Russian and English text lengths, Cyrillic font coverage and no layout shift on first capture.
- Bot `≈Elo`, human Elo and material `+N` are clearly distinct. The ten-level choice is compact in setup; it does not become ten permanent buttons around the board.
- Reduced motion removes excessive movement while retaining state feedback. Fresh profiles enable sound after a genuine gesture. A previously saved mute and volume survive reload.
- Keyboard users can perform moves and dismiss/open dialogs, and focus is restored after promotion/tutorial modals.

Record a few useful local screenshots and, if needed, one short local motion clip. Inspect them. Do not dump a large video corpus or snapshots into the repo or Actions artifact storage.

## Performance and reporting

Measure the real available environment: Mac model if obtainable, browser, viewport/DPR, graphics preset and whether GPU rendering is available. Record observed rendering/search responsiveness and concrete bottlenecks, not “4K ultra 60” as marketing without measurement.

Prefer a bounded ordinary game plus focused stress scenes. Use a limited number of seeded bot-versus-bot runs; record terminal results and explicit test caps. Do not keep expanding test volume once the known correctness risks are resolved.

At delivery run static/type/lint checks, rules/integration tests, production build and meaningful browser checks against the final code. Fix failures rather than hiding them by skipping tests or weakening assertions.

The final report must distinguish **passed**, **not run**, and **known issue**. It must include how to launch the game, the exact source commit, browser coverage, tutorial handoff evidence and remaining limitations. Do not claim a completed game while one of its required play modes or tutorial continuation is a placeholder.
