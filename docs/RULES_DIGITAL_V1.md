# Remorse Digital v1 — normative rules

Ruleset ID: `remorse-digital-v1`. Preparation date: 2026-11-24, Europe/Moscow.

## 1. Authority and evidence

The source is the **user-supplied one-page PDF transcript**, preserved in `reference/remorse-chess-official-rules.pdf` and `reference/transcript.md`. Its title is “Remorse Chess_ Official Rules”. It contains explanations beginning at 00:00, 00:59, 02:01 and 03:02; it is not a formal specification covering every interaction.

Section 2 summarizes rules directly stated in that supplied source. Sections 3–11 specify **our implementation decisions** where the transcript is incomplete. The project owner explicitly authorized filling these gaps. They are binding for this implementation, but must not be attributed to the original creator as official clarifications. Expose them in a concise in-game “Digital rules” appendix.

If an actual contradiction is found during implementation, document the smallest consistent correction and add a focused test. Do not silently replace this variant with orthodox chess or mix in older web descriptions of Remorse.

## 2. Rules stated in the supplied source

| Topic | Source rule | Transcript section |
|---|---|---|
| Basic play | Pieces otherwise move/capture as in orthodox chess; win by checkmating the opposing king. | 00:00; 03:02 |
| First reaction | First qualifying capture rolls a d6: 1 devastated; 2–3 guilt-ridden; 4–5 unaffected; 6 berserk. | 00:00 |
| Persistent reaction | Once assigned, the piece has the same reaction on subsequent captures. | 00:00 |
| Devastation | Piece is immobile and at risk of self-capture after three full turns. It does not check, but still blocks. | 00:00 |
| Guilt | Piece can move but cannot capture or check; it still blocks. | 00:00 |
| Mercy | Capturing a devastated piece does not affect the capturing piece. | 00:59 |
| Absolution | A neighboring friendly bishop cures guilt/devastation after one full turn, passively; one bishop can affect multiple pieces. | 00:59 |
| Shame | A neighboring enemy bishop deteriorates a piece one step each full turn: ordinary → guilty → devastated → converted to the bishop's army. Existing afflicted pieces start from their current stage. | 00:59–02:01 |
| Defense | A bishop friendly to the target negates the hostile bishop effect and heals after one full turn. | 02:01 |
| Rebirth | A converted piece is reborn and must roll for its capture reaction again. | 02:01 |
| Berserk | A capture grants an extra move; maximum two moves in a turn. Bishops cannot heal or shame berserk pieces. | 02:01 |
| Bloodlust | After three total captures a berserker can move only by capturing; its extra move must also capture. Friendly captures are allowed. | 02:01 |
| King | Captures do not affect kings. An adjacent guilty/devastated piece is cleared immediately by Rally the Troops. Berserkers are not affected. | 02:01–03:02 |
| Knight | One free capture; receives its reaction on the second capture. | 03:02 |
| Bishop | Permanently pacifist. Capturing a bishop devastates the capturer, except a berserker. | 03:02 |
| Promotion | Carries reaction and current afflictions. Promotion to bishop is rebirth and clears guilt. | 03:02 |

## 3. Concepts that must remain separate

A piece has a stable identity, current owner, type and square, plus:

- `captureReaction`: unassigned, devastated, guilt, unaffected, or berserk. This is the **remembered disposition** established by a qualifying roll.
- `affliction`: neutral, guilt, devastated, berserk, or bloodlust. This is the **current functional state**.
- `capturesSinceRebirth`: every actual capture made by that identity since the most recent conversion/bishop rebirth.
- Devastation deadline and applicable aura progress.
- Movement history and any original castling eligibility.

Intrinsic bishop pacifism is not the same thing as guilt. A healthy bishop is still unable to capture or check. Healing a guilty rook clears its affliction but retains its assigned reaction: if that reaction is guilt, its next ordinary qualifying capture makes it guilty again without rolling.

