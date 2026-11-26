# COLOSSUS — implementation state

Date: 26 November 2026 (Moscow).

The owner explicitly requested code implementation of the complete proposed game, readable beautiful rarity backgrounds for cards, and three memorable special cards per boss obtained less often than player cards.

## Source and isolation

- Source base: `review/overdrive-v2-release` at `8d8556d4749a242c44b09b75aa5cff5f29a1b059`, containing the accepted platform and OVERDRIVE work.
- Working branch: `feat/colossus-v1`.
- Rules imported from `ideas` at `583624db298792c107ce6418bd06087f30b310bb`.
- Game package: `games/chess/colossus`, independent save/protocol/asset namespaces.
- Existing game source, production activation and main merging are outside this change.

## Current milestone

The package/configuration and source rules have been prepared. Pure rules, original models/audio/card art, client and authoritative cooperative transport are in implementation. No gameplay, browser acceptance or production deployment is claimed by this checkpoint.

The boss-card addition is recorded separately before its implementation. Arithmetic checks from the preceding design do not validate the new card effects or positional matches.

## Validation to record as actually executed

Pure rules and adversarial cases; deterministic positional games; source type/lint checks; client and server builds; real HTTP cooperative clients including restart/replay/privacy; browser solo/tutorial/card/mobile/3D checks. Keep screenshots, databases and raw game logs under ignored `.qa`, not committed or uploaded as Actions artifacts.
