# Engine, state and future multiplayer

## Decision and evidence

Implement a custom TypeScript Remorse rules core and a real bounded search engine in a Web Worker.

The official [chess.js documentation](https://github.com/jhlywa/chess.js) describes orthodox move handling and game-status detection; it does not provide AI. [Fairy-Stockfish](https://fairy-stockfish.github.io/custom-variants/) supports configurable variants, but its [published configuration](https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish/master/src/variants.ini) does not document this full combination of stochastic reactions, per-piece memory, timed auras and variable actions per turn. **Engineering inference:** configuring or adapting a standard engine is not the shortest reliable route to this game. Do not spend the delivery building a speculative Stockfish fork.

The AI is called **Remorse Engine**. It is a custom search engine, not an LLM API, Stockfish integration, random mover or claimed grandmaster. It requires no paid account, remote inference or secret key.

## Compact architecture

Use one application with clear module boundaries, not a framework for arbitrary games:

| Module | Responsibility |
|---|---|
| `src/core` | Pure state, commands, geometry, attacks, legality, chance outcomes, passive settlement, adjudication and serializers. |
| `src/engine` | Heuristic evaluation, iterative search, move ordering, worker protocol and bounded search. |
| `src/session` | Authoritative local controller, revision validation, live RNG, command/event log, hotseat/AI seats and adapter interface. |
| `src/tutorial` | Lesson fixtures, objectives, UI guidance, scripted legal opponent and explicitly scoped tutorial roll provider. |
| `src/scene` | Models, camera, materials, picking, visual event queue and animation. |
| `src/ui` | Home/setup, HUD, inspector, dialogs, tutorial overlays and 2D view. |
| `src/storage` | Validated local saves, tutorial progress, export/import, undo/redo history and schema migrations. |

Names may be adjusted to fit implementation; the separation is mandatory. Keep the authoritative game state independent of React, Three.js, DOM, workers, network, wall-clock time and animation callbacks.

Prefer React 19 with React Three Fiber 9 and compatible stable Three/Drei packages; their [official compatibility guidance](https://r3f.docs.pmnd.rs/getting-started/introduction) pairs those major versions. Verify actual peer dependencies at install time. Use a lockfile. A successful Vite build is not a TypeScript check: run `tsc` separately, as documented in the [Vite guide](https://vite.dev/guide/features.html).

## State and pure APIs

Follow the full rules in `RULES_DIGITAL_V1.md`. State must include version, stable pieces, board occupancy, side, phase/bonus identity, completed-turn serial, afflictions and remembered reactions, capture counters, movement rights, en passant, deadlines/coverage progress, and outcome.

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

## Randomness and commands

The local session owns a checkpointed deterministic game PRNG, initially seeded from platform cryptographic randomness; it resolves a chance request once and records the result. A die animation only displays that result. State can pass through an internal awaiting-roll phase, but persist or commit atomically so reload cannot duplicate/forget a roll. Restore the PRNG state on undo; never reseed on a branch or use a new command UUID as an excuse to reroll an identical move from the same checkpoint.

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
- Use reasonable move ordering and a transposition table. Keys cover all rule-relevant information, including states, counts, remaining timers, rights and phase. Exclude presentation state and unknowable future RNG.
- Do not apply naive alpha-beta cutoffs to incomplete chance averages. Correct unpruned shallow expectation is preferable to incorrect “optimized” pruning.
- Always retain a scored legal fallback from a completed shallow pass. On interruption or deadline return the best completed result; never leave a move empty while legal play exists.

A useful heuristic combines material adjusted for actual capabilities, legal mobility, king safety, impending self-removal, bishop cure/conversion opportunities, and usable berserk actions. Friendly captures pay the loss of friendly material even when they create a tactical benefit. Do not value an immobilized doomed queen exactly as a healthy queen or an unable-to-capture bishop as an orthodox attacker.

Initial **tunable budgets**, not performance claims:

| Difficulty | Starting think budget | Behavior |
|---|---:|---|
| Easy | 150 ms | Shallow evaluated search; modest variety among reasonable moves. |
| Normal | 600 ms | Larger completed search; default. |
| Hard | 1,800 ms | More search and sharper move ordering; still bounded. |

Do not invent Elo. Increase/decrease budgets based on measured responsiveness on the actual Mac and mobile viewport/device. For tests, use fixed node budgets and deterministic ordering; wall-clock-limited search cannot be promised to choose identical moves on different hardware.

## Worker lifecycle

[Vite's supported worker pattern](https://vite.dev/guide/features.html#web-workers) is appropriate:

```ts
new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
```

Send `{ requestId, gameId, gameRevision, rulesVersion, publicState, budget }`. The worker imports the same core as the app. `publicState` must exclude future game RNG. Only accept a response with matching request/game/revision and a move that is still legal.

New game, undo, load, resignation, tutorial entry/exit and mode changes invalidate pending responses. A long synchronous worker loop cannot handle a cancel message until it yields; use termination/restart or bounded cooperative chunks when necessary. Do not implement cancellation by setting a flag that the blocked worker can never receive.

Recover from worker failure once, show a useful error if it persists, and keep local controls available. The engine must not freeze WebGL motion or leave a permanent “thinking…” state.

## Local persistence and replay

Persist a versioned snapshot and event history after committed decisions, including mid-bonus state if the player can reload there. Keep independent slots/session IDs for the active normal game, tutorial progress and current tutorial scenario. Entering learning must not overwrite a normal match. Validate schema on load and preserve a recoverable prior save when importing invalid JSON.

Use explicit history checkpoints for undo. Returning to a previous human choice against the bot must restore piece metadata, aura clocks, live RNG/recorded dice and worker state consistently. Continuing an unchanged redo branch uses its previous outcomes.

Replay verification must apply the actual commands and recorded chance results through the core, not simply replay a stored series of rendered boards. On tutorial handoff, use the exact final position as the normal game's root checkpoint and undo lower bound; previous teaching events/resets are read-only provenance, not normal undo/replay commands. Preserve any prior normal match as a recoverable checkpoint. A state hash may support validation; it is not an anticheat system for local games.

## Online later, local now

Provide a small `GameSession`/`GameTransport` contract that can submit a command, receive authoritative events/snapshots and expose current state. Implement local hotseat and local AI adapters now. Tutorial is another local controller using the same contract.

Document how a future server will:

1. Own authoritative state and random outcomes.
2. Authenticate seats and validate commands/revisions.
3. Deduplicate command IDs and emit ordered events with revisions.
4. Send a complete snapshot on reconnect and replay later events.
5. Reject stale/illegal actions without trusting a rendered client board.

A minimal in-memory duplicate/stale-command and snapshot/replay contract test is enough to prove this boundary. Do not implement production networking, accounts, matchmaking, database migrations, payments or a nonfunctional Online menu item now. Offline and future remote play must not need different legality engines.

## Evidence to deliver

Show legal moves from the real engine at all three levels; tactical fixtures involving variant mechanics; no live RNG mutation by search; no stale response after reset; and responsive animation during thinking. Run several seeded bot-versus-bot smoke games under a bounded action cap, preserving failures for debugging. Report actual outcomes and any capped games honestly. Do not measure strength with fabricated ratings or call a single random demo “tested AI”.
