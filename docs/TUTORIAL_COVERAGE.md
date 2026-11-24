# Tutorial coverage

The [lesson fixtures](../src/tutorial/lessons.ts) use the same rules and event path as ordinary play. The nine lessons retain 14 positions and 55 original steps. The [required result copy](../src/tutorial/teachingCopy.ts) adds 29 acknowledged observations to 27 existing actions without changing those indices. A position reset starts a fresh capture ledger and repetition context. The step IDs below also identify the bilingual coachmarks and the actions owning their result explanations.

| Rule or behavior | Lesson and step IDs |
|---|---|
| Goal, selection, legal targets, opening pawn double step, alternating turns | First capture · `open-with-e4`, `black-pawn-d5` |
| First qualifying capture, six faces, capture memory | First capture · `capture-and-roll` → held `first-reaction-four`, then `first-dice-legend`; `faces-and-material` follows separately. Later captures exercise assigned and remembered reactions. |
| Enemy capture row and conventional remaining material | First capture · `faces-and-material` |
| Guilt permits quiet moves, forbids captures, stops checks and still blocks lines | Guilt · `guilt-roll`, `guilty-still-blocks`, `guilt-forbids-capture`, `guilt-quiet-move` |
| Devastation immobility, no check, blocking, three-cycle countdown, automatic disappearance | Devastation and mercy · `devastation-roll`, `inspect-countdown`, `one-turn-half-cycle`, `devastated-immobile`, `self-removal` |
| Mercy suppresses a reaction; actual mercy captures and self-removal have different HUD effects | Devastation and mercy · `mercy-capture`, `removal-material-only` |
| Friendly bishop heals multiple allied pieces after continuous coverage, with reaction memory intact | Help from a bishop · `start-two-cures`, `cure-two-pieces`, `remembered-guilt` |
| Bishop pacifism and capture penalty, including the knight's nominal first free capture | Help from a bishop · `bishop-pacifism`, `bishop-capture-cost` |
| Hostile bishop stages, protected victims, no stacking and delayed healing | Shame and conversion · `start-shame`, `shame-does-not-stack`, `shame-devastation`, `parry-shame`, `protected-but-still-guilty`, `protected-cure-matures` |
| Conversion changes ownership and material, preserves identity and resets capture reaction and count | Shame and conversion · `convert-rook`, `converted-piece-ready`, `rebirth-new-roll` |
| Berserk immunity to shame and healing | Shame and conversion · `start-shame`. The king rallies the troops · `rally-two-pieces`. Rules guide · `bonus`. |
| Friendly-only immediate rally, safe king movement and bishop capture without reaction, no king captures | The king rallies the troops · `rally-two-pieces`, `king-response`, `king-captures-without-roll` |
| Knight first-capture exemption and second-capture roll, same-piece bonus on a 6 | Knight, berserk, and bloodlust · `knight-free-capture`, `knight-second-capture-six` |
| Berserk quiet bonus option, bishop exception, third-capture bloodlust, two-action cap and whole-turn time | Knight, berserk, and bloodlust · `bonus-bishop-and-third-capture`, `only-one-bonus` |
| Bloodlust restricts both actions to captures, allows allied non-king targets and can decline a safe bonus | Knight, berserk, and bloodlust · `bloodlust-forbids-quiet`, `friendly-capture`, `decline-optional-bonus` |
| Promotion selection precedes reaction. Q/R/N preserve memories, state and counter. Bishop rebirth clears them and the bonus. | Promotion · `promote-inherit`, `promoted-material`, `bishop-promotion-rebirth`, `promotion-clears-bonus` |
| Open choice, a legal scripted reply and a stable practice handoff with actual capture context | One last guided decision · `final-lesson-capture`, `open-quiet-choice`, `open-legal-reply`, `practice-ready` |

The bilingual [rules guide](../src/i18n/rules.ts) covers ordinary movement, castling and en passant with example coordinates under `basics`. The digital appendix explains the simultaneous boundary batch and rescue-before-removal rule under `timing`, overlapping capture exceptions and converted pawn rights under `order`, all-outcome king safety and the required-bonus case under `safety`, and semantic repetition, bare kings and the disabled 50/75-move rules under `draws`. The `aura` section covers diagonal contacts, ongoing aura while afflicted, self-heal exclusion and continuous king protection.

Scripted capture/promotion outcomes are checked against actual emitted events. The final open choice has 23 verified legal alternatives with a legal quiet opponent reply. The continuation preserves the current lesson's pawn capture and its repetition history from completed turns.

Meaningful new outcomes pause before the next exercise or reply. Ordinary filler moves do not acquire extra acknowledgements. The first eight lessons use the new result beats; the ninth keeps its existing held final-choice explanation. This manifest describes source coverage, not proof that a new player understands the rendered flow. Current executed checks and the required Mac acceptance are recorded in [BUILD_STATUS.md](BUILD_STATUS.md).
