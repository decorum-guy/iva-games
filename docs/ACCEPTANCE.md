# Acceptance — a finished playable game

These are requirements for the implementing Codex agent. **They have not been executed in the preparation-only repository.** Record actual commands, outcomes and limitations in `docs/VALIDATION.md` after implementation.

## Completion gates

| Gate | Evidence required |
|---|---|
| Clean start | Documented install and start work; production build and preview load all local models/textures/workers without 404s or uncaught exceptions. |
| Correct rules | Executable fixtures cover the source rules, the explicit digital decisions and the critical cases at the end of `RULES_DIGITAL_V1.md`. |
| Local two-player | Play a real sequence with legal/illegal input, capture, reaction, bonus, promotion and a terminal result. Rules/state are authoritative in both 3D and 2D. |
| Real AI | All three settings produce legal evaluated moves; search handles special mechanics, stays off the main thread and cannot consume future live dice. |
| Interactive teaching | Complete every lesson through actual controls, then test both Continue and New Game. Coverage manifest demonstrates that no Remorse rule is omitted. |
| Laptop interface | Readable board/controls at 1440×900 and 1280×800; usable with mouse, trackpad and keyboard. |
| Phone interface | Distinct usable touch layout at 390×844 and 360×800, plus a landscape/resize check. No horizontal overflow, hidden mandatory controls or coachmarks covering required targets. |
| Visual and motion quality | Inspect actual 3D geometry, lighting and every state effect. Observe moving trails and transitions, not just the first screen. Fix visible defects. |
| Persistence | Refresh, import/export, undo/redo and tutorial resume preserve complete state, timers, reaction memory and bonus phase. |
| Lifecycle | Reset/load/undo/tutorial exit reject stale AI/script actions; no double move, stuck die, modal deadlock or duplicated animation. |
| Graceful fallback | WebGL failure/context loss and asset/environment loading failure preserve access to a functional 2D game; reduced motion preserves all actions. |
| Delivery | Working local preview, actual LAN URL for a phone on the same network when available, reproducible commands, source push, third-party notices and a factual concise validation report. |

## Test strategy

Use Vitest (or an equally appropriate existing runner) for deterministic rules, replay, tutorial scripts, search fixtures and adapter contracts. Use Playwright for end-to-end user flows. Tests must verify behavior that can fail, not merely restate implementation constants.

Required integration paths:

1. New normal AI game → human move → real worker response → second human decision. Repeat with the human as Black and with a berserk bonus.
2. Hotseat → legal movement and capture → assigned reaction → appropriate next decision → save/reload.
3. Full tutorial progression → Continue from final position → real AI play → future capture with normal RNG provider.
4. Full/tutorial-completion checkpoint → New Game → clean normal position with no tutorial constraints.
5. Mid-tutorial reload and lesson restart; all callouts/targets recover and stale scripted moves are canceled.
6. Undo during/after AI thinking, new game during animation and load during a pending bonus; old responses cannot alter the new state.
7. Phone pointer/touch input on near and far ranks, promotion chooser, bonus End Turn, bottom-sheet management, rotation and tutorial target visibility.
8. Invalid import, worker failure and WebGL fallback produce useful recovery instead of a blank screen.
9. Entering/leaving learning preserves the original normal match; continuing a lesson position creates an undo barrier and cannot undo into a removed tutorial controller.
10. Capture A → undo → different action B → undo → capture A retains A's outcome from the restored RNG checkpoint; a new command ID cannot reroll it.

For tutorial/rare-rule scenarios, it is reasonable to use deterministic test fixtures. Clearly distinguish them from seeded ordinary games. Browser tests must still click the real UI; directly calling an internal reducer does not prove that the tutorial controls work.

Drive both Chromium and available WebKit. A Playwright mobile viewport is an emulation, and WebKit automation is not evidence of a physical iPhone or real Safari run. State the actual environments used. If an actual phone is accessible without user intervention, use it; otherwise do all automated checks and accurately name the remaining physical-device limitation.

## Visual inspection checklist

- Both army colors and all six types are recognizable; no missing texture, upside-down knight, shared-material recoloring, hover clipping, floating base or board misalignment.
- Every logical square is clickable correctly after board flip, camera change, resize and touch interaction.
- Trails are visible while moving, fade out, do not pile up and do not obscure legal targets.
- Dice face, state badge and event log agree; tutorial dice are labeled; no production roll is forced accidentally.
- Capture/reaction/bonus and cure/shame/conversion/removal events appear in an understandable order.
- Countdown text matches the digital full-cycle rule and never decreases on each berserk movement.
- Tutorial callouts never cover the requested piece, square, promotion option or finish action on laptop or phone.
- Mobile browser chrome, safe areas and changing viewport height do not hide the board controls. Keep pinch/scroll behavior sensible and avoid disabling page zoom globally.
- Reduced motion removes excessive movement while retaining state feedback. Muted default stays muted after a clean start.
- Keyboard users can perform moves and dismiss/open dialogs, and focus is restored after promotion/tutorial modals.

Record a few useful local screenshots and, if needed, one short local motion clip. Inspect them. Do not dump a large video corpus or snapshots into the repo or Actions artifact storage.

## Performance and reporting

Measure the real available environment: Mac model if obtainable, browser, viewport/DPR, graphics preset and whether GPU rendering is available. Record observed rendering/search responsiveness and concrete bottlenecks, not “4K ultra 60” as marketing without measurement.

Prefer a bounded ordinary game plus focused stress scenes. Use a limited number of seeded bot-versus-bot runs; record terminal results and explicit test caps. Do not keep expanding test volume once the known correctness risks are resolved.

At delivery run static/type/lint checks, rules/integration tests, production build and meaningful browser checks against the final code. Fix failures rather than hiding them by skipping tests or weakening assertions.

The final report must distinguish **passed**, **not run**, and **known issue**. It must include how to launch the game, the exact source commit, browser coverage, tutorial handoff evidence and remaining limitations. Do not claim a completed game while one of its required play modes or tutorial continuation is a placeholder.
