# Shift runtime and live protocol

The platform's existing authenticated room is the authority for admission. The
runtime independently resolves a human account against the frozen roster. Bots
have participant IDs and no account/session. The client and bot only receive
`viewForSeat` from the rules core.

## Lobby

`settings` contains `arena` (`foundry`, `calibration`, `depot`), `teamSize` (2 or
3), `rotateRoles` (default true), and `difficulty` (`easy`, `normal`, `hard`).
Optional `teams` maps participant IDs to `teal` or `amber`;
`initialNavigators` maps those two team IDs to a participant ID. Without a map,
the first `teamSize` occupied places form teal, the rest amber; the first place
in each team starts as navigator. Each team must have exactly one navigator.

Capacity must be exactly `2 * teamSize`. A start requires every place occupied,
at least two human accounts, ready flags, and valid equal teams. Existing
platform mutations invalidate human readiness after any settings or roster
change. Practice and lessons run the same rules locally without creating
synthetic platform accounts.

After a finished match, the host can call the normal authenticated, CSRF-guarded
`POST /api/platform/v1/rooms/:id/rematch` with `expectedRevision`. It reopens
that room with the same participants, resets human readiness, and preserves
the completed match and receipts in the runtime. A fresh start command creates
a new match ID. Old sockets no longer belong to the room's current match.

## Live channel

Connect to `/api/platform/v1/rooms/:id/live?matchId=...&version=shift-wire%401`.
The gateway checks Host, Origin, platform session, membership, current match and
wire version before upgrading. A new connection creates a controller epoch;
the prior connection closes with code 4001. Revocation/expiry closes with 4003;
a room returning to its lobby or changing match closes with 4004. Session and
membership are checked again before every frame and snapshot without per-frame
session writes; activity is renewed every 30 seconds.

Client frames:

```json
{"type":"input","version":"shift-wire@1","payload":{"type":"input","roundId":1,"controllerEpoch":2,"seq":1,"moveX":0,"moveZ":1,"aim":1.57,"fireHeld":false}}
{"type":"command","version":"shift-wire@1","actionId":"example-shift-1","payload":{"type":"shift","roundId":1,"controllerEpoch":2,"roomId":"O","expectedBoardRevision":1}}
```

Other discrete payload types are `interact` and `ping` from the core types.
`actionId` may also be present inside the payload, but must match the envelope.
Input uses a 30 frames/second token bucket with a six-frame burst allowance for
network batching; the runtime still coalesces to the latest input per seat and
tick. Discrete commands are limited to 12/second and eight pending commands per
connection. The core enforces gameplay cooldowns and the
stricter ping limit. Maximum frame size is 8192 bytes; binary frames are rejected.

The first response and subsequent 15 Hz updates are
`{type:'snapshot',version,matchId,controllerEpoch,tick,view}`. Accepted and
rejected commands receive `{type:'receipt',...,actionId,result}`, where `result`
is the core `Receipt`; transport errors have `type:'error'` and a stable `code`.
After the immutable final result, an existing action ID still replays its
SQLite receipt (or rejects a changed payload with `ACTION_CONFLICT`). A fresh
action ID receives the terminal admission error `MATCH_FINISHED`; the client
must remove that pending action instead of retrying it. No new final-state
receipt or checkpoint is written for this rejected admission. Recovery is
different: commands admitted during its temporary pause receive a durable
`PHASE` receipt, so they cannot execute after the pause ends.
No server state, opposing input, account identity or hidden pose is serialized.
Slow sockets drop obsolete snapshots and close at the hard buffer limit;
receipts are not intentionally dropped. HTTP `GET .../match` remains the
recovery view and common lobby polling remains available.

## Ownership and recovery

Each process owns one in-memory state per match. Socket callbacks queue actions;
the 30 Hz scheduler batches both teams into the same fixed tick. Human input is
coalesced per seat. The core resolves priority, movement, interactions, combat,
delivery and phase deadlines in its declared order. Bot commands use the same
queue and rules.

SQLite owns `shift_schema`, `shift_matches`, and `shift_receipts`; it does not
modify another adapter's schema version. State and discrete receipts commit in
one immediate transaction before acknowledgement. Phase transitions, battery
transitions, shift start/end and the 2-second checkpoint are durable. Failure to
commit stops that resident match and returns no success receipt. Restart loads
the last whole checkpoint, cancels old control epochs, and applies the core's
five-second recovery preparation before simulation resumes. Finished matches
are loaded without advancing them. Finished HTTP result reads do not populate
the simulation map. A completed resident remains available while live result
pages reference it, then is evicted after the final lease closes; the result
and receipts remain in SQLite. A stale takeover lease cannot evict its active
replacement. A normal shutdown flushes pending commands and checkpoints before
closing the database. The gateway first cancels every snapshot interval and
releases live leases synchronously; asynchronous WebSocket close events cannot
query a subsequently closed platform database. A rejected upgrade also releases
its provisional lease. HTTP shutdown still drains its lifecycle if lease
cleanup reports an error.

The `advanceTicks` method is an in-process deterministic test driver; no network
route exposes it. Production never accepts client positions, tick changes,
scores or results.

## Isolated browser stand

After `npm run build:foundation`, run
`node games/shift/scripts/demo.mjs --port 4398`. It serves the built portal and
platform on one loopback origin and creates two test accounts through ordinary
signup and the development file mailbox. They become friends through the
existing API. No Telegram or SMTP delivery is enabled.

`--rooms` creates a 2×2 and 3×3 lobby through invitations, reservations and bot
seating. `--start` additionally confirms both humans and starts those matches.
Without these flags, acceptance can create and configure the lobbies in the UI.
The script prints local-only test credentials, profile paths and a
`SHIFT_DEMO_READY` line after setup. Each run gets a new private directory under
`.qa/shift-demo/`; `fixture-4398.json` points to the matching run. No prior DB or
running process is replaced.

Programmatic tests can import `startShiftDemo` and use its real API clients,
two independent `storageState` files, `createRoom`, `stop`, and
`restart({crash:true})`. The latter kills only the child this fixture started.
The server tests separately SIGKILL a subprocess after an acknowledged shift
and verify the whole SQLite checkpoint, frozen recovery interval, exactly-once
receipt, and completed move after restart.
