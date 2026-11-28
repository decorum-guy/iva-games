# Realtime server

The first adapter runs the authoritative Forpost core at 30 Hz. Networking, a single SQLite writer worker, and simulation workers have separate event loops. The browser receives only `viewForPlayer` projections. Chess and District keep their existing runtimes and data volumes.

## Local start

Build the Forpost client and this workspace, then run `dist-realtime/main.js` with private QA paths and a free port. The registry development link uses port 4274. Environment values are `REALTIME_PORT`, `REALTIME_HOST`, `REALTIME_PUBLIC_ORIGIN`, `REALTIME_DATABASE_PATH`, `REALTIME_PRACTICE_KEY_PATH`, `REALTIME_STATIC_DIRECTORY`, `REALTIME_MAX_ROOMS`, optional `REALTIME_CAPACITY_PROFILE_PATH`, and `IVA_BUILD_SHA`. The HTTP Origin must match exactly. HTTP is accepted only on loopback; production requires HTTPS.

For a reproducible probe that starts and stops only its own processes, run:

```sh
npm run build:forpost
npm run build:realtime
node apps/realtime-server/scripts/network-smoke.mjs
```

The probe is HTTP/WebSocket automation. Its output does not claim browser play or physical-device validation. It creates a separate `.qa/realtime-network-*` directory and free port, preserving other saves and servers.

## Admission and lobby

Guests create training with `POST /api/realtime/v1/practice`; fields are `mapId` (FP01–FP03), `teamSize` (1–3), `displayName`, `botLevel`, `weapon`, `tool`, and `mode: training`. The optional deterministic seed is a training setting only. The response is `{ matchId, participantId, ticket, websocketPath, protocolVersion, route }`. Ownership is an opaque HttpOnly SameSite cookie; the browser can save matchId, not a persistent bearer. Its 30-day lifetime renews on successful own create/ticket/abandon requests; this is separate from the room's 24-hour resume window. Deleting or expiring that anonymous identity removes guest access to its saved rooms. `POST /api/realtime/v1/practice/:matchId/ticket` refreshes admission; `.../abandon` closes that owner's training.

Normal matches require a platform account. Its existing authenticated lobby, invitation, ready, bot and start endpoints remain authoritative. Forpost has `POST /api/platform/v1/rooms/:roomId/forpost-setup` with `{ expectedRevision, participantId?, team?, weapon?, tool?, botLevel? }`. An unready human changes only their own setup; the host changes explicit bots. Team and setup changes reset readiness. `settings.mapId: random` resolves to a concrete map before readiness. A start requires precisely two equal teams of the selected size, at least one human, and every human ready. Frozen settings include `loadouts[participantId]`. The general settings endpoint cannot inject another participant's loadout.

`POST /api/platform/v1/rooms/:roomId/realtime-ticket` needs the existing session, Origin and CSRF token. Platform and runtime communicate only over a signed internal bridge. Ed25519 tickets bind origin, match, room, player, participant, roster, versions, key and admission. They expire after 30 seconds and are consumed once in SQLite. Runtime rechecks platform admission at least every minute; expired or revoked sessions are not converted to guest access.

Account starts enter a durable FIFO with at most one waiting start per authenticated lobby host. The platform freezes that actor's ID; it does not accept a host from request JSON or infer one from the first roster seat. A ready start receives a 15-second reservation before worker allocation. Identical retries retain its token and deadline, and the final match transaction consumes the reservation with the initial checkpoint. An expired token cannot create a second match. Older platform commands without a host ID remain readable and share a conservative legacy queue identity. Busy practice requests are cancelled instead of creating an invisible room later.

The platform exposes `room.startWaiting` with a reason (`capacity`, `updating`, `another_start`, or `service`), `retryAt`, and, when available, queue position and reservation expiry. Its reconciliation repeats the same frozen start command. Capacity release triggers the runtime's FIFO pump; polling never creates a replacement command.

Without a validated profile for the exact runtime artifact, the effective cap is one room even if `REALTIME_MAX_ROOMS` is higher. Admission reserves each room's complete legal body/bot/connection envelope, at least 25% memory headroom and 30% compute headroom. Cgroup limits and usage, including constrained ancestors, take precedence over machine-wide figures; unavailable limits fall back conservatively to one CPU and 1 GiB rather than claiming the host allocation. A known memory limit with unreadable usage blocks new admission. Existing backlog also blocks new starts. No accepted production capacity profile is supplied in this repository.

`REALTIME_CAPACITY_PROFILE_PATH` accepts the `iva-realtime-capacity-1` schema documented in [the admission validation note](../../docs/iva-games/REALTIME_ADMISSION_AND_WRITER_2026_11_28.md). A measured profile must identify the exact artifact and its evidence. An older artifact's profile falls back to conservative admission. `source: test-fixture` is rejected in production; the HTTP smoke uses an explicitly labelled synthetic two-room fixture only to test cross-version recovery, not to claim measured two-room capacity.

