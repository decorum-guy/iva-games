# COLOSSUS — implementation state

Date: 26 November 2026 (Moscow). Rules version: `colossus-v1`.

The owner requested code implementation, attractive cards whose whole background expresses rarity, and three memorable special cards per boss obtained less often than player cards. This status records authored source and checks actually executed; it does not claim browser acceptance or deployment.

## Source and isolation

- Branch: `feat/colossus-v1`, initially based on integrated platform/OVERDRIVE source `8d8556d`; accepted OVERDRIVE audio update `82668cd` was merged without changing its content.
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

Original assets were published in `6d952d604e014f1657625ffcbfcb5d0b886e5765`; rules and transport in `31f5e5cde0c57bd1378d0fb267fca817685d6191`. See [README.md](README.md) for run commands and [ASSETS.md](ASSETS.md) for provenance/generators.

## Executed local checks — full UI checkpoint

- `npm run check`: **883 tests passed in 63 files**, package boundaries, TypeScript and ESLint passed after the last core/UI fixes and integration of `82668cd`.
- `npm run build:all`: all three game clients, chess server, platform and portal built successfully.
- `npm run workspace:smoke`: **52 checks, 320 byte-for-byte HTTP file comparisons** across combined and three standalone layouts.
- `npm run platform:smoke`: two independent HTTP clients, three rounds, static assets, database restart and exact replay passed; external messages: zero.
- Within the above suites: **93 core/tutorial tests** and **72 chess-server tests**, including **14 COLOSSUS HTTP** and **5 client transport** tests.
- Twelve full positional battles plus one three-boss campaign completed and replayed identically after both final boss-card fixes. Seed 26011, public-position policy, 300-node budget. Campaign: 92 decisions, two camps, 20 total rounds. These results do not measure human win rate or establish final balance.
- SHA-256 and format checks passed for **9 GLB, 9 WAV and 25 SVG** assets. Seventeen additional executed Node assertions checked result categories/ranking and event feedback; they were not browser tests.

Detailed results, specific fixes and the 13-run table: [VALIDATION_2026_11_26.md](VALIDATION_2026_11_26.md). Raw logs, databases, screenshots and traces stay under ignored `.qa`, with no Actions artifact upload.

## Remaining acceptance

Browser acceptance has **not run**: local Chromium was unavailable and the Cloud Browser could not reach this workspace's localhost. Four public-UI Playwright scenarios are prepared for desktop/mobile, solo/card/reload, practice/tutorial isolation, all six lessons and two independent online contexts. Source compilation does not mean these scenarios passed.

Actual appearance, interaction, WebGL and sound on a target device still require browser/user acceptance. Asset integrity is not artistic approval; positional automated play is not human balance testing. Docker is unavailable locally; GitHub container check results must be recorded separately once observed. No production deployment has been performed.
