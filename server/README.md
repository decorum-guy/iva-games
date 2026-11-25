# Authoritative online rooms

This directory implements the private, unrated two-player mode specified in
`docs/ONLINE_ROOMS_V1.md`. `src/core` remains the single source of game rules.
`src/online/protocol.ts` is the public browser/server contract.

## Entry points

`server/main.ts` starts the HTTP and WebSocket service. `createOnlineServer` in
`server/http.ts` exposes `listen(port, host)` and `close()` for tests and embedding.
The returned `service` and `store` are internal server objects; neither is exposed
by an API. Test positions and scripted dice are injected only in tests, never
through a production endpoint or a browser command.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4173` | HTTP and WebSocket listener |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `data/remorse.sqlite` | Persistent SQLite file; retain its directory between releases |
| `STATIC_DIR` | `dist` | Built browser application |
| `PUBLIC_ORIGIN` | none | Exact public origin; required when `NODE_ENV=production` |
| `DEV_ORIGINS` | none | Optional comma-separated additional origins for development |
| `ROOM_INACTIVE_MS` | `86400000` | Expiry after accepted activity; synchronization and heartbeat do not refresh it |
| `FINISHED_ROOM_MS` | `604800000` | Finished-room retention; values below seven days are clamped to seven days |

For the intended deployment, use `PUBLIC_ORIGIN=https://remorse.chess-2.online`
behind an HTTPS reverse proxy supporting WebSocket upgrades. The guest cookie is
HttpOnly, SameSite=Strict, Secure under HTTPS, and **host-only**. The server never
sets a cookie Domain for `chess-2.online` or its sibling applications.

## HTTP contract

JSON POST requests require `Content-Type: application/json` and an allowed Origin.
There is no CORS wildcard. All API responses are `Cache-Control: no-store`.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/health` | none | `{ok, protocol, rulesVersion}`; also checks SQLite access |
| `POST /api/guest` | `{}` | `{protocol}` and a guest cookie |
| `POST /api/rooms` | `{name, side, requestId}` | `{snapshot, invite}`; 201 |
| `POST /api/rooms/:roomId/join` | `{name, invite}` | `{snapshot}` |
| `GET /api/rooms/:roomId` | none | `{snapshot}` for an authenticated seat |
| `POST /api/rooms/:roomId/invite` | `{}` | `{invite}` for the creator while the other seat is empty |

Issue the guest cookie **before** exchanging the invitation. A successful join
whose HTTP reply is lost can then be retried with the same cookie. The second
reply returns the existing seat; it cannot create a second occupant. The creator
cannot occupy both seats with the same guest identity. A third guest cannot use
an already-consumed invitation. The browser puts the invitation secret in the
URL fragment, removes it after exchange, and never includes a persistent seat
credential in a URL.

Creation is keyed by the creator and `requestId`. Retrying an identical request
returns the same room and rotates any still-unused invitation. An explicit new
invitation also invalidates the previous one. Raw invitation and guest tokens
are not stored in room snapshots or database rows; their SHA-256 hashes are used
for lookup/comparison. The database still contains player names and game history
and should be treated as application data in backups.

API errors have the shape `{error: OnlineErrorCode}`. Translation belongs to the
browser catalog. The server does not return stack traces, SQL, cookie values or
raw submitted messages.

## WebSocket and transaction semantics

The endpoint is `/ws`, authenticated by the existing cookie and Origin. Send
`{type:'hello', protocol:'remorse-online-v1', roomId}` within five seconds.
Successful `hello` and `sync` receive `welcome` containing a full public snapshot.
Updates carry the same root, authoritative current state and complete resolved
action/event history. Neither snapshot exposes a random seed, future rolls,
private guest identity, local undo/redo or a tutorial flag.

Each game command includes `commandId`, `gameId` and `expectedRevision`. The game
revision counts accepted core actions. The separate room revision also counts
lobby/consent changes. Ready, draw offers and rematch consent use the current game
revision but do not fabricate chess actions.

For a command, the service first verifies the current connection and seat, then
looks up a persisted command ID and compares guest identity plus canonical
payload. An exact retry returns the original ACK before checking the current game
revision. Reusing the ID with different data fails. Only a new command proceeds
through revision and core legality checks. The server draws `crypto.randomInt(1,
7)` only when the shared core requires a first-capture roll.

Room state, action, resolved roll, events, result and ACK are committed in one
SQLite transaction. A failed transaction emits neither a successful ACK nor an
update. A successful transaction broadcasts its update, then acknowledges the
sender. A repeat gets its saved ACK without broadcasting old animation events.
After a dropped connection the browser synchronizes first and can resend the
same immutable pending request. A new socket for the same seat invalidates the
old connection server-side and sends it `replaced` before closing it.

The implementation uses one Node process and synchronous SQLite transactions;
commands cannot overlap inside a transaction. Multiple app processes sharing a
database are **not supported** because presence and active-connection ownership
are held by the process. Start one application process for this release.

Both players must be ready and connected to start. During a game, an absent
opponent pauses game commands. A connected player may still resign their own
side. A network loss never awards a victory. Draw acceptance must name the
current offer and come from the other seat; a move, replacement offer or refusal
invalidates the old offer. Mutual rematch consent creates a new game ID, exchanges
colors and preserves the old finished game in `finished_games`. It cannot mutate
the old result. Online games never update local Elo.

## Persistence, limits and verification

SQLite uses WAL, foreign keys and explicit schema/save versions. On first access
after service restart, a stored game's root and state are validated, each action
is replayed with its recorded server roll, and event IDs/current state are checked.
An incompatible schema/protocol or damaged history is rejected, not silently
repaired or played with different rules. The full database directory should be
on a persistent volume. Make consistent backups using SQLite's backup facility
or while the application is stopped; copying only a live main file can omit WAL
transactions.

The service checks heartbeat every 15 seconds and removes an unresponsive socket
after a missed cycle. Heartbeats and read-only snapshots never advance game time
or prolong room expiry. Expiry closes the room technically, leaving the chess
outcome unchanged. Cleanup processes at most 100 rooms and 100 expired guests per
sweep. Expired rooms are retained for an additional configured retention period
before deletion, so finished games remain for at least seven days.

Incoming JSON and WebSocket messages are limited to 16 KiB. Limits also cover
HTTP requests per peer IP, room creation per guest, active owned rooms, WebSocket
messages per guest and simultaneous sockets. A slow receiver with more than
2 MiB of queued outbound bytes is disconnected for synchronization on reconnect.
Compression is disabled. Forwarded IP headers are not trusted: behind a reverse
proxy, HTTP/upgrade rate limits currently share that proxy's peer address; game
message limits remain per guest. Adjust this deliberately before a larger public
launch rather than trusting arbitrary forwarded headers.

Backend checks are in `tests/unit/online-server.test.ts` and
`tests/unit/online-http.test.ts`. Run:

```sh
npx vitest run tests/unit/online-server.test.ts tests/unit/online-http.test.ts
```

The HTTP suite binds to localhost port 42911 by default; set `ONLINE_TEST_PORT`
to use a different available test port. It opens two real HTTP/WebSocket clients
with separate cookie identities, finishes a four-ply checkmate from the standard
position, restores a live bonus after closing and reopening the server and
database, and verifies takeover, offline state, agreement/rematch, heartbeat,
origin/authentication and payload rejection. These are transport and rules tests,
not a claim of manual visual, public-Internet, TLS or physical-phone acceptance.