## Socket protocol

Connect to `/ws/realtime/v1` with subprotocol `iva-realtime-v1`, then send `{ type: authenticate, ticket }`. Subsequent messages use `{ protocolVersion: 1, matchId, epoch, controllerGeneration, type }`. Input adds `inputSeq` and the validated movement/aim payload. Actions add stable `actionId` and `payload`. `claimControl` uses the generation in the envelope as its compare-and-swap expectation.

`hello.controlling` determines whether a socket owns input; another socket from the same account is view-only. The server emits full/delta snapshots at a target 15 Hz. Full snapshots include `view`; delta snapshots include `baselineSnapshotSeq` and a shallow `patch` of the already filtered view, replacing changed entity arrays in full. Each connection owns its cache. Clients retain 32 acknowledged/recent projections by snapshotSeq and merge a delta into its named baseline. Missing baseline, a changed epoch, resync and each two-second interval produce a new full. Backpressure discards obsolete deltas and forces a full before continuing.

The input expiry target is 250 ms; the core applies the required one-shot deadline quantization, `ceil(30 × 0.25) = 8` ticks (about 266.7 ms). Five seconds without an active human controller allows the temporary bot; ten seconds without any human presence durably pauses the room and publishes `NO_HUMANS`. Initial room handoff remains at ready/tick zero until an authenticated socket connects. Native WebSocket pong alone does not assert that the game's UI is responsive. Reconnection and recovery begin with a three-second countdown. A second controller resets its input sequence without resetting weapon cooldowns. Actions are acknowledged only after state, normalized journal record and receipt are committed together. Repeating a committed action ID replays its receipt; another payload conflicts.

## Persistence and releases

SQLite uses WAL and `synchronous=FULL`. The latest full authoritative state and each committed tick are stored atomically with the journal hash; a pair of prior checkpoints is retained. Saved worlds never appear in HTTP/WS client responses. A fenced lease prevents two writers, and recovery increments the game epoch. A missing or corrupt saved artifact fails closed.

The writer collects FIFO requests for at most a 2 ms batching window, then processes up to 64 requests per flush. Up to 32 adjacent commit requests share one outer transaction; reads and other operations are barriers. Per-room savepoints isolate known logical conflicts, while an unexpected database failure rolls back the complete group. Replies are sent only after the outer transaction commits. This removes a separate FULL transaction for every simultaneous room tick without weakening the durable publication barrier. Its load benefit still requires a measured run on the intended host.

Published metadata and player views are separate from the working simulation state. Snapshot, resync and platform status readers advance only after the exact candidate has committed. A failed writer closes the affected room, prevents reconnect/drain from persisting its uncommitted worker state, and requires recovery; it cannot expose a winner or receipt from a rejected transaction. Admission rechecks the drain barrier while holding the room lock.

At startup the compiled runtime is hashed and atomically archived under the data directory. Active saves load their exact retained simulation worker and dependency chunks after an image update; new rooms use the new artifact. The source code archive is verified before execution. These retained directories are part of backup and must not be deleted while their saves remain resumable. Current recovery supports serializer `forpost-world-1` and Forpost v0.1; future schema versions need an explicit reader.

The complete client build has a separate content hash and retained directory. An admission points to `/realtime-assets/<client-hash>/`, so a recovered match continues with its compatible client files even after `/play/forpost/` changes. Both runtime and client archives live in the persistent realtime volume and are covered by its backup. Their hashes are verified before use; archive metadata is not served as a public asset.

Final results have an immutable resultId and durable outbox. The platform stores the room outcome and result receipt in one transaction, then acknowledges the result over the signed bridge. A lost acknowledgement is retried without another match or another result. Expired rooms have an abandoned result with no winner. Completed/abandoned records remain queryable for platform delivery even after they leave the active worker set.

`/health/ready` and `/api/realtime/v1/health` expose actual build and artifact identity, room count and timing counters. The room limit is deliberately conservative until a measured load run establishes capacity. Production host preparation and its real access boundary are documented in [REALTIME_HOST_INTEGRATION](../../docs/iva-games/REALTIME_HOST_INTEGRATION.md).

Metrics distinguish worker RPC latency (`stepP99Ms`), actual worker wall and thread CPU work (`stepWorkP99Ms`, `stepWorkCpuP99Ms`), writer acknowledgement latency, oldest unpublished journal age and active snapshot age. Whole-process CPU counters include all threads; take differences over the measured interval rather than dividing a since-start total by an unrelated tick interval. Per-connection queue lengths and start queue entries are available only in authenticated maintenance diagnostics. Infrastructure counters do not expose worlds or battle statistics. These counters and a profile file are measurement inputs, not evidence that a capacity acceptance gate has passed.
