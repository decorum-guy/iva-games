# REMORSE: independent semantic rules audit

Audit basis: `d074f6e` in `/workspace/scratch/1cb66931ebbc/remorse-online`. The production rules engine was not edited by this audit. The audit read the retained transcript, the digital specification, the core implementation, selected existing unit tests and the player-facing rule copy. It did not inspect the Mac build, the owner's saved games, audio or browser presentation.

## Result

No confirmed critical or high-severity violation of `remorse-digital-v1` was found in the inspected rules core. This is an evidence-bounded finding, not proof that every legal position is correct. One repetition equivalence edge case is documented below; it is compatible with the literal stored-EP wording of v1 but differs from the ordinary chess expectation that only effective move rights distinguish positions.

The main confirmed problem is presentation: the player-facing rule text mixes the essential causal sequence with import invariants, capture precedence and rare king-safety cases before the reader has a compact model of the game. Simplifying presentation should not silently change the rules.

## Sources inspected

- `docs/reference/transcript.md`: supplied original rules transcript. The adjacent PDF was not separately rendered in this audit.
- `docs/RULES_DIGITAL_V1.md`: normative decisions filling gaps in the original.
- `src/core/rules.ts`, `geometry.ts`, `passives.ts`, `state.ts`, `types.ts`.
- `src/core/rules.test.ts`: selected concrete tests and the overall test inventory.
- `src/i18n/rules.ts`: current player-facing Russian and English rule text.

The old conversation example “4 means guilt” is inconsistent with the original. The original and implementation agree on **1 devastation; 2–3 guilt; 4–5 unaffected; 6 berserk**. New tutorial copy must preserve this mapping.

## Source rules versus explicit digital decisions

These are important distinctions for an audit. The digital choices below are not quotations from the source and are not implementation bugs merely because the short original does not specify them.

| Topic | Source rule | Implemented explicit digital decision |
| --- | --- | --- |
| Time | One full turn for bishop effects, three full turns for devastation | Two subsequent completed player turns per cycle; the activation turn does not count; a bonus action does not advance the clock |
| Devastation | Immobile, at risk of self-removal after three full turns | Automatic removal at the deadline without another die roll |
| King | Immune to capture reactions, immediately rallies adjacent afflicted pieces | Rallies friendly neighbors only; king is also immune to bishop shame/conversion |
| Bishops | Pacifist, heal/shame adjacent pieces | Eight surrounding squares; no aura stacking; a guilty/devastated bishop retains its aura; it cannot heal itself |
| Overlapping capture exceptions | Several exceptions appear separately | King → existing frenzy → bishop victim → mercy → first knight capture → memory → roll |
| Bishop victim | Capturing a bishop devastates the capturer, except frenzy | King immunity wins too; even a devastated bishop still applies the bishop penalty; this penalty does not overwrite prior memory |
| Bonus turn | At most two moves after a berserk capture | Same piece only; optional when safely ending is possible; compulsory only when needed to avoid passive self-check |
| Conversion | Rebirth, reset reaction | Reset current state, memory and capture count; permanently revoke original castling/double-step rights; pawn follows its new color's direction |
| King safety | Ordinary checkmate goal | Own king safe after every action and after deterministic boundary effects; every possible reaction must allow a safe completion |
| Simultaneous effects | Not specified | Shared pre-settlement snapshot; healing/conversion can rescue before removal; new aura starts a new countdown |
| Draws | Checkmate goal, otherwise not expanded | Stalemate/bare kings; semantic threefold claim; no orthodox insufficient-material shortcut or 50/75-move rule |

## Independent executable checks

The independently authored checks are retained as `tests/unit/core-independent-audit.test.ts`. Run with:

```sh
npx vitest run tests/unit/core-independent-audit.test.ts --reporter=verbose --silent=false
```

The run passed **5 test groups**:

1. **400 mixed boards**, each checked on all 64 squares for both sides: 51,200 comparisons of the core attack map with a separately written coordinate-based oracle. It does not reuse the core's rays, offsets or attack helpers. Bishops, guilty and devastated pieces never attack; they remain blockers. These generated boards test the geometric subsystem and are not all reachable full game states.
2. **800 simultaneous passive batches** compared with separate adjacency/deadline calculations. Also checked the same batches in reverse piece-array order. These are subsystem fixtures, not claims of 800 live games.
3. **235 capture cases** covering all six actual die faces, remembered reactions, mercy captures, bishop penalties, knight first-capture exemption, existing frenzy and bloodlust threshold. Resulting complete states passed validation.
4. **12 deterministic random game runs** from the initial position: **1,538 commands**. After each command, independent geometry confirmed the mover's king was safe, and a JSON-roundtrip state passed validation. **Two runs finished naturally; ten reached the test cap.** These were code-level generated games, not human/browser play or engine strength calibration.
5. A targeted reproduction of the inactive en-passant repetition distinction described below.

