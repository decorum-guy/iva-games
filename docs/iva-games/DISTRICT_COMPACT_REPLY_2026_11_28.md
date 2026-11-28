# Compact quotes and ten-second replies — candidate 28 November 2026

Base: main `1f571a7fa24a5c682a236d5fa0ef5a499f09c24d`. Branch: `codex/district-compact-trade-20261128`. This is a review candidate, without merge or deployment authority.

New v0.4 quotes persist `responseDeadlineAt = offeredAt + 10000`. Server advancement closes only unanswered recipients at the boundary, without payment. An already recorded consent remains selectable until cancellation or normal turn end. As before, an earlier turn end closes the quote. The normal active-player rule applies only to execution, not consent. Late commands are rejected even without an intervening status read. Expiry is materialized on the first server event after an idle interval or restart; no client timer decides outcomes.

Timestamped legacy quotes retain a deadline calculated from their original timestamp. Undated pending saves receive one persisted ten-second window on recovery, which refresh/restart cannot reset. Existing format/readers and legacy addressed execution remain compatible. Response timeout uses existing `expired` status plus optional `responseExpired` and private history reason `response-timeout`; ordinary turn expiry remains distinct. No resources are reserved or transferred by consent, decline or expiry.

Bot replies use per-quote server timestamps and a stable seeded slot, independent of revisions and the preceding bot's delay. Even the last seat's maximum draw is due by 2.7 seconds; normal 1.1-second polling lets all three reply within the window. Other actions retain their existing pacing. A runtime regression covers three bots, the third bot's maximum draw, revision changes and restart.

The intended sent-quote UI has two short RU/EN author/terms lines and fixed vertical cells: seat colour above the response emoji. Only waiting/thinking, declined and agreed emoji are visible; the agreed emoji selects the recipient and a single common cross withdraws the group. No visible clock or status paragraphs are requested. Aria labels/titles carry accessible explanations. Pending, agreed and closed cells retain the same dimensions and seat order.

Checkpoint checks: 208 District tests and 336 platform tests, TypeScript/ESLint. Browser layouts, screenshots and final-head CI are still pending at this checkpoint. No tournaments were started.
