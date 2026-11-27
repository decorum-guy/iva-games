# COLOSSUS — audio and cooperative-runtime audit

27 November 2026. This audit continues the existing Colossus implementation in an isolated review branch. It records source changes and executed automated checks; it is not listening or production acceptance.

## Sound

The old event selector returned after its first match. Promotions and figure deaths had no dedicated cue, and a victory/card could suppress the impact that caused it. The new semantic cue plan preserves the action and its consequence in order: move → promotion, impact → armour break → victory, damage → capture → defeat. Simultaneous casualties produce one aggregate capture cue.

The original procedural bank now contains **17 mono 32 kHz, 16-bit PCM WAVs** (983,788 bytes): move, stone impact, armour impact, wound, shield, card, fire, victory, defeat, capture, armour break, minor-piece promotion, rook promotion, queen promotion, telegraph, heal and boss movement. The deterministic generator uses modal synthesis and filtered noise; there are no sampled or downloaded recordings. Each file has a SHA-256, duration, sample format and measured peak/RMS in its manifest. Generation measured a maximum peak of **−5.35 dBFS**, with no clipped samples.

Playback has at most four simultaneous voices, a shared 0.42 gain, explicit gesture unlock, Web Audio with a bounded HTML media fallback, and cancellation on mute, exit and document hiding. A run/revision key deduplicates command receipts. Network initial adoption, repeated revisions and skipped history are silent. The caller supplies the actual before/after states; no sound is selected by an animation or reconstructed future event.

`battleFeedback` also exposes actual promotion, death and armour-break events for both renderers. An eliminated unit retains its preceding square for its visual departure.

## Cooperative server

The Colossus gateway now accepts the shared HTTP drain promise. It rejects new work during shutdown, waits for accepted request bodies/actions to finish, then closes SQLite once. This preserves the newer main-branch graceful-shutdown contract when integrating the older Colossus branch.

The existing protocol whitelist accepts only Regent, Spire and Archivist and the hunt/campaign modes. New real-HTTP regression coverage explicitly rejects the tutorial-only Warden (`sentinel`) and tutorial/practice modes. A real partial-upload test begins a command, starts shutdown, finishes its body, reopens SQLite and retries the exact envelope; the saved command receipt and single resource spend survive.

## Executed checks

- `python3 games/chess/colossus/scripts/generate-colossus-audio.py`: 17 WAVs generated, no clipping; manifest written.
- `npx vitest run --config games/chess/colossus/vitest.config.ts games/chess/colossus/tests/unit/audio-feedback.test.ts`: **11 passed**. Covers all four promotions through the real rules, ordered result cues, shield absorption, casualty feedback, silent reload/catch-up, deduplication, cancellation, bounded voices and unsupported/autoplay-denied audio.
- `npx vitest run --config apps/server/vitest.config.ts apps/server/tests/colossusOnlineHttp.test.ts apps/server/tests/colossusOnlineClient.test.ts apps/server/tests/colossusTrustedProxy.test.ts`: **23 passed**. Includes independent HTTP clients, hidden future state, exact retries, restart, presence/takeover/return, trusted proxy, tutorial isolation and graceful command drain.

Human listening, physical-device testing and production deployment are separate from these checks. Full integrated browser results are recorded by the game acceptance owner.