Existing tests additionally cover castling with afflicted rooks, attacked castle paths, en-passant discovered check, promotion ordering, memory after healing, passive rescue deadlines, required bonus completion, mate only after a complete turn and repetition context. Reading those tests is supporting evidence; it does not replace the independent checks above.

## Repetition: effective versus stored en-passant right

**Classification:** low-frequency semantic decision to resolve, not a proven violation of the literal v1 document. Do not casually rewrite existing save keys.

`positionKey()` includes the en-passant target and vulnerable pawn ID even when no legal capture can use that right. Reproduction:

- White: Ka1, Nb1, Pe2 with original double-step right.
- Black: Kh8, Ng8. White to move.
- Play e2–e4.
- Repeat `Ng8–f6, Nb1–c3, Nf6–g8, Nc3–b1` twice.

There are now three occurrences with the same board, same side to act and the same legal commands. The initial one has an unusable en-passant marker; the following two do not. The stored counts are 1 and 2, so a threefold claim is unavailable.

For orthodox-style semantic repetition, an ineffective EP marker should not distinguish positions. However, the current digital text explicitly includes EP rights in the key without defining effective capturability. Treat changing this as a specification and migration decision.

**Variant-specific trap:** checking only a currently adjacent pawn is insufficient. In REMORSE, a pawn may reach a legal EP capture on its bonus action after its first capture. Any refinement must account for the entire current turn, preserve all-outcome safety, avoid recursion between position-key construction and move adjudication, and handle historical save/repetition keys.

## What a new player must learn

The following wording is suggested player copy, derived from the inspected rules; it is not source quotation.

- **First capture:** “Фигура взяла соперника. Кубик определяет, как она пережила это взятие. Результат запоминается: при следующих взятиях та же реакция вернётся без нового броска.”
- **Guilt:** “Ладья чувствует вину за взятие. Она может ходить, но больше не берёт фигуры и не даёт шах.”
- **Devastation:** “Фигура опустошена: она не может двигаться. Если её не спасти, через три пары ходов она исчезнет.”
- **Bishop:** “Слон не берёт фигуры и не даёт шах. Он влияет на восемь соседних клеток: своих лечит, чужих постепенно обращает на вашу сторону.”
- **Timing:** “Подвели слона. Соперник сделал ход, затем вы сделали ход — если фигуры всё ещё рядом, эффект сработал.” Explicitly teach that the approach/activation move is excluded, and the two actions of frenzy are one player turn.
- **Memory versus healing:** “Лечение снимает вину или опустошение, но не стирает память. Следующее обычное взятие снова вызовет ту же реакцию.” Also distinguish shame from memory: a neutral piece shamed by a bishop does not automatically remember guilt as its capture reaction.
- **Enemy bishop:** “Первый цикл — вина. Второй — опустошение. Третий — фигура переходит на сторону слона.” An already afflicted piece starts from its current stage; moving away stops the countdown, not an effect already applied.
- **Frenzy:** “После взятия этой фигурой можно сходить ещё раз. Другую фигуру для второго хода выбрать нельзя.”
- **Bloodlust:** “После третьего взятия ярость превращается в жажду крови. Теперь эта фигура ходит только со взятием — при необходимости можно взять и свою фигуру.” Capture count includes earlier mercy captures; the restriction belongs to this piece, not the whole army.
- **King:** “Свой король сразу снимает вину и опустошение с соседей. Ярость и жажду крови он не лечит.”
- **Mercy:** “Взятие опустошённой фигуры не вызывает реакцию. Но взятие слона — отдельное правило.”

Do not frontload rare exceptions. The complete reference still needs capture precedence, ally-only rally, promotion inheritance, castling/conversion rights, passive self-check, all-outcome legality and draw details. Make those accessible in a secondary reference section and give a specific contextual reason when they prevent a move.

## Tutorial ordering required by these rules

For each new reaction, the causal order should remain visible: **capture → die stops on a visible face → the captured piece's reaction is named → camera/light shows the affected piece → concise consequence → one required action**. Hold the explanation before the opponent or a timer demonstration changes the position. Teach the first timing example with two visible completed turns. Do not treat a camera effect or a scripted legal click as proof that the player understood why the rule applied.

## Limits

This audit gives no acceptance claim about the running Mac build, physical phones, current saved games, tutorial readability in motion, sounds or network transport. No P0/P1 core defect was found, but the sample checks do not enumerate every possible game state. Production-core edits were not made. The en-passant equivalence behavior is preserved for v1; revising it requires an explicit compatibility/migration plan.