“Unaffected” as a reaction means a normal capture does not impose a new affliction. It does not confer immunity to an enemy bishop's shame. Berserk/bloodlust confer that immunity. Conversion and bishop promotion reset reaction and count as specified below.

## 4. Time, adjacency and passive effects

### 4.1 Exact units and arming

- **Action:** one piece movement/capture, or the single command for castling. A promotion choice belongs to its movement command.
- **Player turn:** one primary action plus, when earned, at most one optional extra action by the same berserk piece. No arbitrary pass action exists.
- `turnSerial`: number of **completed player turns**, starting at 0.
- For effects in this version, **one full turn/cycle is two subsequent completed player turns**. It is not one movement and not a wall-clock duration.

An effect activated during a turn is armed at the boundary that closes that turn. If the current completed count is `n`, its `armedAt` is `n + 1`; it first matures at `armedAt + 2`. A fresh devastation expires at `armedAt + 6`. The activation turn and a berserk bonus do not age the new effect.

An effect created during boundary processing is armed at that boundary's already-incremented serial `c`, so it matures at `c + 2` or expires at `c + 6`. Never increment a timer once per animation or once per piece.

Example: White captures and becomes devastated; White's completed turn is serial 1. The displayed countdown is 3. It becomes 2 after serial 3, 1 after serial 5, and the piece is removed after serial 7 unless saved. A bishop contact established during White's turn closing at serial 1 first heals/shames at serial 3 if contact stays valid.

Show both the understandable countdown and enough progress to explain when the next stage happens. Do not label an individual berserk movement a full turn.

### 4.2 Neighborhood and continuity

Adjacent means any of the eight immediately neighboring squares: Chebyshev distance 1. A piece is not adjacent to itself.

For each target, aggregate coverage by friendly bishops and by hostile bishops. Multiple bishops never accelerate an effect. Coverage must remain uninterrupted. After **every action**, recompute whether coverage was lost; leaving and returning during a two-action turn resets progress. Replacing one source bishop with another while coverage never disappears preserves progress.

Healing does not precharge on a healthy target. Start its cure period when it is afflicted and friendly coverage exists. A new afflicted stage starts a fresh hostile stage period; do not immediately consume an older stage's nearly mature timer.

### 4.3 Friendly bishops and kings

Any adjacent friendly bishop immediately blocks and resets hostile shame progress on that target. Its actual cure still needs one full cycle of continuous coverage. If coverage ends, the partial cure is lost and hostile exposure may start afresh.

Bishops can themselves be shamed, devastated and converted. Their intrinsic pacifism persists in every state. **Their passive aura stays active even while guilty or devastated** until removed or converted; the transcript does not disable it. They cannot heal themselves.

Kings are immune to every mental affliction, conversion and self-removal. Rally affects **friendly** adjacent pieces only. It immediately clears guilt/devastation and its associated countdown; remembered reactions and capture totals remain. While rally coverage continues, hostile shame cannot accumulate on that target. Neither king nor bishop removes berserk/bloodlust.

### 4.4 Shame, conversion and removal

An unprotected susceptible target exposed for a full cycle advances once: neutral → guilt → devastated → conversion. An already guilty or devastated target uses its current state. Start a new period for each stage. Interruption resets partial progress, not an already applied stage.

On conversion: keep ID, type and square; change owner; clear current affliction and remembered reaction; reset captures since rebirth; cancel old timers and contact progress. Revoke original castling eligibility permanently. A pawn's forward direction becomes that of its new owner. No extra action is granted by conversion. Any resulting new aura begins a new period rather than acting again in the same boundary.

Devastation causes **automatic removal** at its deadline; no additional die is rolled. This is our interpretation of “at risk”, since the source specifies no second probability. Self-removal is not a capture: no capturer, capture credit, reaction or bonus. Healing or conversion maturing at that same boundary rescues the piece before removal.

### 4.5 Boundary settlement order

At completion of a whole player turn:

