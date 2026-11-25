# OVERDRIVE energy v2 — balance audit

26 November 2026. This report concerns the combined review candidate in [PR #9](https://github.com/decorum-guy/iva-games/pull/9), preserving the accepted energy-v2 rules from `32c1377`. The previous [BALANCE.md](BALANCE.md) remains historical v1 evidence.

## Method and current execution

The audit uses the real authoritative rules and the existing SDK search, without modifying production rules or evaluation. Twelve concrete eight-ply normal-move opening tapes are shared by both versions. Two independent seeded player RNGs are swapped between colors. Both sides have identical search budgets; wall-clock cutoffs are disabled. A game stops on a rules outcome or the explicit 300-ply audit limit. Unfinished games are not draws.

Every executed move must preserve its input and pass state validation. Replaying the entire command stream must reconstruct the exact final state. The runner records achieved depth, nodes, real elapsed time, energy spent/earned/lost to the capacity limit, first ability/form, material lead before first activation, ability use, free form uses and forced promotions. Counts called `checks` in the raw stats are newly rewarded check layouts, not all checking moves.

Reproduce from the repository root:

```sh
npm ci
npm run overdrive:balance:probes
npm run overdrive:balance:audit -- --openings=12 --seeds=2 --nodes=1400 --depth=3 --plies=300 --workers=6 --output=.qa/overdrive-energy-v2-primary
npm run overdrive:balance:audit -- --openings=12 --seeds=1 --nodes=5600 --depth=5 --plies=300 --workers=2 --output=.qa/overdrive-energy-v2-deeper
```

The first series contains 96 games, the second 48. This checkpoint publishes the executable audit while those series are running; it does not claim their completion. Complete results will replace this status in a subsequent commit. Bulk JSON histories remain ignored under `.qa`.

`--resume` accepts completed games only when their options and compiled engine hash match. The deterministic replay digest excludes elapsed-time fields; the artifact digest covers the complete individual result file. A different rules/engine build requires a separate output directory.

## Tactical probes already executed

Thirty constructed cases, fifteen per version, completed successfully. They include two actual depth-two search decisions. These are reachable-rule transition checks on explicit diagrams, not thirty games or evidence of how frequently the diagrams occur.

- A v2 activation followed by a queen capture and new check can replenish all six units immediately while leaving two own turns of form. The equivalent v1 action leaves three of ten units.
- A v2 impulse capture of a rook pays its own cost; a queen capture gains one net unit before a check reward. This follows the requested prices and rewards.
- A capture reaching the impulse threshold can enable a different piece's special attack and create a new check. The core applies capture energy before evaluating the resulting check.
- Rotation of one's pawn onto the last rank still promotes it; the cost fell from five to three. Both tactical searches selected that promotion.
- A rewarded checking layout is recorded even when capacity prevents payment; it cannot later be used for a duplicate reward. Form duration remains three own turns, including activation.

No production-rule defect was found in these probes. Their balance significance requires the complete games.

## Interpretation limits

The current default L4 searches at most two plies; a full three-own-turn form spans five plies. Equal node budgets can also produce different achieved depths because available actions increase with energy. Therefore self-play measures the rules together with the current bot. It does not establish human winning chances, external Elo, subjective fun or a universally optimal strategy. The report will keep paired opening/seed clusters together and distinguish color results from the effect of changing rules.
