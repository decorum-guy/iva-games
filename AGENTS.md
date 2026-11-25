# Iva Games — latest project direction

## Active review: OVERDRIVE energy v2 and publication

On 26 November 2026 the owner supplied completed Mac acceptance reports for the portal and OVERDRIVE, explicitly requested new synthetic games to assess the changed energy balance, and purchased **iva-games.pro**. Treat the purchase as owner-provided context, not evidence of configured DNS or hosting. Review and preserve the requested two banks of three, impulse cost 3, form cost 6, capture rewards 1/2/2/3/4 and fresh-check reward 2. Old v1 saves and rooms retain their own rules. A proposed balancing change needs measured evidence; never silently change the accepted rules while calling it a packaging fix.

The review branch combines actual accepted platform head `b7ca237` (PR #7) and energy-v2 head `32c1377` (PR #8). Work proceeds in `review/overdrive-v2-release` / PR #9. Older branch-specific instructions below describe their respective stages. Preserve their history and local demonstrations. Do not repeat the migration or local acceptance merely because old prompts exist. No merge, DNS change or production restart is implied by preparing this release candidate.

Use the real rules core and SDK for balance games; compare v1/v2 with matched opening tapes, seeds and budgets, distinguish unfinished games from draws, and record achieved search depth. Synthetic self-play is evidence about these bots, not a measured human Elo or proof of human balance. Keep full action logs under ignored `.qa`; commit the reproducer and concise measured report. Publish each completed milestone without force-push.

The renewed platform acceptance report records working Mac SSH to `kz-bot` and an existing SOCKS5 route from `ha-vps`. The older SSH timeout is historical. A new game bot still needs its own configuration and accepted real delivery. Do not reuse another project's bot or send real test messages without a named authorized recipient.

## Active implementation: platform and District revision

The owner now explicitly authorizes implementation of accounts, friends, rooms and invitations in parallel with the separate chess finishing/migration agent. Work in an isolated feature branch; the older documentation-only scope below is historical. Do not repeat the chess migration or overwrite that agent's game source. Integrate the existing chess network later through a versioned game-runtime adapter, preserving guest rooms and local saves.

The repository rename to `decorum-guy/iva-games` has been verified by stable GitHub repository ID 1469444922. `games/chess/*` remains the approved collection structure. Check remote refs again before integrating concurrent work.

The published chess migration `d2d9693` and Mac acceptance fixes `c18e57c` are integrated into `feat/iva-platform-foundation`. Preserve the accepted `games/chess/*`, `packages/engine-sdk` and `apps/server` source. Platform PR #5 is stacked on `acceptance/overdrive-monorepo` / PR #6, which is based on `feat/overdrive-sdk` / PR #3. Both use one root npm workspace lockfile. The Mac report is `docs/overdrive/VALIDATION_MAC_2026_11_25.md`; it does not accept the new portal. The main branch and active Mac/public deployment are not changed by this integration.

District now targets social negotiation, atomic property/resource deals, city events and personal goals inspired by the owner's Colonist / Monopoly One / Jackbox experience. Bots are mandatory in its first release, including solo with bots and mixed rooms. Read `games/district/RULES_V0_2.md` for normative prototype rules, `DESIGN_V0_2.md` for rationale, and `BOT_DESIGN.md` for policy requirements. The v0.1 rules are historical; they must not override or silently extend v0.2. Prices and strength levels remain unvalidated design choices. Rules, technical lab bots and an implemented District game are distinct deliverables.

A room participant has its own `participantId`; its controller is a human account or an explicitly labelled bot. Bots have no email, login session, friendship or Telegram identity. Every game declares participant limits and bot capability. Bots act through the same rules and receive only their permitted information.

Telegram traffic must use the owner's existing proxy route through SSH alias `kz-bot`; never silently fall back to direct Telegram access. Read `docs/iva-games/INFRASTRUCTURE_ACCESS.md`. On local development/acceptance, run the read-only `npm run check:kz-bot`, check actual configured SSH access and proxy protocol/port separately, and distinguish cloud limitations from the owner's Mac access. Do not copy SSH keys, proxy passwords, bot tokens or the panel's unrelated settings into this repository. Tests use controlled mail/Telegram transports and never message real recipients.

Current implementation, checks and remaining activation work belong in `docs/iva-games/BUILD_STATUS.md`; the general architecture and earlier spec are not themselves evidence of deployment. Keep QA videos, screenshots, traces, database fixtures and local email files ignored and off GitHub Actions artifacts.

## Player-facing writing

The owner explicitly wants simple interface copy like Colonist: short actions, short statuses and an obvious next step, in Russian and English. Keep delivery internals, duplicate-send explanations, revision numbers, idempotency, runtime architecture, database details and implementation disclaimers in engineering documentation. Players should see “Invite sent”, “Connect Telegram”, “Ready” or a useful retry message. Be accurate without exposing machinery: unfinished catalogue entries can say “Coming soon”, unavailable integrations can say “Telegram is not available yet”. Describe the technical table through its playable rules in the UI; record its engineering purpose in docs. Do not show raw backend exceptions or a paragraph of caveats as the normal user experience. This applies to pages, errors, emails, bot messages and future game tutorials.

On 25 November 2026 the owner expanded this project from Chess 2 to a shared games portal, with **Iva Games** as the working name and **iva-games** as the target repository slug. Chess remains a collection under **games/chess/remorse**, **games/chess/overdrive**, and future games/chess/<variant> packages. Do not put independent games on permanent branches.

Read [docs/iva-games/README.md](docs/iva-games/README.md), [ARCHITECTURE.md](docs/iva-games/ARCHITECTURE.md), [PLATFORM_V1.md](docs/iva-games/PLATFORM_V1.md), [TELEGRAM_LINKING.md](docs/iva-games/TELEGRAM_LINKING.md), and [DELIVERY_PLAN.md](docs/iva-games/DELIVERY_PLAN.md) before work on the expanded platform. These are design requirements; actual implementation and verification belong in [BUILD_STATUS.md](docs/iva-games/BUILD_STATUS.md). Source availability is not evidence of external activation, deployment, a completed chess migration or implemented product games.

## Selected non-chess work

- The owner selected **Harbor / Гавань** and **District / Район** (also referred to conversationally as Город). District is the first detailed design candidate. Read games/district/CONCEPT.md, DESIGN_V0_2.md, BOT_DESIGN.md and games/harbor/CONCEPT.md. RULES_V0_1.md is historical. Numeric parameters are unvalidated hypotheses until actual playtesting.
- Before product implementation of these games, implement and accept the shared foundation: real accounts, friends, rooms, site invitations and optional linked Telegram delivery. Friends are required scope, not a future placeholder.
- Keep platform-service (accounts/social/invitations/delivery), session-kit (game sessions/protocol/recovery), and the existing engine-sdk (search) separate. The current engine supports two-player zero-sum public-information search, not arbitrary multiplayer or secret hands.
- New game servers own authoritative rules, durable transitions and per-player views. Never send opponents' private cards/bids or hidden future events to a client and merely hide them in the UI. Disconnect is not resignation; repeated commands must not produce duplicate effects.
- Telegram linking starts from an authenticated website session and a single-use opaque deep-link code. A private-chat /start supplies a candidate identity; website confirmation completes the link. Delivery is opt-in and concerns explicitly created invitations. No scheduled reminders, unsolicited announcements or real-recipient messages during tests. A design or mock test is not evidence of real delivery.

## Preserve concurrent work and existing players

The package migration is being performed in another context. Inspect current remote refs and actual local changes before moving code. A message about a completed local split is not evidence that the remote has that split. Integrate games/chess/* on top of the actual migration, never replace newer work with an old src/ snapshot. Preserve the active OVERDRIVE instructions when combining AGENTS.md across branches.

The GitHub rename to iva-games is now verified; it does not imply that every local checkout was renamed or the package migration was pushed. Preserve game IDs, package names, browser storage, ratings, databases, routes and domains unless a separate migration explicitly covers them. In particular chess-2.online and remorse.chess-2.online remain valid planned addresses. Accounts for the new portal must not silently break current local or guest chess modes.

The following Remorse instructions remain applicable to that game. Their earlier restrictions against accounts, notifications and catalogue work concerned the earlier chess-only stage; the current owner request explicitly authorizes the separate shared platform and portal. Preserve each game's own visual identity and all previously selected/excluded chess directions.

# Chess workspace migration — published integration context


The owner authorized reorganizing the existing implementation into npm workspaces and has since renamed the repository to `decorum-guy/iva-games`. Keep delivery on `feat/overdrive-sdk` / draft PR #3; do not merge `main`, perform another rename, change DNS, deploy, or replace the owner's active 4173 server as a side effect. Use the confirmed current remote while preserving the existing repository history and local work.

The owner explicitly requires intermediate GitHub publication: commit and publish each completed logical milestone in the working branch as work proceeds. Do not hold the entire implementation until one final large upload. Before each branch update, read its current head, preserve concurrent work and use a normal fast-forward or an expected-head check without force. A local commit or uploaded unreferenced blob is not a published checkpoint; verify the remote branch and give the commit link. Record checks still pending without describing them as passed.

The root package is `iva-games`; internal package names remain `@chess-2/*`. Current source paths are `games/chess/remorse/src`, `games/chess/overdrive/src`, `packages/engine-sdk/src` and `apps/server/src`. Each game owns its `public`, tests and asset scripts. Use root npm commands and one lockfile. Preserve rule semantics, runtime asset URLs, storage keys, cookies, protocol/save versions, database paths, engine behavior and each game's distinct visuals/audio. Runtime game dependencies cross package boundaries through explicit exports; the server consumes pure rules/protocols, never UI. Do not add a catalogue implementation or unify game styling.

Read `docs/MONOREPO.md` and `prompts/ACCEPT_OVERDRIVE_MONOREPO.md` for the current structure and local acceptance task. The fresh nested-layout report is `docs/VALIDATION_IVA_GAMES_LAYOUT.md`. Historical paths/counts/hashes in older validation reports describe their recorded revisions and are not claims about the migrated tree. Keep them intact. Record fresh migration checks separately and distinguish authored code, executed checks, browser observations, listening and activation. The older instructions below retain their behavioral requirements; translate their source paths using the migration document.

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
