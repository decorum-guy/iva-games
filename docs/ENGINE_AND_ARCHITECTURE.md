# Engine, state and future multiplayer

## Decision and evidence

Implement a custom TypeScript Remorse rules core and a real bounded search engine in a Web Worker.

The official [chess.js documentation](https://github.com/jhlywa/chess.js) describes orthodox move handling and game-status detection; it does not provide AI. [Fairy-Stockfish](https://fairy-stockfish.github.io/custom-variants/) supports configurable variants, but its [published configuration](https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish/master/src/variants.ini) does not document this full combination of stochastic reactions, per-piece memory, timed auras and variable actions per turn. **Engineering inference:** configuring or adapting a standard engine is not the shortest reliable route to this game. Do not spend the delivery building a speculative Stockfish fork.

The AI is called **Remorse Engine**. It is a custom search engine, not an LLM API, Stockfish integration, random mover or claimed grandmaster. It requires no paid account, remote inference or secret key.

[`RATING_AND_DIFFICULTY.md`](RATING_AND_DIFFICULTY.md) is the single normative source for the ten bot profiles, approximate internal Elo anchors, rating formula and Rated/Practice policy. Use one versioned preset table shared by UI, worker, saves and rating settlement; do not maintain a competing table here. [`CAPTURED_PIECES_AND_MATERIAL.md`](CAPTURED_PIECES_AND_MATERIAL.md) defines capture rows and the separate material indicator.

Both Russian and English are required in the first release. [`LOCALIZATION.md`](LOCALIZATION.md) is the normative localization brief; locale is a presentation preference, not a different ruleset or game session.

## Compact architecture

Use one application with clear module boundaries, not a framework for arbitrary games:

| Module | Responsibility |
|---|---|
| `src/core` | Pure state, commands, geometry, attacks, legality, chance outcomes, passive settlement, adjudication and serializers. |
| `src/engine` | Heuristic evaluation, iterative search, move ordering, worker protocol and bounded search. |
| `src/session` | Authoritative local controller, revision validation, live RNG, command/event log, root capture ledger, hotseat/AI seats, rated eligibility and adapter interface. |
| `src/rating` | Pure Elo calculation, versioned scale/preset references and validated rating-result records; no rating writes from the search worker or rules core. |
| `src/tutorial` | Lesson fixtures, objectives, UI guidance, scripted legal opponent and explicitly scoped tutorial roll provider. |
| `src/scene` | Models, camera, materials, picking, visual event queue and animation. |
| `src/ui` | Home/setup, HUD, inspector, dialogs, tutorial overlays and 2D view. |
| `src/i18n` | Russian/English catalogs and locale-aware presentation/formatting, separate from rule and session identities. |
| `src/storage` | Validated saves, tutorial progress, export/import, practice undo/redo and IndexedDB profiles, matches and atomic rating ledger. |

Names may be adjusted to fit implementation; the separation is mandatory. Keep the authoritative game state independent of React, Three.js, DOM, workers, network, wall-clock time and animation callbacks.

Prefer React 19 with React Three Fiber 9 and compatible stable Three/Drei packages; their [official compatibility guidance](https://r3f.docs.pmnd.rs/getting-started/introduction) pairs those major versions. Verify actual peer dependencies at install time. Use a lockfile. A successful Vite build is not a TypeScript check: run `tsc` separately, as documented in the [Vite guide](https://vite.dev/guide/features.html).

## Localization boundary

Store game/log events, result reasons, validation errors and tutorial objective identities as stable semantic codes plus typed parameters. Localize their text when rendering, including historical events; do not save Russian/English prose as the authoritative event or use translated strings as IDs. Keep locale preference separate from the saved rules state.

Language is excluded from rule/repetition hashes, RNG state, rating eligibility, worker request identity and session generation. Switching ru/en during a game or tutorial updates presentation without restarting the worker/session, rerolling dice, resetting lesson progress, replaying effects or invalidating a legitimate pending response. Preserve the current board, selection, turn phase and tutorial objective. This switch is permitted in rated play.

## State and pure APIs

Follow the full rules in `RULES_DIGITAL_V1.md`. State must include version, stable pieces, board occupancy, side, phase/bonus identity, completed-turn serial, afflictions and remembered reactions, capture counters, movement rights including explicit `pawnDoubleStepEligible`, en passant, deadlines/coverage progress, outcome and the public repetition context. A pawn's right to double-step cannot be reconstructed from its current rank alone, especially after conversion. Persist and validate that right according to the digital rules.

Keep the normalized semantic position key separate from repetition occurrence counts. The position key describes the current rule-relevant position; adding its history counts to that key would prevent recognition of a repeated position. The repetition context separately records occurrences at the boundaries counted by the rules and preserves the current position's actual history across saves and tutorial handoff. A custom root without known earlier history starts its own context; do not invent prior occurrences.

A useful minimal surface is equivalent to:

```ts
legalCommands(state): Command[]
enumerateOutcomes(state, command): WeightedTransition[]
applyResolvedCommand(state, command, outcome?): Transition
settleTurn(state): Transition
getOutcome(state): GameOutcome | null
serialize(state): SaveData
deserializeAndValidate(data): Result<GameState>
```

Exact APIs are up to implementation. A transition returns new state plus explicit presentation/log events. Pure functions do not generate random values or mutate an external store. They must support replay and the tutorial without maintaining a second rules implementation. `settleTurn`/`settlePassives` used by legality probes must not call `getOutcome`; otherwise outcome → legal commands → settlement → outcome becomes recursive. Separate state transformation, king-safety probing and committed terminal adjudication.

Do not prune primary actions merely with orthodox king-safety rules. Use the bounded all-outcomes/safe-completion policy in the digital rules. Keep attacks and complete-turn legality separate to prevent recursive move generation.

Validate imported data, tutorial fixtures and worker responses. One live piece per square, exactly one unconverted king per side, coherent ownership, valid phases, and deadlines consistent with that phase are hard invariants. Report errors without corrupting a running game.

## Capture events and HUD projections

A committed capture event is immutable and contains a stable event ID, capturer ID/side, victim ID/type/side **at capture**, victim square, landing square, friendly/enemy relationship and capture kind. Preserve this snapshot after removal; later ownership changes or promotion must not rewrite historical victims. Pure legality/search transitions may return speculative events to their caller but never append them to the live event log or alter the HUD.

Build each player's capture row from the session's immutable `rootLedger` plus committed events on the current history branch, following `CAPTURED_PIECES_AND_MATERIAL.md`. Keep friendly bloodlust captures, self-removal and conversion distinguishable from captured-enemy trophies. Practice undo/redo, load and replay change the projection through restored history, not through a separate mutable icon counter. Compute the material badge from current board types/owners; neither this conventional count nor capture totals determine Elo or replace the engine evaluation.

## Randomness and commands

The local session owns a checkpointed deterministic game PRNG, initially seeded from platform cryptographic randomness; it resolves a chance request once and records the result. A die animation only displays that result. State can pass through an internal awaiting-roll phase, but persist or commit atomically so reload cannot duplicate/forget a roll. Restore the PRNG state on practice undo; never reseed on a branch or use a new command UUID as an excuse to reroll an identical move from the same checkpoint. Rated gameplay undo is rejected by the session API.

Search sees the **distribution**, not the future seed/cursor. Evaluation and tie-breaking must not consume the live RNG. Keep any search PRNG independent. Replay uses recorded outcomes. Production games and the tutorial have different injected roll providers, with no persistent global “force next roll” switch.

Use a command envelope equivalent to:

```ts
type CommandEnvelope = {
  commandId: string;
  gameId: string;
  expectedRevision: number;
  actor: 'white' | 'black';
  command: GameCommand;
};
```

Promotion choice is in the move command. EndTurn is an explicit command only during an eligible bonus phase. `ClaimRepetitionDraw` is a validated pre-primary decision when the digital repetition rule permits it; include it in AI choices. Resignation, draw agreement and tutorial handoff are deliberate session events. Reject duplicate/stale commands idempotently; revalidate all received moves against the live core. Follow the automatic phase-completion table in the rules; do not leave a bonus phase waiting for a move that cannot exist.

## Search implementation

Implement iterative-deepening **expectiminimax** with a deadline and node limit:

- Player decision nodes maximize/minimize according to the actual side controlling the next decision.
- A berserk bonus belongs to the same player. Never alternate the side merely because one figure moved.
- First-reaction chance nodes average distinct outcomes with weights `1/6`, `2/6`, `2/6`, `1/6`. A forced bishop penalty, mercy, knight exemption or remembered reaction is not a random node.
- Search depth measures completed player turns; an extra movement or chance resolution does not alone consume one whole turn of depth.
- Score terminal wins/losses/draws before any heuristic. Prefer nearer forced wins and delaying forced losses where meaningful.
- Use reasonable move ordering and a transposition table. Keys cover all rule-relevant information, including states, counts, remaining timers, pawn double-step/castling rights and phase. Include sufficient repetition-history context in a cached search-value key, or conservatively avoid reusing scores across different histories. Identical current boards can have different draw-claim availability and future repetition outcomes. Reusing a move-ordering hint must not reuse an invalid score. Exclude presentation state and unknowable future RNG.
- Do not apply naive alpha-beta cutoffs to incomplete chance averages. Correct unpruned shallow expectation is preferable to incorrect “optimized” pruning.
- Always retain a scored legal fallback from a completed shallow pass. On interruption or deadline return the best completed result; never leave a move empty while legal play exists.

A useful heuristic combines material adjusted for actual capabilities, legal mobility, king safety, impending self-removal, bishop cure/conversion opportunities, and usable berserk actions. Friendly captures pay the loss of friendly material even when they create a tactical benefit. Do not value an immobilized doomed queen exactly as a healthy queen or an unable-to-capture bishop as an orthodox attacker.

Search receives public occurrence counts for the real history at its root and maintains a separate branch-local count delta along each hypothetical path. Count each newly completed simulated turn once, not every chance outcome, bonus action or legality probe. If the root is a counted turn boundary, its occurrence is already included and must not be counted a second time; a mid-bonus root is not a counted boundary. Sibling branches must not leak counts into one another. Generate `ClaimRepetitionDraw` from the combined real-history/path context, including repetitions created during search.

Implement all **ten actual profiles** in `RATING_AND_DIFFICULTY.md`. They differ through search limits and bounded choice weakening, not an artificial wait or renamed identical behavior. Default is level 4. Use the specified independent engine RNG and same-depth candidate selection; preserve the best completed iteration and meaningful legal fallback on a deadline.

Tune the documented initial profiles against measured responsiveness on the actual Mac and mobile viewport/device, recording the preset version if parameters change. Approximate Elo anchors are explicitly provisional internal values; do not claim external or measured human strength. Graphics quality does not silently change a rated bot preset. For tests, use fixed node budgets and controlled independent engine RNG; wall-clock-limited search cannot be promised to choose identical moves on different hardware.

## Worker lifecycle

[Vite's supported worker pattern](https://vite.dev/guide/features.html#web-workers) is appropriate:

```ts
new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
```

Send a request equivalent to `{ requestId, gameId, gameRevision, sessionGeneration, rulesVersion, engineVersion, presetId, presetVersion, publicState, repetitionContext, budget }`. Derive the budget from the shared validated preset. The worker imports the same core as the app. Public state/context include the piece rights and actual repetition counts needed for legal play, but exclude future game RNG and private profile data. The worker tracks its own hypothetical path counts as described above. Only accept a response with matching request/game/revision/generation/preset and a command that is still legal.

New game, practice undo, load, resignation, tutorial entry/exit, allowed practice difficulty changes and controller changes invalidate pending responses. These actions must first pass the Rated/Practice lifecycle policy; canceling a worker is not permission to erase a rated match. A long synchronous worker loop cannot handle a cancel message until it yields; use termination/restart or bounded cooperative chunks when necessary. Do not implement cancellation by setting a flag that the blocked worker can never receive.

Recover from worker failure once, show a useful error if it persists, and keep local controls available. The engine must not freeze WebGL motion or leave a permanent “thinking…” state. A worker/rendering failure never fabricates a game win or loss; an unrecoverable technical abort follows the no-rating policy in `RATING_AND_DIFFICULTY.md`.

## Local persistence and replay

Persist a versioned snapshot, repetition context, `rootLedger` and event history after committed decisions, including mid-bonus state if the player can reload there. Keep independent session IDs/slots for the reserved active rated match, practice match, tutorial progress and current tutorial scenario. Entering learning or creating practice continuation must not overwrite the rated match. Validate schema on load and preserve a recoverable prior save when importing invalid JSON.

Gameplay undo is available only in practice/unrated sessions, including hotseat; enforce the prohibition for rated matches below the UI. Use explicit history checkpoints. Returning to a previous human choice against the bot restores piece metadata, aura clocks, pawn movement rights, repetition context, root/branch capture ledger, live RNG/recorded dice and worker state consistently. Continuing an unchanged redo branch uses its previous outcomes. Reviewing a completed rated game is read-only; analysis creates a distinct practice session without changing its result.

Replay verification must apply the actual commands and recorded chance results through the core, not simply replay a stored series of rendered boards. Replay is read-only for the live rating ledger. A file import always creates an unrated session, even if the file claims to be rated; automatic internal resume preserves the existing match's ID and eligibility.

Tutorial handoff always creates **practice against level 4** from the exact current position. Preserve that scenario's actual repetition context separately, and retain its capture history as the immutable root ledger. Destroy future scripted rolls and establish the handoff checkpoint as the ordinary undo lower bound. Previous lesson resets/history remain read-only provenance and never become commands in the continued match. Preserve any prior rated/practice match separately. A state hash may support validation; it is not an anticheat system for local games.

## Local Elo settlement

Follow `RATING_AND_DIFFICULTY.md` for the sole formula, eligibility rules, fixed bot anchors and activation threshold. The rules core reports a genuine game outcome; the session validates eligibility; the rating module computes a result; storage commits it. Rendering, animation callbacks, historical replay and the search worker never award Elo.

Use IndexedDB stores equivalent to `profiles`, `matches` and `ratingLedger`. Reserve the profile's sole rated-match slot transactionally at creation, distinguishing this reservation from activation after the first human primary move. Before activation the reservation may be canceled without score; another tab cannot retain a competing stale rated match. Freeze the configuration/rating snapshot required by the rating document and check persisted match/profile revisions before accepting conflicting writes.

For an eligible terminal result, one IndexedDB transaction finalizes the match, inserts the unique ledger record keyed by match ID and updates the profile. Duplicate settlement returns the already recorded result without applying another delta. Unrated play and technical aborts do not award rating. Never split these operations into independent localStorage writes. A crash, reload, repeated UI event or second tab cannot partially commit or duplicate the rating change.

After activation, replacing a rated match follows the explicit in-game resignation path. Closing a tab, changing view or opening learning only suspends the same match. Completed rated results are immutable; a rematch has a new ID. If durable storage is unavailable, offer practice rather than claiming saved rated progress. Local profiles are browser-specific until a future explicit synchronization feature exists.

## Online later, local now

Provide a small `GameSession`/`GameTransport` contract that can submit a command, receive authoritative events/snapshots and expose current state. Implement local hotseat and local AI adapters now. Tutorial is another local controller using the same contract.

Document how a future server will:

1. Own authoritative state and random outcomes.
2. Authenticate seats and validate commands/revisions.
3. Deduplicate command IDs and emit ordered events with revisions.
4. Send a complete snapshot on reconnect and replay later events.
5. Reject stale/illegal actions without trusting a rendered client board.
6. Own rated eligibility and exactly-once result/rating settlement instead of trusting client profile edits.

A minimal in-memory duplicate/stale-command and snapshot/replay contract test is enough to prove this boundary. Do not implement production networking, accounts, matchmaking, server database migrations, payments or a nonfunctional Online menu item now. Local IndexedDB schema versioning/migrations remain required. Offline and future remote play must not need different legality engines.

## Evidence to deliver

Show real, distinct profile configuration and valid play at **all ten levels**. Run a small deterministic tactical/mixed-position suite with fixed budgets and controlled engine randomness, plus bounded color-swapped low/middle/high self-play samples. Report actual depth/nodes/time, outcomes and capped games; these checks do not calibrate the provisional Elo anchors or establish human-equivalent strength.

Verify variant tactics; no live RNG mutation by search; public root/path repetition handling and history-safe transposition reuse; pawn double-step rights after conversion; no stale worker response after reset or a permitted profile change; and responsive animation during thinking.

Verify the rating formula and exactly-once IndexedDB transaction through duplicate delivery, reload, conflicting tabs and interrupted finalization. Prove Rated/Practice restrictions through the session API, all import/tutorial exclusions, suspension versus resignation, and no Elo from technical errors or practice undo. Verify capture-event snapshots, root-ledger handoff, branch-aware capture rows and material recalculation without speculative HUD mutation. Do not report these as passed before executable checks and browser inspection actually run.

Verify ru/en switching during an active AI search, bonus phase and tutorial step: the state/hash, RNG, rating eligibility and controller identity stay unchanged while current and historical UI text changes language. Follow the full two-language coverage checks in `LOCALIZATION.md`.

## Implementation in this repository

`GameSession` accepts identified commands with an actor and expected revision. Its snapshot exposes the public rules state, committed events and root capture ledger. The local implementation returns a new session after a valid decision. A future remote transport can preserve the same interface, validate the seat on the server and return an authoritative snapshot on reconnect.

Version 1 saves use a validated root snapshot, its private RNG seed and a log of accepted commands with resolved dice. The cursor selects the current history branch. Loading verifies the schema and replays the commands through the same core used during play. The optional tutorial origin preserves the educational history as read-only evidence, outside the practice undo range. Imports allocate a new unrated identity.

The bot receives only public state and the request identity. A worker result has to match the active game, revision, session generation and preset, and its command must still pass the normal session checks. The controller terminates a superseded worker and retries a failure once before offering recovery. Rated reservation and settlement use IndexedDB transactions, with the rating ledger keyed by match ID.
