# COLOSSUS — implementation state

## Current review candidate — 27 November 2026

The owner's current request is a complete third chess game in a separate review branch, including a training-only boss, original 2D/3D assets, sounds and future boss/game registration. Source: the attached project entry file, current main and the existing PR #10 implementation. Branch: `feat/colossus-complete-20261127`, combining main `d397460689b717cbcb892d993dd33aa4d4631c49` and the prior Colossus branch `5597e7ac9582595e87066bd0116c3ed553db98e6`.

The first published checkpoint is [`243ca456`](https://github.com/decorum-guy/iva-games/commit/243ca456df28d61c145532b8b76e9681826f6d6a), [draft PR #29](https://github.com/decorum-guy/iva-games/pull/29). Current integration also preserves the subsequently published District main `f00f0c949730893045a36e97b6ed08c8da55185c`.

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
