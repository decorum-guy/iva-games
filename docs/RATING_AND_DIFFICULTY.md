# Remorse Elo and ten AI difficulty profiles

The owner explicitly requested rating gains/losses and more AI levels with approximate Elo. This document supersedes the earlier three-level/no-rating scope. These are **product and engineering decisions**, not measured bot strength or rules from the supplied chess transcript.

## 1. Honest internal scale

Implement **local Remorse Elo** for human-versus-bot rated games. The ten initial bot anchors are 400 through 2200 in steps of 200. They are assigned, provisional values within this game's own scale; human-equivalent FIDE, chess.com or other external ratings have not been measured.

Display a bot as, for example, «Remorse Engine · 4/10 · ≈1000 Elo Remorse». Explain in the selector/help: «Предварительная внутренняя шкала силы ботов; оценки будут уточняться по результатам партий». The approximate sign and honest description are required. Do not claim that a small self-play suite proves the 200-point spacing or a 2200-rated human equivalent.

The player starts at **1000 Remorse Elo**. This is an initial app value, not an assessment of the owner's chess skill. Show the player's current rating, best rating and simple W/D/L history in a compact profile/results view. No accounts, leaderboard or server is needed. Profile data stays in this browser; phone and laptop do not automatically share a rating. Show that fact briefly in profile settings.

Default bot: **level 4, ≈1000**. Keep level/anchor and rating mode fixed for the duration of a rated match. Bot anchors do not gain or lose points when one human plays them; only the local human profile is updated.

## 2. Rating calculation

Use ordinary logistic expected-score Elo with our chosen constant `K = 32`:

```text
E = 1 / (1 + 10 ** ((botAnchor - playerRatingBefore) / 400))
S = 1 for a win, 0.5 for a draw, 0 for a loss
rawAfter = playerRatingBefore + 32 * (S - E)
ratingAfter = max(100, rawAfter)
```

The floor of 100 is an explicit product rule. Do not clamp the player to the bot ladder's 400–2200 range. `E` is expected points including draws, not literally probability of a win.