1. Increment `turnSerial` once and apply immediate friendly king rally.
2. Snapshot board, ownership, aura coverage/protection and due deadlines.
3. From that snapshot compute due cures and shame/conversions; each target resolves at most once. King protection and friendly bishop protection win over hostile shame. Kings and berserk/bloodlust are immune.
4. Compute due devastated removals, excluding pieces rescued by the same batch.
5. Apply the results as a simultaneous batch, independent of array iteration order.
6. Apply immediate king rally on the resulting board once.
7. Retain/reset/arm future timers from the resulting coverage and changed stages. Do not run another maturation cascade at this boundary.
8. Verify the mover's king safety, switch the side to act and adjudicate the resulting position.

A bishop converted or removed in this batch has contributed its snapshot aura under its old owner; its new aura cannot act recursively at the same instant. Rescued pieces can still block rays normally. All derived visual events follow the same recorded order.

**Implementation boundary:** passive settlement and terminal adjudication must be separate operations. A speculative legality probe runs the settlement transformations and checks king safety, but must not recursively adjudicate checkmate/stalemate. Adjudication may ask whether legal completed turns exist; those probes must not call adjudication again. Perform terminal adjudication once after committing the completed turn.

## 5. Captures: a single precedence table

First require legal movement/capture geometry. Neither king is ever a capture target. A bishop cannot capture. A guilty or devastated piece cannot capture. Only bloodlust permits a friendly non-king target.

After removing a legal target and moving the capturer, increment its capture total exactly once. Use the target's pre-capture type/state and capturer's pre-capture state for the following precedence:

| Priority | Condition | Result |
|---|---|---|
| 1 | Capturer is king | No roll and no mental change, including bishop capture. |
| 2 | Capturer already berserk/bloodlust | Keep that state; bishop penalty and mercy do not disable it. Reevaluate bloodlust threshold. |
| 3 | Target is bishop | Force current devastation, even for a knight's first capture or a devastated bishop target. Keep an existing remembered reaction; if none, leave it unassigned. |
| 4 | Target is a devastated non-bishop | Mercy: do not assign or apply a capture reaction. Capture still counts. |
| 5 | Unassigned knight makes its first capture since rebirth | Free capture: no roll. |
| 6 | Remembered reaction exists | Apply it without a new roll. |
| 7 | Otherwise | Resolve d6, assign the mapped reaction, apply it. |

The overlap between mercy and a devastated bishop is resolved deliberately in favor of the bishop penalty. King/already-berserk exceptions still take priority. The forced bishop penalty changes affliction, not the piece's remembered reaction.

Every actual capture counts toward the knight's first-capture exemption and berserk's total, including mercy, bishop and friendly captures. A knight whose first capture was mercy does not get another free ordinary capture. A knight whose first capture was a bishop still becomes devastated.

Next resolve the previously chosen promotion, apply immediate friendly king rally, and determine bonus eligibility from the resulting surviving piece state. A cured negative reaction stays remembered. Log the real reaction event even when immediate rally clears its effect.

## 6. Berserk and bloodlust

A primary **capture** by a piece that is berserk/bloodlust after resolution grants one further action with that **same stable piece ID**. This includes the capture that first rolls 6. A quiet primary move does not grant a bonus.

The total is at most two actions in the player's turn. Capturing again on action two never grants action three. A promoted piece with the same ID can use its new movement type on its bonus if its final state still allows it. A bishop promotion clears berserk and therefore cancels an earned bonus.

| Resolved event | Required phase transition |
|---|---|
| Primary action without a bonus | Complete the turn and settle once automatically. |
| Primary action with at least one legal extra action | Enter bonus phase; enable End Turn only when its settled result is safe. |
| Bonus earned but no legal extra action exists | Automatically complete safely. If this is unsafe, the primary action should already have been rejected by section 7. |
| Second action | Complete and settle exactly once automatically. |
| Explicit End Turn during bonus | Complete and settle exactly once. |
| Die reveal, animation completion or promotion presentation | No independent clock tick or turn completion; these display previously resolved logical events. |

