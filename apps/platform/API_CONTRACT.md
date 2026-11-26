# HTTP contract — platform v1

Prefix: `/api/platform/v1`. Responses are JSON. Errors use `{ "error": { "code": "...", "message": "..." } }`; messages currently come from the server in Russian, stable codes support UI localization. Dates are Unix epoch milliseconds.

Call `GET /session` first. It returns `{ user: Account | null, csrfToken }` and, if necessary, creates an anonymous bootstrap cookie. Every POST requires JSON, the exact configured Origin, cookie, and `X-CSRF-Token`. After register/login fetch `/session` again: credentials rotate the cookie and CSRF token. Never store session bearer tokens in localStorage. All frontend code uses same-origin requests through its server/proxy.

All listed POST endpoints reject unlisted body fields. Room/social mutations support optional `Idempotency-Key` (8–100 ASCII letters, numbers, `_`, `.`, `:`, `-`); use a fresh key for a new intent, reuse the same key and payload after a transport failure. Runtime actions have their own `actionId`.

## Accounts

`PublicPlayer = { playerId, handle, displayName }`. `Account` adds private `email` and `emailVerified`. Only the current account is returned as Account; other players never include email or Telegram identity.

| Method and path | JSON body | Result |
|---|---|---|
| GET `/session` | — | `{user, csrfToken}` |
| POST `/auth/register` | `{email,password,handle,displayName}` | 201 `{user}`; signed-in, initially unverified |
| POST `/auth/login` | `{email,password}` | `{user}` |
| POST `/auth/logout` | `{}` | `{ok:true}`; current cookie revoked |
| POST `/auth/verify` | `{token}` | `{user:Account|null}`; token consumed once |
| POST `/auth/resend-verification` | `{}` | `{ok:true}` |
| POST `/auth/forgot-password` | `{email}` | 202 `{ok:true}`; neutral response |
| POST `/auth/reset-password` | `{token,password}` | `{ok:true}`; all account sessions revoked |
| POST `/auth/reauthenticate` | `{password}` | `{ok:true}` |
| POST `/auth/revoke-sessions` | `{password}` | `{ok:true}`; all sessions, including current, revoked |
| POST `/profile` | `{displayName}` | `{user}` |

Handle is 3–24 lowercase ASCII letters, numbers and underscore; creation normalizes case. Email is trimmed and lowercased without provider-specific dot/plus rewriting. Password is 15–128 Unicode code points, never silently trimmed. Display name is 1–40 characters after trimming; handle/email changes are outside this increment.

Email URLs are `${PORTAL_ORIGIN}/verify?token=...` and `/reset-password?token=...`. The page GET must not consume a token. The user submits the corresponding POST through the form. Verification lasts 24 hours; reset lasts 30 minutes. No token is returned by the account API or exposed in the production logs.

## Social

Verified email is required for friend actions and player lookup. Search is a literal handle prefix, at least three characters, maximum twelve public results. No email/phone search exists.

| Method and path | JSON body | Result |
|---|---|---|
| GET `/players?handle=...` | — | `{players:PublicPlayer[]}` |
| GET `/friends` | — | `{friends:PublicPlayer[],incoming:Request[],outgoing:Request[],blocked:PublicPlayer[]}` |
| POST `/friend-requests` | `{playerId}` | `{requestId,state}` |
| POST `/friend-requests/:requestId/accept` | `{}` | `{ok:true}` |
| POST `/friend-requests/:requestId/decline` | `{}` | `{ok:true}` |
| POST `/friend-requests/:requestId/cancel` | `{}` | `{ok:true}` |
| POST `/friends/:playerId/remove` | `{}` | `{ok:true}` |
| POST `/blocks` | `{playerId}` | `{ok:true}` |
| POST `/blocks/:playerId/remove` | `{}` | `{ok:true}` |

`Request = {requestId,player:PublicPlayer}`. Crossed requests remain pending until the recipient explicitly accepts. Repeated request creates no duplicate. Removal/decline starts a 24-hour request cooldown. Unblocking does not restore friendship. Removing friendship or blocking revokes unused pair invitations/reservations; joined members remain until an explicit room operation or game-specific outcome.

## Games and rooms

GET `/games` is available without login and returns `{games: GameManifest[]}`. Manifest fields: `gameId,title,minPlayers,maxPlayers,supportsBots,rulesVersion,contentVersion,status`, with optional `collectionId: 'chess' | 'other'` for catalogue grouping. The built-in registrations supply this field; older/custom registrations may omit it. Status is `available`, `unavailable` or `planned`; only a registration with an actual shared-room runtime is available. A separate guest launch link in the portal does not change this status. Public portal pages `/chess` and `/games` are distinct from this API endpoint under `/api/platform/v1`.

`Room = {roomId,gameId,title,hostPlayerId,state,capacity,rulesVersion,contentVersion,revision,settings,members,reservedSeats,matchId,outcome,createdAt}`. State is `lobby | starting | playing | finished | cancelled`; `matchId` and `outcome` start as null.

