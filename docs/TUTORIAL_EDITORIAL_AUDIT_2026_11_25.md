# Rules and tutorial editorial audit — 2026-11-25

## Scope and evidence

This review used the supplied source transcript (`docs/reference/transcript.md`), the normative `remorse-digital-v1` rules, every authored step and required explanation in all nine lessons, the controller, and the rulebook/lesson presentation code. It is a source and executable lesson review. It is **not** a report of a live visit to the owner’s Mac, port 4173, or a physical phone.

The work changes explanation and presentation, not game mechanics. Lesson IDs, position order, step IDs, commands, dice outcomes, setup positions, and saved checkpoint indices remain intact. Existing effect-reveal holds and focus targets are preserved: a reaction is explained before an opponent demonstrates its consequence.

## Findings and corrections

| Finding | Correction |
| --- | --- |
| The rulebook began with ordinary checkmate rules; the main changes to chess required opening several long sections. | The opening now names the bishop exception immediately, gives the complete die table, and explains reaction memory, help, cycles, and bloodlust. Precise exceptions have separate expandable topics. |
| The exact meaning of a cycle was buried in the digital appendix. This can make one adjacent reply look sufficient for shame or healing. | Timing is now a core topic. The example explicitly starts **after** the move that establishes contact: White brings a bishop alongside → Black completes a turn → White completes a turn → the effect matures. The tutorial explains the same sequence when healing and shame first begin. |
| “No new reaction” on a mercy capture could be read as permitting an old reaction to repeat. | Both languages now say that mercy uses neither a die roll nor a remembered reaction. The bishop exception and capture count remain explicit. |
| The distinction between a current state and a remembered die result was easy to miss. | The rules and shame lesson now explicitly say that shame changes the current state, not capture memory. Healing, conversion, and bishop promotion retain their different reset behavior. |
| Some buttons promised the learner’s next capture before an automatic opponent reply. | Result buttons now describe the immediate next phase, such as watching the king or Black’s turn. Move instructions name the piece and destination. |
| Many “More detail” paragraphs repeated the instruction or the result the player would see immediately. | Removed 34 duplicated optional paragraphs. Kept the 21 that supply exceptions, timing, material accounting, or consequences needed for play. |
| Narration sometimes substituted invented motivation for the rule. | Kept the premise of remorse where it explains a reaction, but removed extra battle lore and congratulatory filler. Descriptions say what happened, why, and what the piece can do next. |

The D6 mapping remains **1 devastated; 2–3 guilt; 4–5 unaffected; 6 berserk**. The earlier user example of “4 = guilt” is not the supplied source rule and has not been adopted.

## Completeness checks

The shortened path still covers:

- Checkmate and stalemate, with bishops and guilty/devastated pieces giving no check.
- Reaction memory versus current state; king immunity; the knight’s one free capture and its bishop/mercy exceptions.
- Three-cycle devastation, exact individual turns, automatic disappearance, mercy, and material/captured-piece accounting.
- Friendly bishop healing, hostile shame and conversion, eight-square adjacency, interrupted contact, non-stacking bishops, and immediate friendly protection.
- The bishop’s continuing aura while afflicted, no self-healing, and the king’s immediate help/protection.
- Berserk’s same-piece bonus, the two-action limit, safe refusal of the bonus, the all-captures threshold, bloodlust’s capture-only movement, and optional friendly captures.
- Promotion inheritance, the bishop’s reset, the pre-promotion reaction hold, and loss of the bonus after bishop promotion.
- King safety for every die outcome, end-of-turn effects, castling, en passant, pawn direction after conversion, repetition, and the edition’s draw rules in the detailed rulebook.

Measured with the same Cyrillic-word matcher against the base revision, the two tutorial text files together went from 2,571 to 2,062 Russian words (about 20% fewer). Most of the reduction removes duplicated optional explanations; the required mechanical explanations were retained. This count is a description of the edit, not evidence of human comprehension.

## Verification

- Focused suite: **42 tests passed in five files** — lesson routes, required explanation/checkpoint handling, RU/EN catalog contracts, effect timing, and choice feedback.
- Added a catalog check that all six die faces appear once and the displayed reaction for each matches the core’s `reactionForFace`.
- ESLint passed for all changed TypeScript/TSX files in this editorial task.
- TypeScript passed during integration before the final text-only pass; the root task owns the final combined build and all-suite result.

## Remaining live acceptance

Play all nine lessons from a fresh save in RU and EN, then restore a held reaction and an inspection checkpoint. At phone height, check that the new short paragraphs, highlighted target, exact countdown, and required button remain visible together. Open the rulebook on a phone and verify that the die table fits without horizontal scrolling. Have a new player explain when an adjacent bishop acts and why a bishop does not check before starting a normal game. Source tests alone cannot establish that those human-facing checks pass.

## Online interface review and acceptance cases

A subsequent source review of `OnlinePanel`, `App`, and their styles found four concrete clarity/layout issues. The root task corrected the authored CSS overriding the lobby row’s `hidden` attribute. This task made these changes:

- Consistent Russian address and direct button wording: «Ваш ход», «Имя в игре», «Цвет фигур», «Отменить готовность».
- Separate explanations when the second player disconnects in the lobby, during play, or after a finished game. Offline seats are labeled, and a disabled rematch now has an explanation.
- Both players are told that a rematch swaps colours.
- Mobile text inputs use at least 16px, avoiding the small-input rule that can trigger iPhone zoom. This is a source correction, not a physical-iPhone verification.

`tests/e2e/online.spec.ts` contains four discoverable cases (RU desktop and EN phone, each in Chromium and WebKit). Each uses two isolated browser contexts and a real instance of the production HTTP/WebSocket server on an ephemeral loopback port. It exercises creation, invitation, both ready confirmations, ordinary moves and an unforced D6 capture, page reload, a real TCP interruption with automatic reconnect, an agreed draw, offline status after the result, and a colour-swapping rematch. Phone assertions cover portrait and landscape, required buttons, and page overflow. State comparisons read the normal authenticated room endpoint; no match state or die outcome is injected.

The existing silent Web Audio initialization is shared with both test contexts; game preferences also start muted. TypeScript and ESLint passed after these changes, and Playwright `--list` discovered all four cases. **The new browser cases have not been executed in this environment.** Build the current source before running them; listing cases is not an acceptance pass.
