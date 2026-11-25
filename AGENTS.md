# Chess 2 — active SDK and OVERDRIVE iteration

On 25 November 2026 the owner explicitly assigned the next agent to create and test the common engine SDK and complete the whole OVERDRIVE / Форсаж iteration: final rules, measured balance work, new models/audio/effects, an independent interface, implementation, SDK-aware AI, real networking and acceptance. This is the active scope; preserve the existing REMORSE product. Routine decisions and continued execution are authorized.

**Every new Chess 2 game must have its own unmistakably different visual identity**, including materials, models, palette, type, layout, effects and sound. Recolouring REMORSE's marble or repeating a generic generated dashboard does not satisfy this requirement. OVERDRIVE's direction is in `docs/overdrive/ART_DIRECTION.md`.

Use `docs/overdrive/STATUS.md` and the latest validation documents to distinguish authored code, executed checks, browser observations and actual deployment. `docs/ENGINE_SDK.md` defines the shared search contract. Each variant retains a pure authoritative rules core used by rendering, AI, teaching and the server. The SDK currently supports two-player zero-sum games with public information; hidden-card search requires another model.

The other agent is updating **documentation only** on `design/chess-2-concepts`. The owner asked this implementation to periodically fetch and reconcile those changes. Preserve both the newer REMORSE status on main and all concurrent source work; never replace all of AGENTS with that branch's older REMORSE section. Keep imported drafts under `docs/chess-2`, with implementation decisions and evidence under `docs/overdrive`.

Five future directions remain selected: OVERDRIVE, WILDCARD, CHORUS, CHIMERA and SIGNAL. RELAY is excluded. The current action request implements OVERDRIVE and the SDK; do not silently expand implementation to all five games. Their recorded order is complete rules → balance → unique assets/art/audio → implementation/network/engine → local acceptance. A simulator written to test rules is evidence preparation, not a claim of a finished product.

REMORSE and OVERDRIVE have separate entry points, storage keys, rules versions, network protocols, guest sessions and databases. QA stays silent, isolated and out of the owner's visible applications. Preserve all REMORSE saves, ratings, selected sounds and accepted motion. Browser or target-device limitations must be reported literally. No main merge, public release or DNS configuration follows merely from producing a source build.

# Remorse Chess — agent instructions

## Objective

Build a finished, beautiful, playable web game on the owner's Mac: Remorse Chess versus a real variant-aware AI with ten difficulty levels, local Elo progression, local two-player play, and a mandatory interactive tutorial. Laptop and phone interfaces and complete Russian/English localization are required. The owner has delegated routine implementation decisions and does not want questions during the build.

The preparation package and implementation are both present. Read `docs/BUILD_STATUS.md` for the current verification state and distinguish isolated source/test results from activation and live browser acceptance. Earlier reviews, including `docs/VALIDATION_FINAL_SHOWCASE.md` and `docs/VALIDATION_ROOT_PLAYTHROUGH.md`, verify only their recorded revisions.

## Current scope: rules audit, clearer teaching and complete online rooms

On 25 November 2026 the owner assigned further development to this assistant: independently audit the rules, simplify overloaded player-facing explanations, repair the tutorial, and implement complete online play before publication. This supersedes the earlier restriction to pacing/selection fixes. Preserve accepted visuals, chosen audio, local saves and rating. Use `docs/ONLINE_ROOMS_V1.md` for the agreed guest-room scope and validate real independent clients; do not call a transport stub a network game.

The owner has purchased `chess-2.online`. REMORSE is to be published at `remorse.chess-2.online`. The root domain will later host a menu of all games, with future variants on separate subdomains. Claude will design that catalogue after a second game exists; do not build the catalogue in this iteration. See `docs/DOMAINS_AND_GAME_CATALOG.md`. These are owner-provided plans, not confirmation of configured DNS or a deployed server.

## Previous stage: pacing audit fixes and Mac activation

The local executor reported accepting and activating gameplay revision `6da671baf1fbcd57c7b4629c7e4ba5734c3de034` (`index-1TCUvz0X.js`) on the Mac; the report is in `d074f6e` and `docs/VALIDATION_PACING_AUDIT_FIXES.md`. Preserve its result-reading gate, real worker search, cancellation, visibility handling and bonus deselection behavior. Do not replay old activation tasks merely because their prompt files remain in the repository.

Sound selection is complete according to `docs/SHOWCASE_SFX.md`: preserve the chosen bank, mixes, volumes and accepted effects. Keep QA silent and headless without taking focus from the owner's applications. The executor's 18-game audit and private exports remain on the Mac; describe independent access and verification accurately.

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
- Required tutorial explanations belong to the event that caused them. Reveal the actual face, affected figure, cause and practical rule together, then hold until acknowledgement before another script or exercise. Essential rules and the first dice mapping must not exist only behind optional help. `docs/TUTORIAL_EDITORIAL_AUDIT.md` and `prompts/ACTIVATE_EDITORIAL_BUILD.md` record the earlier editorial requirements; the current focused acceptance task is `prompts/ACCEPT_RULES_AND_ONLINE.md`.
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
- The owner requested real online play on 24 November 2026, superseding the original local-only delivery scope. Implement that next stage only under `docs/ONLINE_ROOMS_V1.md` and `prompts/IMPLEMENT_ONLINE_ROOMS.md`, preserving the accepted dice presentation. The implementation is now present; finish its live acceptance under `prompts/ACCEPT_RULES_AND_ONLINE.md` before treating it as the active Mac/public release. Keep accounts, paid services, API keys, unrelated integrations and notifications outside this stage. Do not describe the existing transport interface as a working multiplayer backend.
- Commit logical milestones. Push the implementation to this repository without force-pushing or rewriting unrelated history. On an unchanged new repository, `main` is the intended delivery branch; handle concurrent work safely if the situation has changed.

## Completion

Run the application, play both modes, finish the tutorial and continue its game, verify special rules and browser behavior, inspect motion, fix observed defects, and leave a working local preview with reproducible startup instructions. Report only verified outcomes and remaining limitations.