Members contain `participantId,playerId,handle,displayName,seatIndex,ready,controller`. A human has `controller:{kind:'human',playerId}`. A bot has `playerId:null`, empty handle and `controller:{kind:'bot',botProfileId,botVersion,difficulty:'easy'|'normal'|'hard'}`. Bot participant IDs belong to rooms, not accounts.

| Method and path | JSON body | Result |
|---|---|---|
| GET `/rooms` | — | `{rooms:Room[]}`; own memberships, all active first followed by up to 50 terminal rooms |
| POST `/rooms` | `{gameId,capacity,title?}` | `{room}` |
| GET `/rooms/:roomId` | — | `{room}`; membership required |
| POST `/rooms/:roomId/join` | `{}` | `{room}`; accepted unexpired reservation or existing membership |
| POST `/rooms/:roomId/ready` | `{ready,expectedRevision}` | `{room}`; own flag only |
| POST `/rooms/:roomId/settings` | `{capacity?,title?,expectedRevision}` | `{room}`; host only |
| POST `/rooms/:roomId/transfer-host` | `{playerId,expectedRevision}` | `{room}`; target already joined human |
| POST `/rooms/:roomId/kick` | `{participantId,expectedRevision}` | `{room}`; host, lobby only |
| POST `/rooms/:roomId/bots` | `{difficulty,expectedRevision}` | `{room}`; host and game capability required |
| POST `/rooms/:roomId/bots/:participantId/remove` | `{expectedRevision}` | `{room}` |
| POST `/rooms/:roomId/leave` | `{}` | `{room}`; host leaving cancels lobby |
| POST `/rooms/:roomId/cancel` | `{}` | `{room}`; host, before start |
| POST `/rooms/:roomId/start` | `{expectedRevision}` | `{room}`; playing or pending starting |

Revision concerns roster/settings. Changing ready flags does not bump it; joins/leaves/bot changes/settings/host transfer bump it and reset human ready flags. Bots are ready automatically. Start requires enough participants, at least one human, every member ready, no unused reservations, compatible game versions. After start, lobby mutations are rejected; game-specific actions decide resignation/replacement.

If the runtime acknowledgement is uncertain, the room stays starting and the exact start command is retried. Poll GET room to observe the transition. Repeated start cannot create another match. Unknown versions fail before freezing a lobby.

## Invitations

Invitation fields: `invitationId,roomId,roomTitle,gameId,inviter:PublicPlayer,invitee:PublicPlayer,status,displayStatus,expiresAt,reservationExpiresAt,reason,url`.

Status: `pending | accepted | declined | revoked | expired`. `displayStatus` may also be `full`, derived from current capacity while the actual invite remains pending. `accepted` with non-null reservation expiry means reserved, not joined. Accepted with null reservation expiry means the recipient joined. Leave/kick revokes that access; unused reservations expire.

| Method and path | JSON body | Result |
|---|---|---|
| GET `/invitations` | — | `{invitations:Invitation[]}`; incoming and own outgoing, all actionable pending/reserved first followed by up to 100 historical entries |
| GET `/invitations/:invitationId` | — | `{invitation}`; sender/recipient only |
| POST `/rooms/:roomId/invitations` | `{playerId}` | `{invitation}`; host invites accepted friend |
| POST `/invitations/:invitationId/accept` | `{}` | `{invitation}`; recipient reserves a seat |
| POST `/invitations/:invitationId/decline` | `{}` | `{invitation}`; recipient |
| POST `/invitations/:invitationId/revoke` | `{}` | `{invitation}`; sender, unused access only |

Canonical link: `${PORTAL_ORIGIN}/invitations/:invitationId`. ID is routing data, not a bearer admission. A copied link still requires the addressed account. Default invite TTL is 30 minutes; reservation TTL is at most two minutes and never exceeds invite expiry.

## Runtime boundary

GET `/rooms/:roomId/match` returns `{view}` through `runtime.viewForPlayer(matchId, authenticatedPlayerId)`. POST `/rooms/:roomId/actions` accepts `{actionId,expectedRevision,payload}` and returns `{view}`. Actor always comes from the validated session, never from body. Game-specific `SessionError` codes/statuses are preserved. Requests have bounded runtime deadlines; an unknown action result may be retried with the same action ID.

Registration interface lives in `src/types.ts`. `createMatch` receives immutable command ID, room ID, version pair, participants and settings. The current runtime is in `packages/session-kit`; cross-domain chess handoff is a later adapter, not a currently active route.

## Telegram linking and delivery

Telegram is disabled by default. Without complete explicit configuration GET `/telegram` returns `{available:false,linked:false,reason:'not_configured'}`; mutation routes return `TELEGRAM_NOT_CONFIGURED` (503). Enabling the implementation requires an HTTPS portal, real bot configuration, webhook secret, proof-encryption key and explicit mandatory proxy. Tests use a fake delivery transport; live activation is a separate operation.