The bonus is optional when ending the turn is legal. Provide an explicit End Turn command. If mandatory end-of-turn effects would expose the mover's king, but the bonus can prevent it, that bonus is required and End Turn is disabled with an explanation.

A berserk piece becomes bloodlust immediately when its **total captures since rebirth reaches three**, including captures before the roll of 6. If it reaches that threshold on action one, action two must be a capture. Bloodlust permits captures of friendly non-king pieces using the piece's normal capture geometry. Friendly en passant does not exist.

Bloodlust restricts the actions of that piece; it does not force the whole army to choose it. A player may select another legal piece. If no capture exists for the bloodlust piece, that piece simply cannot move. Declining a bonus remains allowed when ending is safe.

## 7. Check, king safety and completed turns

Use a dedicated geometric attack map; never recursively generate legal moves to decide attacks.

- Guilty/devastated pieces and all bishops contribute no direct attacks.
- Kings attack their adjacent squares; opposing kings may never become adjacent.
- Other pieces use normal capture geometry, occupancy and blockers. Bloodlust has ordinary immediate enemy-king threat geometry despite its ability to capture friendly non-kings.
- A pinned piece still contributes its geometric attack squares, as in ordinary king-safety reasoning.
- Do not treat hypothetical multi-action berserk paths as a present check.

After each individually resolved action, including reaction, promotion and immediate rally, the mover's king must be safe. Checkmate and stalemate are adjudicated **after the whole turn and passive settlement**, not between two berserk actions. An apparent check during action one may change after action two.

For stochastic and passive safety, use this bounded policy:

1. An offered primary action must be immediately safe for every possible reaction result.
2. For **each** such result there must be at least one safe completion of the turn: end now, or use at most one eligible extra action and then end.
3. “Safe completion” includes the exact deterministic boundary settlement and requires the mover's king to remain safe afterward.
4. If any possible result has no safe completion, the primary action is illegal. Do not reroll or condition the live die on getting a favorable legal result.
5. An offered bonus and End Turn must themselves have a safe settled result.

This is finite one-bonus lookahead, not unbounded recursive planning. The bonus piece is already berserk and cannot introduce a fresh capture-reaction roll. The rule prevents randomness from committing an unavoidable illegal own-king position.

Never physically capture either king, including by bloodlust. Do not replace checkmate with king capture or invent a “random self-check loss” rule.

## 8. Orthodox special moves and promotion

Orthodox geometry, initial setup and side-to-move conventions apply where not overridden here.

**Castling:** preserve historical king/rook rights and the usual empty-path and king-through-check constraints, using Remorse attack maps. Both king and rook must still belong to that side. A devastated rook cannot move, and a bloodlust rook cannot make a quiet castle; a guilty rook may castle. Conversion or promotion never grants castling rights. Losing/converting the original eligible rook removes its right even if another rook later occupies its square.

**En passant:** use ordinary pawn geometry and the recorded vulnerable pawn identity. The right lasts for the immediately following opposing player turn, including its bonus if applicable, unless that pawn is moved, captured or changes owner. Guilt/devastation prevents the capture. An en-passant victim's mental state still affects mercy; the captured square and landing square are different. King safety must reflect removal from the victim's actual square.

**Promotion:** Q/R/B/N are the choices. Include the choice in the move command **before** revealing a capture roll. Resolve the capture as a pawn, then promote. Non-bishop promotion preserves ID, reaction, current affliction and capture count. Promotion does not retrospectively apply a knight exemption to the promoting capture.

For a promoted knight with an unassigned reaction, only zero captures since rebirth leaves a first-capture exemption; an existing count or assigned reaction is not reset. Original and converted knights use the same rule.

Promotion to bishop resets reaction, current affliction and capture count, cancels devastation/aura progress and clears berserk/bloodlust. It becomes intrinsically pacifist. It retains its stable ID but gains no castling or movement-history rights. Promotion never creates a king.

## 9. Ending and draws

At a completed turn boundary, if the next player has no legal completed-turn action and its king is attacked, it is checkmate. If it has no legal completed-turn action and is not attacked, it is stalemate and a draw. Do not wait for future timers and do not invent a pass to escape stalemate.

