# COLOSSUS — implementation state

Date: 26 November 2026 (Moscow).

The owner explicitly requested code implementation of the complete proposed game, readable beautiful rarity backgrounds for cards, and three memorable special cards per boss obtained less often than player cards.

## Source and isolation

- Source base: `review/overdrive-v2-release` at `8d8556d4749a242c44b09b75aa5cff5f29a1b059`, containing the accepted platform and OVERDRIVE work.
- Working branch: `feat/colossus-v1`.
- Rules imported from `ideas` at `583624db298792c107ce6418bd06087f30b310bb`.
- Game package: `games/chess/colossus`, independent save/protocol/asset namespaces.
- Existing game source, production activation and main merging are outside this change.

## Current milestone: rules and authoritative transport

Original assets are published in `6d952d604e014f1657625ffcbfcb5d0b886e5765`: nine GLBs, nine WAVs, twenty-five individual card engravings, reproducible generators and SHA-256 manifests. Their manifest hashes and GLB/WAV structure were checked locally. This is asset generation evidence, not the owner's artistic or listening acceptance.

The pure rules now implement the three bosses, all sixteen player cards, all nine boss cards, four difficulties, hunt/campaign/practice, promotion, camp, shields, fire and cooperative command ownership. The server uses a separate Colossus protocol, cookie and SQLite database, immutable public views, durable command acknowledgements, disconnect pause and consensual control restoration. The client and browser presentation are being integrated; this checkpoint does not claim completed browser acceptance or deployment.

Executed checks at this milestone:

- 93 rules/tutorial tests passed: 86 rules and adversarial interaction checks plus seven live-core teaching sequences across six lessons.
- Full existing chess server suite passed: 70 tests in seven files, including thirteen real Colossus HTTP tests and four client recovery tests. Separate cookies, SQLite restart, command races/replay, private deck redaction, takeover and returning control are exercised.
- TypeScript and scoped ESLint passed for the core/engine/tests and server. Server production bundle and package-boundary check passed.
- Twelve full positional battles (three bosses × Knight/Veteran × boss cards off/on) plus one three-boss campaign completed and replayed to identical final states. Seed 26011; one deterministic public-position policy, 300-node search budget. Separate battles ended in 5–9 rounds; the campaign executed 87 decisions and both camps. Raw logs stay under ignored `.qa/colossus-balance`.

The positional results establish executable, winnable and reproducible scenarios. They do not measure human win rates, difficulty or long-term balance. No base numbers were changed solely to fit this policy. The preceding arithmetic-only design check is historical evidence and is not counted as one of these positional matches.

## Validation to record as actually executed

Pure rules and adversarial cases; deterministic positional games; source type/lint checks; client and server builds; real HTTP cooperative clients including restart/replay/privacy; browser solo/tutorial/card/mobile/3D checks. Keep screenshots, databases and raw game logs under ignored `.qa`, not committed or uploaded as Actions artifacts.