The logistic expectation and update principle are documented in the primary [US Chess rating-system specification by Mark Glickman and Thomas Doan](https://www.glicko.net/ratings/rating.system.pdf), printed pages 10–11. That source describes additional rules and different K calculations; this application implements the simple policy above, **not the complete US Chess or FIDE system**.

Store floating-point values; round only for display. Show the result card as `1000 → 1016 (+16)`. Compute the displayed integer delta as `round(after) - round(before)` so all visible numbers agree; preserve the exact change in the ledger. For a nonzero exact change that rounds to zero, a small «менее 1» detail is sufficient; do not impose an artificial minimum win reward.

Fixed numerical examples before the floor applies:

| Player before | Bot anchor | Result | Exact after, approximately | Displayed change |
|---:|---:|---|---:|---:|
| 1000 | 1000 | Win | 1016 | +16 |
| 1000 | 1000 | Draw | 1000 | 0 |
| 1000 | 1000 | Loss | 984 | -16 |
| 1000 | 1200 | Win | 1024.31190165 | +24 |
| 1000 | 1200 | Draw | 1008.31190165 | +8 |
| 1000 | 1200 | Loss | 992.31190165 | -8 |

A win against a lower anchor earns less; a loss to it costs more. A draw can add or subtract rating according to the opponent. Rating never depends on captured material, the `+N` badge, move count, die luck, visual quality or fabricated AI “accuracy”.

## 3. Rated versus practice

New AI setup has two clear choices: **«Рейтинговая»** and **«Тренировка»**, defaulting to Rated. Explain before starting that a rated game changes local Elo and has no undo/strategic hints. Legal-move highlights, rule explanations and accessibility tools remain available in both.

| Session | Rating eligibility / allowed behavior |
|---|---|
| New standard-position game versus a fixed bot preset | Rated if selected before creation; no undo, strategic move recommendation, position editing or difficulty change. |
| Practice versus AI | No rating; undo and difficulty changes allowed at a stable human decision boundary. |
| Local two humans | No rating in v1; retain hotseat controls. |
| Tutorial and continuation from tutorial | Always practice, including after reload. |
| File-imported game/position or developer fixture | Always unrated, regardless of a claimed flag inside the file. |
| Automatic internal resume of an existing rated session | Still the same rated match, with unchanged ID/configuration. |
| Review of a completed rated game | Read-only for that result; optional analysis clone is a new practice session. |

A rated match becomes score-bearing when the first **human primary move** is accepted. Before that it may be canceled without rating, including when a White bot has already made its initial move. The single rated slot is already reserved at creation, even before this activation. After activation, replacing that saved rated match with another rated match requires an explicit in-game resignation choice; apply the loss once before creating its replacement. Closing the tab, refreshing, leaving the view or opening the tutorial only suspends it, because this version has no clocks.

Do not offer a midgame Rated→Practice switch that erases a possible loss. A separate practice game, hotseat session or tutorial continuation may be played while the unfinished rated match remains saved in its reserved slot. This does not erase, clone into a new rated match, or finalize the suspended match. Returning to Rated offers resume, or the explicit cancel/resign flow appropriate to its activation state. Only one unfinished rated match, including a created-but-not-yet-activated one, may exist per local profile.

Checkmate, resignation and genuine rules-based draws settle the result with `S = 1/0/0.5` from the human's perspective. A failed worker, rendering fault or application exception is not an opponent defeat. Retry/recover; an unrecoverable recorded technical abort changes no rating. Do not trap the player in a broken rated session.

## 4. Exactly-once persistence

Use an IndexedDB transaction (native API or a small appropriate wrapper) covering the match record, unique rating ledger entry keyed by `matchId`, and profile update. Do not split these writes across independent localStorage updates.

At creation freeze: match ID, rules version, engine version, rating-scale version (`remorse-elo-v1`), preset ID, nominal bot anchor, human side, initial rating, and Rated/Practice status. Store the actual profile revision used. Reserve the single unfinished-rated-match slot transactionally at creation, not at the later first-human-move activation. Otherwise two tabs could create pending matches with the same stale starting rating. Canceling an unactivated match releases that reservation without a rating entry. These checks must prevent a second tab from starting or settling an incompatible rated match against stale profile data.

At terminal settlement atomically record: outcome/reason, eligible status, before/after values, expected score, K, exact delta and applied ledger ID. Reopening the result screen, duplicate event delivery, refreshing, replaying a save or a second tab must not award a second change. A historical replay never awards Elo.

Completed results are immutable. Rematch creates a new ID. Later bot-anchor or engine updates do not recompute old results; each record retains the configuration actually used. Local progress is not a tamper-proof public competition rating. Future online play must place rating settlement on the authoritative server.

If durable browser storage is unavailable, offer practice with an explanation that rating progress cannot be saved. Do not silently claim persistent rated progress in memory-only mode.

## 5. Ten real engine profiles

The table below is an **initial implementation specification to tune on the available Mac**, not measured performance or a guarantee of reaching the maximum depth. Depth counts completed player turns; chance nodes and berserk submoves do not themselves consume a whole turn.

| Level | Approximate internal anchor | Max depth | Node ceiling | Hard time ceiling | Choice temperature, pawn units |
|---:|---:|---:|---:|---:|---:|
| 1 | 400 | 1 | 200 | 100 ms | 1.20 |
| 2 | 600 | 1 | 400 | 150 ms | 0.90 |
| 3 | 800 | 2 | 800 | 220 ms | 0.65 |
| 4 — default | 1000 | 2 | 1,600 | 350 ms | 0.45 |
| 5 | 1200 | 2 | 3,200 | 550 ms | 0.30 |
| 6 | 1400 | 3 | 6,400 | 850 ms | 0.18 |
| 7 | 1600 | 3 | 12,800 | 1,200 ms | 0.10 |
| 8 | 1800 | 4 | 25,600 | 1,800 ms | 0.05 |
| 9 | 2000 | 4 | 51,200 | 2,600 ms | 0.02 |
| 10 | 2200 | 5 | 102,400 | 4,000 ms | 0 |

Create one versioned preset table consumed by UI, worker, saves and rating settlement. Different labels with identical play or an artificial wait do not implement ten levels.

At the last completely evaluated root iteration, for `T > 0`, choose among scored legal candidates with weight `exp((score - bestScore) / T)`. Scores are from the decision player's perspective and in pawn units. Restrict candidates to at most `3*T` pawns below best. For `T = 0`, select the best with stable tie-breaking. Terminal scores are handled separately: do not discard a discovered forced win just to weaken the bot. Use an independent engine RNG, never the game's future die stream.

Compare candidates from the **same completed depth**. Keep a valid scored fallback before deeper work, never mix partial deep scores with shallow ones, and allow cancellation/deadline checks in expensive legality/passive loops. Check all rule invariants at every level. Easy opponents may make inferior legal choices; they cannot make illegal moves or manipulate dice.

Quality presets affect graphics, not the selected bot. On slower hardware, stop search at the measured time ceiling and use the best completed result. Record completed depth, nodes, time and stop reason in developer diagnostics. If levels routinely collapse to identical effective behavior, tune the budgets/weakening and record the revised preset version. Surface device-limited behavior only if the engine repeatedly fails to complete even its intended useful baseline; ordinary iterative-deepening timeouts are normal.

## 6. Focused verification

- Test the exact formula vectors, draws against stronger/weaker bots, the 100 floor, floats and displayed integer arithmetic.
- Test terminal duplicate delivery, refresh, double-tab settlement, one-active-match enforcement and a crash between logical stages of finalization. No match can change rating twice.
- Test all exclusions after save/reload/import and both tutorial finish paths. Practice undo does not write to the rating ledger. Rated undo/difficulty changes are rejected by the session API, not merely hidden in UI.
- Test suspension/resume versus explicit abandonment/resignation; application error is not scored as a win/loss.
- Run all ten profiles against a small deterministic mixed/tactical suite. Use fixed node budgets and controlled engine RNG for repeatable tests; time-limited behavior can vary by device.
- Run a small bounded, color-swapped sample of low/middle/high self-play games. Record actual results and capped runs. This checks functionality and relative behavior; it does not establish an externally calibrated Elo.
- Verify names, bot `≈Elo`, human Elo and the separate `+N` material badge on laptop and phone.

Keep the app usable while calibration evidence remains preliminary. Full human-strength calibration is future work and must not block this authorized first release or be falsely marked complete.
