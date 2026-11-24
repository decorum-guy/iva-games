# Preparation audit and remaining implementation checks

Scope: review of the implementation brief in this repository on 2026-11-24. This repository still contains preparation documents, source evidence and a licensed design reference, **not an implemented game**. The following are resolved requirements and design decisions, not runtime test results.

The original rules come from the owner's supplied PDF/transcript. Captured HUD placement, rating, more difficulty levels, two languages, responsive 3D and tutorial behavior are direct owner requests. Numerical bot anchors, rating policy, technical architecture and solutions to unspecified rule cases are our explicit implementation choices. Public references are recorded in `SOURCES_AND_ASSETS.md`.

## Resolved requirements and gaps

| Area | Concrete resolution | Normative document |
|---|---|---|
| Captured display | Static enemy-piece icons directly under both nicknames, visible on laptop/phone, tied to actual captures at victim type/owner at capture time. No new trophy animation. | `CAPTURED_PIECES_AND_MATERIAL.md` |
| Material advantage | Positive-only `+N` from current board owners and conventional values. Conversion, self-removal, promotion and friendly captures cannot be inferred from trophy rows. | `CAPTURED_PIECES_AND_MATERIAL.md` |
| Rating | Local human rating starts at 1000; logistic Elo, K=32, floor 100, float storage and consistent rounded display. Only eligible rated AI results change it. | `RATING_AND_DIFFICULTY.md` |
| Rated lifecycle | One unfinished rated slot reserved at creation; first human move activates score-bearing play. Refresh suspends. Separate practice/tutorial may coexist without erasing the rated save. | `RATING_AND_DIFFICULTY.md` |
| Rating persistence | Atomic match/profile/unique-ledger settlement; no double award on reload, duplicate delivery or competing tabs. Import and tutorial continuation remain unrated. | `RATING_AND_DIFFICULTY.md` |
| Difficulty | Ten actual search/choice profiles; provisional internal anchors ≈400–2200; level 4 default. No claim of measured FIDE/Chess.com equivalence. | `RATING_AND_DIFFICULTY.md` |
| Both languages | Full ru/en UI, rules, all tutorial steps, history, errors and accessibility. Language switching is presentation only and preserves pending game actions. | `LOCALIZATION.md` |
| True 3D and effects | Real board/piece geometry on phone and laptop, PBR surface state effects, isolated per-piece material control, readable ownership and reduced-motion/mobile treatment. | `ART_DIRECTION.md` |
| Design assistance | Read the checked-in, pinned frontend-design guide under Remorse's art direction; inspect real output. No additional manual skill installation is required. | `ART_DIRECTION.md`, `SOURCES_AND_ASSETS.md` |
| Repetition | Persist occurrence context; give it to the worker; add hypothetical path counts without cross-branch leakage or history-unsafe cached draw values. | `RULES_DIGITAL_V1.md`, `ENGINE_AND_ARCHITECTURE.md` |
| Pawn rights | A pawn's movement or conversion permanently clears its original double-step eligibility. Stable snapshots reject unpromoted pawns on end ranks. | `RULES_DIGITAL_V1.md` |
| Late first berserk roll | A first 6 after earlier mercy captures checks `capturesSinceRebirth >= 3`, immediately entering bloodlust when appropriate. | `RULES_DIGITAL_V1.md` |
| Tutorial handoff | Preserve the exact final position, only its capture root ledger/repetition context, and a firm undo boundary. Continue is practice at level 4; New Game opens ordinary setup. | `TUTORIAL.md` |
| Existing timing/legality gaps | Whole-turn timers, automatic bonus completion, all-outcome king safety and nonrecursive settlement probes already have explicit contracts. Keep these while adding the new UI/rating requirements. | `RULES_DIGITAL_V1.md` |
| Future multiplayer | Serializable shared rules, validated commands/revisions, deterministic replay and an authoritative-session boundary; future server owns RNG and rating. No live backend in v1. | `ENGINE_AND_ARCHITECTURE.md` |

The old three-level scope, broad prohibition of Elo and optional/deferred English are superseded. Gameplay undo belongs to practice/hotseat. Server databases remain outside scope, while local IndexedDB transactions and schema handling are required.

## Preparation checks performed

- Checked 15 Markdown files for nonempty content and paired fenced-code markers; resolved 20 local Markdown links and all 13 required-reading paths from `AGENTS.md`.
- Confirmed one ten-profile table with anchors 400–2200 in the specified increments. Independently calculated all six documented Elo examples and the rating-floor case.
- Searched the active brief for the superseded three-level, no-rating and deferred-English instructions; those conflicting instructions are removed.
- Compared the checked-in design guide and license with the fetched pinned source: both file contents match exactly.
- Confirmed that the supplied PDF retains its recorded SHA-256 and the transcript is unchanged. Checked tracked document diffs for whitespace errors.
- Reviewed the rated-slot/practice/tutorial handoff flow across the rating, tutorial, rules, architecture and main brief; no remaining contradiction was identified in that reviewed flow.

These are document integrity, arithmetic and specification-consistency checks. No game test suite, browser render, engine benchmark, phone run or rated-game transaction has been executed in this preparation repository.

## What still requires implementation and observation

1. **Custom engine cost.** Chance outcomes, bonus actions, aura settlement and full-turn king safety make search more expensive than ordinary material-only chess. Start with correct bounded search, measure completed depth/nodes/time, and tune the specified profiles without changing their advertised identity during a rated match. Initial budgets are targets, not benchmark results.
2. **Actual 3D integration.** The primary model's scene structure and download metadata were inspected; the complete game render has not been built. Verify scale, contact, knight direction, textures, state masks, independent materials, phone readability and performance in the real scene. Use the documented licensed fallback only if needed.
3. **Rules, tutorial and rating execution.** Build meaningful fixtures, complete all teaching flows and test the actual browser transactions. A written contract cannot prove absence of implementation bugs. `ACCEPTANCE.md` lists the required evidence.
4. **Language quality and layout.** Equal catalog keys do not prove good translation or a usable phone layout. Inspect both languages, real Cyrillic glyphs, existing history after a switch, long tutorial text, plural forms and crowded game states.
5. **Device evidence.** Automated WebKit/mobile viewports do not establish physical iPhone/Safari results. Check available environments and clearly identify any physical-device coverage not performed. Do not invent 4K/FPS figures.
6. **Rating calibration.** The initial bot ratings are assigned internal anchors. Limited self-play verifies functioning levels, not human-equivalent Elo or exact 200-point gaps. Keep this limitation visible while delivering a working local rating system.
7. **Autonomous session limits.** Full Access and a detailed prompt do not remove actual runtime limits, tool restrictions or interruptions. Keep concise durable build status and resumable work; report a real blocker accurately if one occurs.

No additional product decision is required from the owner to start the authorized implementation. Resolve newly discovered routine gaps consistently, document the choice, and verify the behavior. This conclusion concerns specification readiness, not a guarantee that the game or its tests already work.