Allow resignation and agreed draw in local two-player play. Bare kings is an automatic draw. Do not import an orthodox insufficient-material detector: bishop influence and berserk behavior change what material can accomplish.

Allow a threefold claim on the **complete semantic position**, not FEN alone: ownership, types, reactions, current states, relevant capture counts, turn/bonus phase, rights, en passant, and remaining aura/removal time. Exclude log length, revision, absolute serial origin and the secret RNG cursor from the equivalence key; normalize timers to remaining time. Stable identities must remain distinguishable where rights or contacts refer to them.

Expose a validated `ClaimRepetitionDraw` command and a conditional «Заявить ничью» control when the current completed-turn position has occurred at least three times. It is a decision available before the primary action, not during a bonus, and ends the game without ticking the clock. The AI can choose this draw action too. Recheck eligibility in the authoritative core.

The ordinary 50/75-move rules are disabled in v1 because the source does not define how variant progress resets them. This is an explicit digital decision. Tests may cap long self-play runs, but that cap is not a new game-over rule.

## 10. Persistence, undo and randomness

Versioned JSON is the authoritative format. Store all piece metadata, action phase, rights, deadlines, aura progress, resolved events, game revision and sufficient live RNG state or committed outcomes for replay. Standard FEN/PGN alone cannot represent this game. If notation is shown, call it Remorse move/event notation.

A committed d6 outcome is uniformly selected from 1–6 by the session's game RNG. Search and animation have no access to the future game RNG. Seed real games from the platform's cryptographic randomness, use an explicit deterministic generator for reproducible state/replay if desired, and record outcomes. Avoid biased integer sampling.

Undo restores a whole logical decision boundary and the checkpointed game PRNG state. Against AI, return to the previous human decision rather than stopping in a dangling AI bonus. A new game is seeded once; undo and branching do not reseed it. Preserve an existing redo branch and its rolls. Replaying the same semantic move from the same checkpoint has the same result, even after trying and undoing another branch or allocating a new command UUID. Do not expose an accidental “undo to reroll the same capture” loop. The normal game's undo lower bound after tutorial continuation is the handoff checkpoint; previous lesson resets remain read-only provenance.

The tutorial has its own explicitly labeled roll provider. Leaving it destroys future scripted outcomes and keeps all already committed piece reactions. Imported sessions validate schema, ownership, king invariants, timers and phase consistency; invalid input must not crash or mutate the current game.

## 11. Required rule fixtures

Use isolated legal positions and forced **test** outcome providers, plus a few integration sequences. At minimum cover:

1. All six faces, reaction persistence after healing, and neutral/unaffected susceptibility to shame.
2. Mercy, knight first/second capture, mercy-first knight, bishop penalty, king and berserk exceptions, devastated-bishop overlap.
3. Guilt movement/no capture/no check; devastated immobility/no check/blocking; bishop pacifism and continuing aura while afflicted.
4. Activation-turn exclusion, `+2` cure/shame, `+6` removal, bonus not ticking, interruption reset, no bishop stacking, no precharged cure.
5. Friendly protection, immediate allied king cure, berserk immunity, self-heal exclusion, simultaneous rescue versus expiry.
6. Shame sequence, conversion reset, pawn direction change, castling-right revocation and iteration-order independence of passive batches.
7. Immediate bonus after first roll 6, optional End Turn, no third action, threshold on the third total capture and friendly target constraints.
8. Per-action king safety, all-outcomes safety, passive discovered checks, compulsory safe bonus and mate only after a completed turn.
9. Castling with guilty/devastated/bloodlust rooks, en-passant discovered check, mercy en passant, promotion inheritance and bishop reset.
10. Full snapshot/replay roundtrip including bonus and timers; true semantic repetition versus equal board-only layout; no borrowed orthodox insufficient-material draw.

Fixtures should explicitly encode their source clause or digital decision. Do not claim all cases passed until executable tests actually exist and run.
