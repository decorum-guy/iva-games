# District browser check and the UI retry — 28 November 2026

The main check for `fc91c1c68f4b81d9a2ab4ad64274d11aaa0a3d4e` failed at the author selection in `scripts/district-territorial-browser.mjs`: [actual log](https://github.com/decorum-guy/iva-games/actions/runs/46181012481/job/141090316338). The author button was disabled, then removed while the driver tried to click it again. The same signature was observed in the Shift branch audit; it was not evidence that those games had failed their own rules.

The production UI already refreshes and retries an explicitly rejected author selection/cancellation, retaining the action ID and checked terms. The older browser helper also retried its click after the first `409 STALE_REVISION`. When the UI's retry completed, the helper was waiting on a button belonging to a quote that had correctly disappeared.

The helper now lets the UI finish author selection and group cancellation after a single click. It waits past **only** explicit stale rejections, requires a final HTTP 200 and checks that every attempt used the same action ID. Other errors still fail. Actions without the production author retry retain their former explicit retry handling. No application rules, UI behavior, deadlines or deployment gates are changed.

## Reproduction and checks

```sh
DISTRICT_TRADE_ONLY=1 DISTRICT_FORCE_AUTHOR_STALE=1 node scripts/district-territorial-browser.mjs
node scripts/district-territorial-browser.mjs
```

The explicit diagnostic alters only the first outgoing author command's revision to `expectedRevision - 1`. The real server rejects it; the application refreshes and resends its own command. This is controlled transport fault injection, not an unmodified match or a mocked successful transition. Both selection and cancellation produced `409 → 200` with one action ID and no second driver click. The diagnostic completed the trade and group cancellation at revision 19; it did not claim a finished match.

A before-fix helper, restored in ignored `.qa` with that same injected rejection, reproduced the CI signature: the second click found the disabled author button, which detached after the application's successful retry. The fixed helper passed the same case. ESLint and diff checks passed. Raw logs remain ignored: `.qa/district-trade-ui-retry-before.log`, `.qa/district-trade-ui-retry-forced.log` and `.qa/district-trade-ui-retry-full.log`.

The ordinary full match and exact-head CI remain separate checks; their final results are recorded in the follow-up PR. This repair also unblocks the ordinary main delivery of the menu/icon changes from [PR54](https://github.com/decorum-guy/iva-games/pull/54). Main integration is not a `DEPLOYED` record.
