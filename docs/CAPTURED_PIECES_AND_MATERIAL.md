# Captured pieces and material advantage

The owner explicitly requested the familiar chess.com-style display: captured pieces **under each player's nickname**, with `+N` for the side ahead in material. This is a persistent HUD requirement, not a new capture animation.

The [Chess.com help article](https://support.chess.com/en/articles/8708638-how-can-i-see-the-captured-pieces-and-material-count) confirms that placement and positive-only advantage display. The following Remorse adaptations are our design decisions.

## Player blocks

Each side has a compact identity block adjacent to its end of the board:

- Nickname/side and a separate rating or bot-level label where applicable.
- Directly below: a row of enemy pieces actually captured by that player.
- A `+N` material badge beside that row only when this player is ahead. Show neither `+0` nor a negative score for the other player.

Keep both rows visible on laptop and phone. They must remain under the corresponding names rather than moving into a history tab. Board flip changes placement, not ownership of the ledger. Reserve row height before the first capture so the board does not jump.

Use consistent small SVG piece silhouettes, distinguish the victim's army color, and group repeated types/counts when needed on a 360 px screen. A group-level hover/tap target can expose the breakdown; tiny individual icons need not all be separate touch buttons. The row updates from committed state without a flying-trophy animation or extra panel.

## What belongs in a capture row

Use victim type and owner **at the time of capture**. An already promoted queen appears as a queen; a formerly friendly piece converted to the enemy appears in its current enemy color when captured.

| Event | Capture-row behavior |
|---|---|
| Enemy capture | Add one victim icon to the capturing player's row. |
| Mercy capture of devastated enemy | Same icon behavior; mercy only changes reaction processing. |
| En passant | Add the removed enemy pawn, using its actual square/identity. |
| Bloodlust captures a friendly piece | No enemy trophy. Record the friendly loss clearly in event history. |
| Devastated piece removes itself | No trophy for either side; record self-removal. |
| Ownership conversion | No capture icon; the piece remains on the board. |
| Promotion | No captured-pawn icon; only the kind changes. |
| AI search or legality probe | No live HUD or history changes. |

Do not infer captures by subtracting surviving pieces from the original 32-piece set. Conversion and promotion make that method incorrect.

A committed capture event contains a stable event ID, capturer ID/side, victim ID, victim kind/side at capture, victim square, landing square, enemy/friendly relationship and ordinary/en-passant kind. Field names are implementation choices. Preserve this victim snapshot even after the victim is no longer present in the live board.

Project the row from the current history branch/root ledger. Undo, redo, reload and replay restore it consistently; a separate unsynchronized UI counter is insufficient. Speculative events are never appended to the live ledger.

## Meaning of `+N`

Use the conventional material scale, as explained in [Chess.com's piece-value reference](https://www.chess.com/terms/chess-piece-value): pawn 1, knight 3, bishop 3, rook 5, queen 9; kings are excluded.

For side `s`:

```text
M(s) = pawns + 3*knights + 3*bishops + 5*rooks + 9*queens
advantage(s) = M(s) - M(otherSide)
```

Compute from the **current board and current owners**, not from capture icons. Show `+advantage` only if positive. A devastated rook still counts as 5 and a pacifist bishop as 3: this is deliberately a familiar count of material, not the engine's strategic evaluation.

Hover/tap explanation: «Условный баланс фигур на доске. Не учитывает состояния и позицию». Keep Elo visibly labeled elsewhere so the two numbers cannot be confused.

| Event, measured from White's perspective | Change in White's material balance | White capture icon |
|---|---:|---|
| White takes a black rook | +5 | Black rook |
| Black rook converts to White | +10 | None |
| Black queen converts to White | +18 | None |
| White bloodlust piece takes a white rook | -5 | None |
| Black queen self-removes | +9 | None |
| White pawn promotes to queen without a capture | +8 | None |

These are changes to the existing balance, not necessarily the final displayed value. A reaction/cure by itself does not change conventional material.

## Tutorials, custom roots and persistence

Every new tutorial position starts its own capture ledger. Earlier lessons' captures cannot carry into the next fixture.

When the final lesson continues into practice, retain the real capture ledger for **that current position** as an immutable root ledger, then append normal events. The existing undo barrier prevents undoing those pre-handoff captures. Preserve only the current position's repetition context as well.

For a prepared/imported position without prior history, begin an empty ledger and label the expanded detail «Взятия с начала этой позиции». Compute material immediately from the board. Never fabricate how absent pieces disappeared. Complete game exports include the actual root ledger and subsequent events.

## Acceptance

Verify ordinary, mercy, en-passant, promoted-victim, converted-victim and friendly captures; conversion/self-removal without a trophy; promotion's material gain; correct positive-only display; board flip; undo/redo; reload/replay; tutorial reset and handoff; and no changes from speculative search.

Inspect a congested phone state with both player rows, material badge, selected afflicted figure, tutorial instruction and bonus-turn control visible. Source and destination must remain accessible. The implementation must show the player's requested information throughout play, not only in a postgame report.
