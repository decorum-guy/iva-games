# COLOSSUS — implementation state

## Owner audio decisions — 28 November 2026

The owner approved 15 of 17 cues in Safari for sound bank v2. The two open cues are **Armor hit** (`armour`) and **Shield or invulnerability** (`shield`). The armor hit needs a contact closer to a strike on a shield. The owner requested several new shield cues for comparison.

The [second listening demo](README.md#прослушивание-звуков) compares the current versions with three original candidates for each cue. Each option can play on its own or inside the same game cue sequence. The six audition files live beside the demo sources. The 17 original game files are byte identical to the reviewed bank. The owner will choose the two replacements in a later listening pass.

The six audition checksums matched the served files. Headless Chromium and WebKit each exercised eight solo plays and eight battle sequences with the game mixer. Both verified selection, reload, report download and preservation of the original review decisions.

## Terra findings and audio review — 28 November 2026

This follow-up to the audit of `95cf869765ff2b9541bd858bbc69a10f90c9d4af` incorporates main `a3df8369b269c53aea4c3839fade24e7064a4ce1`. The conflict in the shared build status was resolved by keeping both project records.

The branch also incorporates main `b04479dc9e6aab784a24c9e9c54aa240080a5624` from [PR #32](https://github.com/decorum-guy/iva-games/pull/32). The platform workspace keeps both the shared game registry and the JPEG decoder for profile avatars.

- **C-05:** An unreadable hunt or practice save now has a warning and a download. Before a new run is saved, its slot archives the original bytes. If writing the archive fails, the old slot stays intact and the game shows its save error.
- **C-04:** On short and landscape screens the arena keeps its size while battle controls remain reachable through scrolling. At 390×600 with 130% root text the English 2D board is 335 CSS px with or without the card panel, compared with the audited 180 px while the panel was open. At 844×390 the board is 308 px at both 100% and 130%, compared with 140 and 119 px in the audit. The same touch sequence selected the king and applied Stone Skin in 12 cases across Chromium and WebKit emulation.
- **C-02 and C-03:** Rules list damage, geometry and range for all six pieces in Russian and English. The displayed numbers share the core's strike definitions. The card instructions describe optional targets, and a ready targetless card prompts the player to apply it.
- **C-01:** The Vite fixture root uses the physical temporary directory path. Both HMR regressions exercise the WebSocket update and React Refresh check on the standard symlinked macOS `TMPDIR`. Cleanup retries if the cold Vite optimizer finishes a cache write while the server closes.
- **Mobile browser checks:** Home and End scroll the focused bestiary details while keeping its selector fixed. Audio initialization now waits for game entry or an audio control in the menu.

The [local listening demo](README.md#прослушивание-звуков) plays the shipped assets through the game's mixer. All 17 file checksums matched, and native Web Audio started all 17 effects and seven event sequences in both headless Chromium and WebKit. Both browsers also verified mute, local decisions, reload and report download. Physical phone play remains open. The owner's listening decisions are recorded above.

Local `npm run check` passed 1,196 tests in 94 files with two Vitest workers and the standard macOS temporary directory. The complete build, workspace and platform HTTP smoke tests passed. The first full browser rerun passed 35 cases and timed out opening Settings in a mobile test setup. After setting presentation preferences in the test setup and retaining real language and settings actions in dedicated cases, the full rerun passed all 36 cases with two intentional skips. The current CI checks for the review branch are tracked in [PR #29](https://github.com/decorum-guy/iva-games/pull/29/checks).

## Current-main integration after UI acceptance — 28 November 2026

UI revision `7f0af70d8db13a66b1c4c7b7e5445060651f5a05` passed all three PR workflows: [Colossus](https://github.com/decorum-guy/iva-games/actions/runs/46076270720) (138 game tests, 83 server tests, 27 browser cases; two mobile animation-observer duplicates intentionally skipped), [platform](https://github.com/decorum-guy/iva-games/actions/runs/46076270743) (1190 tests / 93 files, 47 infrastructure tests and all browser jobs), and [both release images](https://github.com/decorum-guy/iva-games/actions/runs/46076270721) with persisted-volume replacement. This confirms the repeated UI browser run described below.

Main subsequently advanced to `d243c5881b5511f01132aa601827a841e63d2f9b`. This review branch integrates that actual head, retaining its current District profile, compatible historical readers and public-catalogue release checks. The image-verification conflict is resolved by retaining both the registered-chess catalogue assertions and District profile assertions; both handoff histories are retained. No Colossus source changed during this integration. Current-head CI belongs to the resulting merge commit and is recorded in [PR #29](https://github.com/decorum-guy/iva-games/pull/29); earlier successful runs are not relabelled as that new commit's results. No merge into main or production deployment is part of this task.

The integrated local tree passed `npm run check`: **1196 tests / 94 files**, TypeScript, ESLint, registry and package boundaries. All **47 infrastructure tests** and `bash -n deploy/iva-games/verify-image.sh` passed. A separate source review confirmed the combined image assertions and profile arguments for both initial and restored containers.

## Menu, copy and Fast Refresh review — 28 November 2026

Source: the owner's difficulty-select screenshot, pasted Vite log and direct review of the checkout. This revision follows `b8738a7fbab65ed006f4e9197493c716e410b2fe` on the same review branch / [PR #29](https://github.com/decorum-guy/iva-games/pull/29). The complete-game baseline passed [Colossus review](https://github.com/decorum-guy/iva-games/actions/runs/46066814583), [platform checks](https://github.com/decorum-guy/iva-games/actions/runs/46066814600) and [release image checks](https://github.com/decorum-guy/iva-games/actions/runs/46066815194); those results belong to that baseline.

### Changes in this revision

- `Board2D.tsx` exported ordinary functions alongside its component. Re-evaluation changed those function identities, which the installed React Refresh validator rejected. `nextBoardSquare`, `squareLabel` and `BoardProps` now live in `boardHelpers.ts`; the board module has only a component runtime export. The similarly mixed, unused `pieceSymbols` export was removed from `PieceIcon.tsx` after a repository-wide reference search. No watcher, HMR or error handling was disabled.
- The difficulty caption inherited a negative top margin underneath an outside focus outline. It now occupies its own grid row with an 8px gap. Pointer selection keeps the native control focused without a lingering keyboard ring; Tab navigation has an inset 2px outline. The field is connected to its description using `aria-describedby`.
- Menu sections have explicit selection marks, distinct selected/hover treatments and mode-specific launch actions. The initiation caption correctly shows four commands. The mobile boss header is more compact so the four modes and launch controls are visible earlier; desktop artwork is retained.
- The bestiary has a fixed top selector, centered figure/name, previous/next arrows, wrapping navigation and left/right keyboard shortcuts. Incoming and outgoing portraits slide in the chosen direction. Details scroll independently and reset on a boss change. Navigation derives its count from `HUNT_BOSSES`; the training boss remains excluded. Application/system reduced motion and enlarged text are supported.
- RU/EN descriptions state effects and relevant targets/durations without repeated unrelated exceptions. The copy was independently compared with the current engine for card costs, armor order, shields, immunity, camps, fire and tutorial outcomes. Gameplay rules and numbers are unchanged.
- [Terra Max acceptance prompt](../../prompts/ACCEPT_COLOSSUS_TERRA_MAX.md) defines the independent gameplay/UI audit, including 24 hunt attempts for the current roster, both views, all cards, seven lessons, cooperation and detailed defect evidence. This is an audit assignment, not a claim that Terra has performed it.

### Checks actually performed before publishing this revision

- All **138 Colossus tests / 8 files** passed. Two regressions start real Vite servers against disposable source copies outside the watched checkout, save the board/icon modules, observe actual WebSocket HMR and validate freshly loaded exports using the installed React Refresh runtime. The mixed board export failed before extraction and passed afterward.
- Package boundaries, registry validation, root TypeScript and ESLint passed. The broad root test run passed 1,188 tests and hit a 5-second timeout in an unchanged REMORSE king-fracture test; its isolated rerun passed all four cases. This local broad run is recorded as a timeout, not an all-green result. The final published candidate's full CI is recorded in PR #29.
- The Colossus production build passed. Browser-driven E2E execution is assigned to the existing GitHub Actions job, including seven new menu/bestiary cases in addition to the previous 20 cases. Two additional entries intentionally skip the desktop animation observer on mobile projects; authored cases are not recorded as passed before execution.
- Direct browser interaction verified pointer/keyboard difficulty focus, 8px caption clearance, mode actions, all three bestiary bosses, wrapping, keyboard navigation, independently scrolling details and fixed selector geometry. At a **390×600 iframe viewport with 130% root text (20.8px)** the caption retained its gap, the page stayed 390px wide and the long Archivist title fit without clipping. This is viewport QA, not physical-device acceptance.

The pasted log also contains actual file-change events for `index.html`, `main.tsx`, `tsconfig.json` and `vite.config.ts`. The mixed-export fix addresses the confirmed Fast Refresh invalidation; it does not identify which process repeatedly wrote those files on the owner's Mac. HMR state preservation in that environment and a sustained idle reproduction remain explicit items for Terra's acceptance. The branch remains unmerged and production deployment is outside this review.

### Browser findings at the first UI checkpoint

[The first UI revision run](https://github.com/decorum-guy/iva-games/actions/runs/46075540143) on `32e8a22bf5a3e9e8437eecbdf0c11949f879ac73` passed 22 browser cases, failed five and intentionally skipped the two mobile copies of the desktop-only animation observer. All three new desktop menu/bestiary/animation cases passed. Four mobile cases exposed the same 6px horizontal overflow from the menu's decorative `::before` background: its inherited negative side insets extended beyond the mobile content. The mobile decoration now stays within its parent. Direct browser geometry reproduced the extra 6px; this was not fixed by weakening the overflow assertion. The remaining failure was an obsolete expected fallback phrase after the English copy revision; the real context-loss transition had reached the 2D board. Its assertion now expects the new user-visible message.

An additional controlled live-browser HMR check moved the king, selected the rook and saved a comment-only board edit. Vite reported the component hot update; every visible board label/selection/tab stop, round and command count remained identical. The comment was then removed and the source verified byte-for-byte against the published file. This tests the mounted interface in this browser; it does not attribute the owner's Mac file writes. Current-head repeat results are recorded in PR #29.

## Current review candidate — 27 November 2026

The owner's current request is a complete third chess game in a separate review branch, including a training-only boss, original 2D/3D assets, sounds and future boss/game registration. Source: the attached project entry file, current main and the existing PR #10 implementation. Branch: `feat/colossus-complete-20261127`, combining main `d397460689b717cbcb892d993dd33aa4d4631c49` and the prior Colossus branch `5597e7ac9582595e87066bd0116c3ed553db98e6`.

The first published checkpoint is [`243ca456`](https://github.com/decorum-guy/iva-games/commit/243ca456df28d61c145532b8b76e9681826f6d6a), [PR #29](https://github.com/decorum-guy/iva-games/pull/29). Current integration also preserves the subsequently published District work and OVERDRIVE tutorial through main `573669650be25278a30f048733e171d6ed297144`.

### Current changes

- Seven guided lessons against **The Warden / Смотритель**, with real core actions and a real final victory. The tutorial preserves an existing hunt, uses no hunt records and cannot enter ordinary or online games.
- Extensible `BOSSES` / `BOSS_BEHAVIORS` registration; all three ordinary bosses and their accepted rules remain. The practice helper now handles lethal king threats and the last round within the shared SDK evaluation contract.
- Original engraved SVG pieces and boss portraits, a square responsive 2D arena, 10 rebuilt GLB models including the Warden, animated movement/attacks/promotion/armor break, 3D context-loss fallback and reduced motion.
- 17 original WAV sounds, layered event sequences, move/capture/promotion sounds, gesture unlock, mute, bounded voices and duplicate network-audio suppression.
- Shared game registry drives the portal's RU/EN catalogue and guest links, chess builds, SPA routing, release health checks and image fingerprints. Existing deployment triggers/permissions and unrelated main work are preserved. See [GAME_REGISTRATION](../iva-games/GAME_REGISTRATION.md).
- Online SQLite shutdown waits for already accepted requests; exact retry receipts survive reopening the database. Release verification includes three independent chess databases and Colossus clients.

### Executed checks and remaining evidence

- Root `npm run check`: **1,049 tests / 80 files**, TypeScript, ESLint and package boundaries passed at the integrated local checkpoint. This includes the 17 registry validation tests. Browser checks are recorded separately before final publication acceptance.
- `npm run build:all` passed for all clients, both servers and the portal. `workspace:smoke` passed 52 checks and 338 byte-for-byte HTTP file comparisons across four layouts; `platform:smoke` passed two independent clients, a bot, three rounds and exact replay after a persistent restart. No external messages were sent.
- Root directly completed all seven tutorial scenes through the real browser UI in 2D: armor/HP, knight retreat, ray/fire comparison, shield, card lifetime, promotion and final victory. Returning to hunt preserved the previous normal game.
- Root directly inspected normal battle and tutorial at a **390×600 iframe viewport**, made a legal king move and completed the first lesson. A short-screen layout correction enlarged the measured board from about 190 to 246 CSS pixels. This is a browser viewport test, not physical-phone acceptance.
- Generated GLB headers, lengths, hashes and geometry passed integrity checks. Root and visual executor inspected software-rendered triangles from all 10 actual GLBs. Cloud browser WebGL is disabled by its environment; this software render is not browser 3D acceptance.
- Audio signal checks and event tests passed; listening on a target device has not been performed. Six synthetic hunts and one three-boss campaign completed with exact action replay; these do not establish human difficulty or balance.
- Registry/infrastructure and detailed component results: [core audit](CORE_AUDIT_2026_11_27.md), [audio/network audit](AUDIO_AND_NETWORK_AUDIT_2026_11_27.md), [assets](ASSETS.md).

The authored `Colossus review` CI runs the browser suite with software WebGL on desktop and two mobile viewports. Actual CI and container results must be attached to the published SHA; authored tests alone are not a pass. The review branch is not merged into main and no production deployment is part of this task.

### CI findings and review fixes

The integrated checkpoint `b13aff44441a22146a491f29bea00ccf4c58094f` was actually run in GitHub Actions:

- [Release images](https://github.com/decorum-guy/iva-games/actions/runs/46064511697) passed both real Docker builds and isolated runtime checks. The chess image served HTML, JS/CSS and API sessions with three SQLite databases; all passed again after replacing the container against the persistent volume. The platform image passed its equivalent two-database checks. Publishing and deployment were skipped for this review branch.
- [Platform checks](https://github.com/decorum-guy/iva-games/actions/runs/46064511733) passed the root check, infrastructure tests, complete build, platform smoke, portal browser suite and the District interface, trade and audio steps. The territorial browser step was still running when this entry was written; do not infer its result from earlier steps.
- [Colossus browser review](https://github.com/decorum-guy/iva-games/actions/runs/46064511747) passed 12 of 20 scenarios. This exposed real mobile card-panel overlap, 3D HTML cleanup errors on leaving a scene, and a focused accessible grid covering the view toggle. It also exposed a tutorial assertion matching both the boss wrapper and its SVG. Actual software WebGL context creation, framebuffer pixels and loading ordinary boss GLBs had passed before the teardown failure; that partial evidence is not full 3D acceptance.

This revision resets inherited mobile card-panel offsets, gives every Drei HTML label a stable dedicated portal whose children are owned only by Drei, and reserves space below the focused keyboard grid. The tutorial assertion now selects the unique visible boss wrapper. The card helper additionally checks that the target cell owns the actual pointer hit before tapping; clicks are not forced. Root directly applied Stone Skin to the king at 390×600 after the fix, observing shield 2 and focus reduced from 3 to 2. Targeted TypeScript, ESLint and diff checks passed. The new full browser result belongs to the resulting commit and is recorded in [PR #29](https://github.com/decorum-guy/iva-games/pull/29) and its checks; this entry does not predeclare a pass.

### Confirmed browser acceptance checkpoint

Revision `1e734d9cc6809240982032335e72c0bc6b45a0ce` passed [Colossus review](https://github.com/decorum-guy/iva-games/actions/runs/46065429762): **119 Colossus tests, 83 server tests, the complete build and all 20 browser scenarios**. The matrix covers desktop 1366×768 and mobile 390×844 / 390×600. All seven lessons, ordinary card targeting, interrupted-lesson save preservation, RU/EN and keyboard controls, local cooperation and two independent online clients with a lost ACK passed at each viewport. Desktop additionally passed WebGL2 context/framebuffer evidence, ordinary and training model loading, pointer movement, scene teardown/re-entry, promotion across views and continued play after deliberate context loss. The tests use normal clicks and taps. Both [release images and persistent-volume replacement](https://github.com/decorum-guy/iva-games/actions/runs/46065429795) also passed for this revision. The complete [platform CI](https://github.com/decorum-guy/iva-games/actions/runs/46065429783) subsequently passed as well: **1,171 tests / 91 files, 47 infrastructure tests**, all build/smoke/portal/District steps and the separate new OVERDRIVE tutorial job.

The final extension review additionally removes fixed campaign length/start/index assumptions and restricts campaign badges to the actual campaign roster. Existing three-boss order is retained. The new registry-driven campaign checks and integrated OVERDRIVE main belong to the next revision; its final result is linked to the exact head in PR #29. Previously passing checks are evidence for their recorded revision, not a substitute for that run.

## Historical implementation — 26 November 2026

Date: 26 November 2026 (Moscow). Rules version: `colossus-v1`.

The owner requested code implementation, attractive cards whose whole background expresses rarity, and three memorable special cards per boss obtained less often than player cards. This status records authored source and checks actually executed; it does not claim browser acceptance or deployment.

## Source and isolation

- Branch: `feat/colossus-v1`, [draft PR #10](https://github.com/decorum-guy/iva-games/pull/10), initially based on integrated platform/OVERDRIVE source `8d8556d`; accepted OVERDRIVE audio update `82668cd` and subsequent proxy/catalogue/zoom changes through `4a86989` were integrated. The later documentation-only handoff `156a3ac` is preserved too; it changes no tested source. Existing game source and the modular portal App remain identical to that accepted base.
- Rules imported from `ideas` at `583624db298792c107ce6418bd06087f30b310bb`; boss-card additions are in [CARDS_AND_PRESENTATION.md](CARDS_AND_PRESENTATION.md).
- Game package: `games/chess/colossus`, with independent assets, saves, rules, search worker, API protocol, guest cookie and SQLite database.
- Production activation, DNS changes and merging into the target/main are outside this implementation.

## Implemented

- Three bosses, sixteen player cards, nine boss cards, four difficulties, hunt/campaign/practice, solo, local cooperative play and durable online cooperative play.
- HP, armor, shields, fire, frozen announced intentions, movement collisions, attacks and knight retreats, promotion, two campaign camps and cooperative command ownership.
- Exactly three different cards per boss, drawn on rounds 3/8/13; open current hand and declared effect, no hidden additional attack, optional disable setting and separate result categories.
- Whole-card rarity materials: stone, lapis, amethyst and gold; readable rarity names and seals, twenty-five individual engravings and distinct boss ownership marks.
- RU/EN client, original GLB 3D scene and accessible 2D board, nine original sounds, damage/shield/fire feedback, reduced motion and cosmetic board/piece themes.
- Six interactive lessons using the real rules; isolated normal/practice/tutorial saves; practice editor, undo and public-position worker hints; pre-battle bestiary, difficulty medals, recent results and category-specific best hunts.
- Server-authoritative shared actions, private future decks/seed, exact durable acknowledgements, disconnect pause, explicit takeover and consensual restoration at a round boundary.
- Direct guest-game entry from the portal, combined and standalone client builds, three independent server health endpoints and release workflow coverage. Platform account rooms are not advertised as connected to this game runtime.

Original assets were published in `6d952d604e014f1657625ffcbfcb5d0b886e5765`; rules and transport in `31f5e5cde0c57bd1378d0fb267fca817685d6191`, full client in `cf3f142430323f3c41f8a1dea30c67f87b4d6d4b`. See [README.md](README.md) for run commands and [ASSETS.md](ASSETS.md) for provenance/generators.

## Executed local checks — integrated candidate

- `npm run check`: **907 tests passed in 66 files**, package boundaries, TypeScript and ESLint passed after the last core/UI fixes and integration through `4a86989`.
- `npm run build:all`: all three game clients, chess server, platform and portal built successfully.
- `npm run workspace:smoke`: **52 checks, 320 byte-for-byte HTTP file comparisons** across combined and three standalone layouts.
- `npm run platform:smoke`: two independent HTTP clients, three rounds, static assets, database restart and exact replay passed; external messages: zero.
- Within the above suites: **93 core/tutorial tests** and **79 chess-server tests**, including **14 COLOSSUS HTTP**, **5 client transport** and **2 new COLOSSUS trusted-proxy HTTP** tests.
- Twelve full positional battles plus one three-boss campaign completed and replayed identically after both final boss-card fixes. Seed 26011, public-position policy, 300-node budget. Campaign: 92 decisions, two camps, 20 total rounds. These results do not measure human win rate or establish final balance.
- Public catalogue HTTP/SSR checks confirmed Colossus in the chess collection, 1–2 players, RU/EN copy, direct guest launch and no claimed platform-room runtime. The final platform smoke includes all three chess games.
- SHA-256 and format checks passed for **9 GLB, 9 WAV and 25 SVG** assets. Seventeen additional executed Node assertions checked result categories/ranking and event feedback; they were not browser tests.

Detailed results, specific fixes and the 13-run table: [VALIDATION_2026_11_26.md](VALIDATION_2026_11_26.md). Raw logs, databases, screenshots and traces stay under ignored `.qa`, with no Actions artifact upload.

## Remaining acceptance

Browser acceptance has **not run**: local Chromium was unavailable and the Cloud Browser could not reach this workspace's localhost. Four public-UI Playwright scenarios are prepared for desktop/mobile, solo/card/reload, practice/tutorial isolation, all six lessons and two independent online contexts. Source compilation does not mean these scenarios passed.

Actual appearance, interaction, WebGL and sound on a target device still require browser/user acceptance. Asset integrity is not artistic approval; positional automated play is not human balance testing. Docker is unavailable locally; GitHub container check results must be recorded separately once observed. No production deployment has been performed.
