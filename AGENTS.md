# Remorse Chess — agent instructions

## Objective

Build a finished, beautiful, playable web game on the owner's Mac: Remorse Chess versus a real variant-aware AI with ten difficulty levels, local Elo progression, local two-player play, and a mandatory interactive tutorial. Laptop and phone interfaces and complete Russian/English localization are required. The owner has delegated routine implementation decisions and does not want questions during the build.

The preparation package and implementation are both present. Read `docs/BUILD_STATUS.md` for the current verification state and distinguish isolated source/test results from activation and live browser acceptance. Earlier reviews, including `docs/VALIDATION_FINAL_SHOWCASE.md` and `docs/VALIDATION_ROOT_PLAYTHROUGH.md`, verify only their recorded revisions.

## Current scope: pacing audit fixes and Mac activation

On 25 November 2026 the owner authorized implementing the remaining findings from the pacing/selection audit. The recorded Mac baseline is gameplay revision `9366cea29aad449441dd769d492b24030610a1af` (`index-HC_opOyP.js`), with release report `73428e6652dc925704881abb6992f6fb6dd0b6ce`. Continue from current `main`; these identifiers describe the baseline and are not instructions to reset newer work. Follow `prompts/ACTIVATE_PACING_AUDIT_FIXES.md` for the focused checks and Mac activation.

The scope is to preserve a full reading interval after an actually displayed reaction even when rendering is late, keep a local AI continuation from passing an unseen result while the tab is hidden, and keep a deselected bonus figure cleared after an empty-square click. Preserve real worker search, cancellation, tutorial holds, saves, rating and the chosen visual/audio treatment. Prepare and verify on an isolated port before activating the tested production build on 4173. Activation of these fixes is authorized; do not ask for the same permission again. Keep QA silent and headless, without taking focus from the owner's applications.

Sound selection is complete according to `docs/SHOWCASE_SFX.md` and `docs/BUILD_STATUS.md`: R1 guilt/berserk, R2 devastation/short bloodlust, P2 bishop/knight and queen, the selected P1+P2 rook mix, D2 dice, and the documented check/mate and ignition mixes. Preserve those installed choices. `prompts/FINAL_SFX_SELECTION_AND_SHOWCASE.md` and the audition assets remain historical/reference material; they do not require another selection round.

The previous report's 18 games / 1,137 actions and exact Elo are executor-reported until the local report and original records are independently examined. Keep that private archive and all QA media on the Mac; publish only a concise validation summary. Network rooms remain a separate next stage under `docs/ONLINE_ROOMS_V1.md` and `prompts/IMPLEMENT_ONLINE_ROOMS.md`. Do not expand this repair into multiplayer, a redesign, new effects or engine-strength calibration.

## Read before implementation

1. `prompts/BUILD_REMORSE.md` — complete delivery brief and execution instructions.
2. `docs/RULES_DIGITAL_V1.md` — normative, explicit digital rule decisions.
3. `docs/reference/transcript.md` — supplied primary rules transcript; original PDF is beside it.
4. `docs/ART_DIRECTION.md` — visual, motion, interface, and asset requirements.
5. `docs/TUTORIAL.md` — required interactive teaching and handoff to a normal game.
6. `docs/ENGINE_AND_ARCHITECTURE.md` — rules, AI, replay, and future multiplayer contract.
7. `docs/CAPTURED_PIECES_AND_MATERIAL.md` — captured icons under each nickname and the separate material advantage.
8. `docs/RATING_AND_DIFFICULTY.md` — ten real bot profiles, provisional internal Elo anchors and transactional local rating.
9. `docs/LOCALIZATION.md` — mandatory complete Russian and English, stable semantic events and language switching.
10. `docs/ACCEPTANCE.md` — meaningful completion checks.
11. `docs/SOURCES_AND_ASSETS.md` — verified sources, acquisition instructions, and evidence limits.
12. `docs/PREFLIGHT_AUDIT.md` — resolved specification gaps and the remaining implementation checks.
13. `docs/reference/frontend-design/GUIDE.md` — a pinned, licensed copy of Anthropic's design skill, applied as supplementary guidance under this project's art direction.

## Working rules

