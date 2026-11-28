# Test Bench implementation and acceptance journal

## Baseline — 28 November 2026

Direct source: owner-provided complete Library specification, preserved as SPEC.md. The active instruction authorizes implementation, two full acceptance cycles, one accepted release through PR/main and public verification.

- Origin/main: `357f60049e83b298bb5bbc2f760654fbd02384e3`.
- Isolated checkout: `iva-test-bench`; branch `feat/test-bench`.
- Generic transport owner: `feat/iva-realtime-foundation`, separate worktree and PR. No competing realtime branch or implementation appeared in the initial refs/PR inspection.
- Dedicated HTTP production-build stand: `127.0.0.1:4391`; development Vite: `127.0.0.1:5197`. Test databases/mail/profiles stay under ignored `.qa/test-bench` and `.runtime/test-bench`.
- Preserve existing District, chess, platform account and room contracts. Root owns portal/registration/build integration, game core owner owns pure rules/physics/runtime, scene owner owns original models/audio/rendering.
- Browser extension connection is unavailable in this chat. Cloud Chrome could not open the isolated local stand; direct browser play remains blocked. Separate automated Chromium contexts, when executable, are identified as automation. Physical-device/Safari/listening evidence may only be marked after it actually happens.

## Acceptance status

No completed personal acceptance cycles yet. No game release performed. The implementation is published in draft PR #44; browser acceptance remains incomplete.

Reports distinguish direct browser interaction, automated browser scenarios, headless simulation, actual listening, and physical devices. Never infer a completed cup from an opened screen or a passing build.

## Implementation checkpoint — pending acceptance

The game package contains the fixed-step Rapier chassis/cargo simulation, catalog and refit rules, three tracks, cup runtime, explicit bots, bounded simulation workers, durable receipts/checkpoints, original assets, 3D/Canvas2D scene, audio, RU/EN workshop/training/tutorial/match/results UI and portal account/room integration. Source presence is not a product acceptance claim.

The common live layer is published separately at [PR #42](https://github.com/decorum-guy/iva-games/pull/42), `feat/iva-realtime-foundation`; this game includes that tree. No common layer was present at the initial main baseline. A later Shift documentation branch describes a planned parallel layer but contains no published implementation at the checked ref; integration ownership must remain explicit.

See [ACCEPTANCE.md](ACCEPTANCE.md) for exact executed evidence, discovered defects, source corrections and browser access rejection; [ASSET_VALIDATION.md](ASSET_VALIDATION.md) separates geometry/signal checks from unperformed visual and listening acceptance. No merge or production release has occurred.

## First published game candidate

- Draft [PR #44](https://github.com/decorum-guy/iva-games/pull/44), branch `feat/test-bench`.
- Commit `6083e95d5bdd987a6fa220f5f81fcf08c59735cf`; exact source tree `1f6275152ad50997f76e2ab462c5a7521d20e1b1`.
- The authenticated GitHub connector published immutable blobs/tree/commit and created the new branch without force. The tree hash was verified against the local staged tree; fetching and fast-forwarding the local branch preserved all later unstaged diagnostics. The ordinary CLI push could not authenticate, so no CLI push success is claimed.
- Platform CI [run 46152314851](https://github.com/decorum-guy/iva-games/actions/runs/46152314851) and PR image validation [run 46152314952](https://github.com/decorum-guy/iva-games/actions/runs/46152314952) started for this exact SHA. Results belong in ACCEPTANCE.md after completion.
- Still **0 personal full browser acceptance cycles and 0 Test Bench production releases**. The expanded owner-pump performance gate failed and is recorded, not hidden by earlier narrower passes.

## Latest integration and browser evidence

The fourth published head was `67fea9ad23d36c12d27fe83af56e1ac077480b69`. Its CI tested the synthetic merge `a34d7b35d6fb73a234124b514ad7d15e06ae7562` with newly arrived main `aebb4223fa31e6687dc2873300081064fb09020c`. Ordinary check passed 1266/1266 tests and all previous-game browser scenarios; both image validations passed. The Test Bench browser job completed the six-step tutorial, settings/catalog/practice/touch/context-loss scope, then failed on a response-read race in its room-creation helper. It completed **0 full cups**. Exact links, hashes, measurements and defects are in ACCEPTANCE.md.

Main was incorporated normally into this feature branch with merge commit `62b564d31bbe020f1104e478655a08fcf34f4bb7`; its tree `332c397e497294128e64b318fd99767ce7ef7272` exactly matches the fourth CI checkout. No shared conflicts occurred and all District changes were retained. This is an integration **into the feature branch**, not a merge into main or a production release.

The next browser candidate fixes the helper race, waits for Bob's visible final roster before readiness, compares two loaded machines, and records real cold-transfer sizes. Two separate CI matrix cases use the production bundles: direct connection with optional cargo-pickup/two-person zero-score-tie coverage, and a measured loopback path with 60 ms delay in each direction. Their implementation is not evidence of successful execution. Targeted timeout ties are counted separately from normal driven cups with bots; neither counts as personal browser play.