Configured `TelegramStatus = {available:true,linked,status:'unlinked'|'active'|'unreachable',notificationsEnabled,botUsername,account:MaskedAccount|null}`.

`MaskedAccount = {displayNameMasked,usernameMasked:string|null,userIdSuffix}`. Full Telegram numeric identity and private-chat identity are never returned to the browser or other players.

`AttemptStatus = {attemptId,state,expiresAt,candidate:MaskedAccount|null,proofAttemptsRemaining}`. State is `issued | awaiting_web_confirmation | confirmed | expired | cancelled | rejected`. Only creation adds `deepLink`; subsequent reads never re-expose the raw token. The link and proof are valid at most ten minutes. Attempts belong to the initiating authenticated session, including when another browser is signed into the same account.

| Method and path | JSON body | Result |
|---|---|---|
| GET `/telegram` | — | `TelegramStatus`, or disabled response |
| POST `/telegram/link-attempts` | `{}` | `AttemptStatus & {deepLink}` |
| GET `/telegram/link-attempts/:attemptId` | — | `AttemptStatus` |
| POST `/telegram/link-attempts/:attemptId/confirm` | `{proofCode,consent:boolean}` | `TelegramStatus` |
| POST `/telegram/link-attempts/:attemptId/cancel` | `{}` | `{ok:true}` |
| POST `/telegram/preferences` | `{enabled:boolean}` | `TelegramStatus` |
| POST `/telegram/unlink` | `{}` | `TelegramStatus` |

These responses are flat objects, not `{status:...}` or `{attempt:...}` wrappers. All browser mutations retain the ordinary Origin/cookie/CSRF rules and require verified email. Creation, confirmation and unlink additionally require password authentication within ten minutes; on `REAUTH_REQUIRED`, use POST `/auth/reauthenticate` with the password before retrying the user's chosen action. Never silently preselect consent. Both true and false are valid choices; `/start` alone does not bind or subscribe the account.

Private Telegram `/start l1_<token>` records a candidate and queues a random proof code for that private chat. The browser displays only masked identity; the user enters the code from Telegram into the original browser. Five wrong codes reject the attempt. Confirmation binds the identity with the selected notification preference. `/stop` and `/mute` in the private bot chat disable notifications. Rebinding an identity already owned by a different account is rejected.

The server-to-server endpoint is **POST `/integrations/telegram/webhook`**, outside the API prefix. It requires `X-Telegram-Bot-Api-Secret-Token` matching the configured secret and a permitted Host. Secret validation happens before reading the body. It does not use a browser cookie, Origin or CSRF token. JSON body maximum is 64 KiB. Response is `{accepted:true,duplicate:boolean}`; repeated `(botId,update_id)` is deduplicated. No GET or webhook update automatically consumes a website invitation.

The integration hooks new eligible website invitations into a persistent outbox inside the invitation transaction. The worker rechecks consent, binding, friendship, blocks, invitation, expiry, room and capacity before a send. Proxy failures have no direct-network fallback. A successful send means Telegram API accepted the message; timeouts may have delivered and are kept as an unknown result. No API claims human receipt or joins a room on the recipient's behalf.

## Useful error categories

- Authentication: `SESSION_REQUIRED`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `TOKEN_INVALID`, `MAIL_UNAVAILABLE`, `SIGNUP_UNAVAILABLE`.
- Request validation: `CSRF_INVALID`, `ORIGIN_NOT_ALLOWED`, `HOST_NOT_ALLOWED`, `INVALID_INPUT`, `INVALID_JSON`, `BODY_TOO_LARGE`, `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT`.
- Social: `ACTION_UNAVAILABLE`, `FRIENDS_REQUIRED`, `REQUEST_COOLDOWN`, `REQUEST_CLOSED`.
- Lobby: `STALE_REVISION`, `ROOM_FULL`, `ROOM_NOT_OPEN`, `RESERVATION_REQUIRED`, `INVITATION_CLOSED`, `PLAYERS_NOT_READY`, `RESERVATIONS_PENDING`, `PLAYER_COUNT`, `BOTS_UNSUPPORTED`.
- Runtime: `GAME_UNAVAILABLE`, `GAME_VERSION_UNAVAILABLE`, `GAME_TIMEOUT`, `MATCH_NOT_STARTED`; additional game-specific errors come from the registered runtime.
- Telegram: `TELEGRAM_NOT_CONFIGURED`, `REAUTH_REQUIRED`, `LINK_SESSION_MISMATCH`, `LINK_EXPIRED`, `LINK_ALREADY_USED`, `LINK_PROOF_INVALID`, `LINK_PROOF_LOCKED`, `TELEGRAM_ALREADY_LINKED`, `TELEGRAM_NOT_LINKED`, `TELEGRAM_UNREACHABLE`; webhook `WEBHOOK_UNAUTHORIZED`, `WEBHOOK_INVALID`.

On stale revision fetch fresh room data before offering another intent. On a network timeout retry the same intent with its original identifier. A successful SMTP or Telegram send does not accept an invitation or join a room.