- Execute the complete brief, rather than stopping at scaffolding, a plan, or a visual mockup. The user explicitly authorizes resolving remaining small ambiguities independently; record decisions and test their consequences.
- Preserve applicable higher-level instructions, local work, unrelated repositories, and credentials. Full Access is scoped authorization to finish this project, not permission to bypass a real tool restriction.
- Inspect the repository and working tree first. Prefer an isolated worktree if existing edits belong to somebody else. Do not discard or overwrite those edits.
- Keep a short durable `docs/BUILD_STATUS.md` with completed work, actual checks, unresolved defects, and the next concrete action. It is a continuation aid, not a substitute for implementation.
- Use a pure, shared, versioned Remorse rules core. Rendering, AI, tutorial, persistence, and future networking all use it. No authoritative orthodox-chess library and no duplicated tutorial rules.
- Keep assigned capture reaction separate from current affliction. Keep whole player turns separate from individual berserk moves. Dice outcomes are committed game events; animation does not generate them.
- The interactive tutorial is required. Its scripted rolls remain strictly isolated from ordinary play. Per the owner's playtest feedback, do not display disclaimers, badges or separate windows explaining that tutorial dice are preset.
- Required tutorial explanations belong to the event that caused them. Reveal the actual face, affected figure, cause and practical rule together, then hold until acknowledgement before another script or exercise. Essential rules and the first dice mapping must not exist only behind optional help. `docs/TUTORIAL_EDITORIAL_AUDIT.md` and `prompts/ACTIVATE_EDITORIAL_BUILD.md` record the earlier editorial requirements; the current focused acceptance task is `prompts/ACTIVATE_PACING_AUDIT_FIXES.md`.
- Read tutorial copy as a complete screen, including the action button. Name fixture changes, teach the conditions of a rule, and distinguish a figure's action from the player's whole turn. Explain the final quiet-move exercise before restricting input, then derive its feedback from the actual resulting position. Do not call every legal choice a successful rescue.
- Selected-piece deadlines use exact remaining completed player turns; a rounded cycle badge is not an exact deadline. Keep the selected piece's state and active deadlines visible in ordinary play without requiring the player to open history. Use one RU/EN glossary across lessons, inspector, help and events.
- During play and learning, fit the essential board, player rows and current action inside the dynamic viewport; the document must not scroll. Optional history/help may scroll inside their own bounded panels. Teach one action at a time with clear visual focus and concise RU/EN copy.
- Dice use a visible 3D drop, tumble and settled face for either player and AI. The shared committed result, visual timeline and sound agree. Tutorial inspection may use a smooth camera close-up and a temporary material emphasis; return to the board before normal play, respect reduced motion and keep manual flips smooth.
- Tutorial close-ups start at the current effect reveal, not at the end of an exercise or from a scan of old events. Keep the surface emphasis visible after camera arrival. Gate input and scripts until return to overview, including fixture changes. Preserve existing learning checkpoints and ordinary saves.
- Translate the whole player-facing experience into Russian and English, including tutorial, rules, event history, errors and accessibility labels. Switching language is a presentation change, never a new game.
- Display actual enemy captures under each player's nickname and positive material advantage beside them. This HUD is not another capture animation. Derive capture icons from committed history and material from the current board.
- Implement local Remorse Elo exactly as specified. Rated games prohibit undo/strategic hints/difficulty changes; practice, hotseat, tutorial continuation and imported games do not affect rating. Finalize each rated result once in an atomic persistent transaction.
- Use real, locally served, licensed 3D chess assets. Inspect the game in a real browser and improve the visual result; a successful build alone is insufficient.
- Read and apply the checked-in frontend-design guide during UI planning and visual critique. It is an explicitly loaded reference, not a claim that a skill/plugin is installed on the Mac. The established product brief, palette, real 3D board, ru/en coverage and autonomous delivery take precedence over generic examples in that guide.
- A usable, responsive 3D game is the primary experience. A polished 2D mode shares all gameplay and provides WebGL fallback and accessibility.
- State effects must visibly affect the actual 3D figure's material; rings, badges and cell highlights alone are insufficient. Preserve readable shape and independent material state per piece.
- The latest promotion brief requires three tiers: bishop/knight together, a heavy rook drop, and a stronger queen impact with lightning and a deep branching fracture across 4–6 squares, followed by a complete fade out. Follow `docs/CINEMATIC_PROMOTIONS_AND_REACTIONS.md`. Reaction SFX and promotion SFX are distinct, ordered events; a promotion must not suppress its capture reaction. The installed audio choices and edits are recorded in `docs/SHOWCASE_SFX.md`; `docs/REACTION_AND_PROMOTION_SFX.md` is the earlier selection brief. Further artistic audio changes need a new owner instruction, while the currently authorized timing/selection fixes can proceed.
- The specified approximate bot ratings are provisional internal Remorse anchors. Do not present them as measured external/human Elo or invent strength calibration, engine integration, tests, screenshots, FPS measurements, author endorsement, or deployment success.
- Keep QA screenshots, recordings, Playwright traces, caches, and generated reports outside Git and GitHub Actions artifacts. Small production runtime assets and concise textual validation reports belong in Git.
- The owner requested real online play on 24 November 2026, superseding the original local-only delivery scope. Implement that next stage only under `docs/ONLINE_ROOMS_V1.md` and `prompts/IMPLEMENT_ONLINE_ROOMS.md`, after the current dice presentation is accepted. Keep accounts, paid services, API keys, unrelated integrations and notifications outside this stage. Do not describe the existing transport interface as a working multiplayer backend.
- Commit logical milestones. Push the implementation to this repository without force-pushing or rewriting unrelated history. On an unchanged new repository, `main` is the intended delivery branch; handle concurrent work safely if the situation has changed.

## Completion

Run the application, play both modes, finish the tutorial and continue its game, verify special rules and browser behavior, inspect motion, fix observed defects, and leave a working local preview with reproducible startup instructions. Report only verified outcomes and remaining limitations.
