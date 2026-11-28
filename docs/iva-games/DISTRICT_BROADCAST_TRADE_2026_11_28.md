# District broadcast trade validation — 28 November 2026

Base: `origin/main` `357f60049e83b298bb5bbc2f760654fbd02384e3`; branch `codex/district-multiplayer-trade-20261128`, [PR #43](https://github.com/decorum-guy/iva-games/pull/43). Implementation checkpoint `ab02998`; measured layout fix and stale bot consent recovery `c9ffb1b`. The coordinating chat owns merge and deployment. This report does not claim production delivery.

## Protocol and compatibility

The server broadcasts every new v0.4 offer to all other remaining participants, regardless of a legacy client's requested target list. Every new offer uses the already-supported `group-` identifier, including two-seat rooms. Recipient acceptance records consent only. The author must separately select a consenting participant, even when only one agrees. That transaction executes one transfer and closes the other active group members. Author cancellation closes the whole group; recipient decline closes only that recipient's offer. Counteroffers replace the parent group and are also broadcast.

Phase, deadline and both hands are rechecked by the authoritative core inside the existing SQLite revision/receipt transaction. Consent reserves nothing. A failed choice transfers nothing. Bots respond and separately select consent through the same actions. An inactive bot author whose consent became unaffordable withdraws the stale group rather than repeatedly replacing another participant's timer.

Authors see a seat colour and waiting/agreed/declined status for each recipient, with explicit selection and withdrawal buttons. Declines remain in the current group and authorised history. Each recipient sees only their own quote and authorised history. Unanswered quotes do not disclose the recipient's ability to pay through the sender's `canAccept` value.

Versions, formats and readers are unchanged. Persisted addressed offers without `groupId` retain their previous completion path. New offers in restored v0.4 rooms use the new process. Historical v0.2/v0.3 runtimes, maps and chess were not changed.

## Executed checks

- `npm run district:test`: **197/197**. Coverage includes two seats, sole consent without a transfer, decline/cancellation without payment, deadline expiry, competing author choices through independent SQLite runtimes, restart, receipt replay, resources spent after consent, legacy addressed offers and an inactive bot author with stale consent.
- `npm run check:platform`: **324/324**, TypeScript and ESLint. `npm run build:foundation` passed.
- Real isolated HTTP/SQLite Chromium: two clients at **1440 x 900** and **390 x 844**, plus a bot. UI offer, recipient consent and separate author choice passed. The author's hand stayed unchanged until selection. Board position, size and page scroll were exactly equal before the offer, after consent and after completion. The final targeted run used server SHA-256 `332b4dee0fd486c59afd2444b23138f0f46c32d8f6209672d2bc28528949d1d5` and portal index `fedadacacacfa4146a03fc72c778aa3b7e48818696310aa05238d0d4da743959`.
- The previous full browser run of this implementation with the stable header finished a synthetic match: **12 rounds, revision 209, 140 commands, one winner**, server restart/recovery, nine tutorial steps, coastal map and 17 news fixture stages. It preceded the final stale bot consent recovery. Server SHA-256 `155cbff70c07ed84b65e9d3bb2b3ab3e38d00c226efd029d94c45c6ede57f724`; portal index `a5a1fce1e3e94165eee344179d2d6f16b9e0ee44a8fd30a3cdb507c148a560e5`.

The first real browser regression reproduced a **16.6875 px** board jump: a conditional trade status line enlarged the player header and reduced the board. That line now always reserves its space. Card FLIP motion and scrolling focus were removed; the offer overlay remains outside layout. The regression observes live updates without reloading and awaits fonts. An intermediate measurement with reload encountered changing font metrics and was not accepted as proof of stable live layout.

Reproduce with `npm run build:foundation`, then `DISTRICT_TRADE_ONLY=1 node scripts/district-territorial-browser.mjs`. Without that variable the existing full CI scenario remains enabled. The Mac runs used installed Chrome through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. QA files remain ignored. These are automated technical checks, without messages to people, a full human playtest, a physical phone or listening.

Check final-head CI in the PR. Docker build success does not establish merge or an exact `DEPLOYED` record.
