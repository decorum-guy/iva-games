# Iva Games portal

React/TypeScript interface for the common Iva Games platform. All account, friend, invitation, room and match state comes from the platform API; the UI has no demonstration accounts or local substitute for server state.

## Local development

From the repository root:

```sh
npm ci
npm run dev:platform
```

In a second terminal:

```sh
npm run dev:portal
```

Open `http://127.0.0.1:5175`. Vite proxies `/api/platform` to `http://127.0.0.1:4310` while preserving the browser Origin. `IVA_PLATFORM_TARGET` changes only this local proxy destination. Platform allowed origins/hosts must still match the address used in the browser.

The isolated development mailbox is configured by the platform and stores verification/reset messages on the local filesystem. It sends no email. Open the generated verification link and explicitly confirm it in the portal. SMTP configuration and production restrictions are described in the platform documentation; seeing a development message is not evidence of email delivery.

Production uses the built `apps/portal/dist` directory served on the platform origin. Build with `npm run build:portal`; the backend can serve it through `PORTAL_DIST_DIRECTORY`.

## Implemented screens

- Registration, login, explicit email verification, recovery, logout and session revocation.
- Public display name, private email and language preference.
- Friend search by handle, requests, acceptance, decline, cancellation, removal and blocks.
- Addressed invitation inbox and sent invitations, reservation acceptance followed by explicit room entry.
- Room creation/settings, fixed participants, readiness, host transfer, departure/cancellation and invitations.
- Host-controlled bot seats when the game explicitly supports them; difficulty selection and removal.
- **District**: three selectable versioned maps, goals, economy, deals, joint parks, private bids, development, results and history on 2–4 seats with bots. See [current status](../../games/district/STATUS.md).
- The server-backed **Practice table**: three simultaneous hidden number choices, per-player state, revealed round results, scores and return after refresh.
- Telegram linking when the platform enables it: recent-password confirmation, a private Start link, masked candidate, proof code, explicit notification choice, cancellation, mute/unmute and unlink.

Remorse/Overdrive rooms remain unavailable until their adapter is connected. District is playable in the implementation branch; Harbor remains planned. The practice table demonstrates session behaviour; it is not either new product game. Telegram remains unavailable in the UI when the backend returns `available: false`; source implementation does not imply an activated bot or real delivery.

Current production accounts use the dedicated Telegram code flow described in [TELEGRAM_ACCOUNTS](../../docs/iva-games/TELEGRAM_ACCOUNTS.md), with no mandatory SMTP. The legacy linking path below is a separate optional mode.

## Legacy Telegram linking behaviour

The profile uses the same-origin `/api/platform/v1/telegram` endpoints. A Start response only supplies a candidate; the user must enter the bot's proof code and explicitly choose whether to receive invitations before confirming on the website. Both radio options begin unselected, and connecting without notifications is supported. A recent password is requested only when the server returns `REAUTH_REQUIRED`; after successful reauthentication the UI resumes the action the user already selected. Unlink has a separate explicit confirmation.

Only `attemptId` and the server's `expiresAt` are stored in tab-scoped `sessionStorage`, so the same browser session can recover the candidate after a reload. Deep links, proof codes, passwords and Telegram identities are not persisted. Logout or an observed account change clears the reference. Reloading before Start may require a new link; creating one replaces the earlier attempt on the server.

Attempt reads run every three seconds while the page is visible and the attempt remains active. They stop at its original expiry or a terminal state. A generation guard discards reads that began before confirm, cancel or another mutation. Confirming is always a POST initiated by the user; reading status cannot opt into delivery or create a binding. The UI renders masked name/username only and validates that the Start link points to the configured Telegram bot.

## Client behaviour

- Session cookies are HTTP-only. CSRF tokens are obtained from `/session`, kept in memory and sent in `X-CSRF-Token` on JSON mutations.
- Anonymous session requests are deduplicated. Background refresh pauses while a mutation is running and waits for earlier refreshes before authentication changes, avoiding cookie replacement races.
- Ambiguous network failures retain a mutation idempotency key for a retry. Lab commands additionally retain their `actionId` until acknowledged.
- The main snapshot is polled every four seconds while the page is visible; the match view every three seconds. Server state, not the local countdown, determines expiry or completion.
- Verification and reset tokens are removed from the address bar after initial capture; confirming or resetting still requires a POST action. No auth tokens are written to local storage. Only the RU/EN preference is stored there.
- The browser receives a permitted lab view. Pending opponent choices are not present in the rendered model; only public readiness and previously revealed rounds are displayed.

## Verification scope

TypeScript checks, the Vite production build and scoped ESLint were run during implementation. Twelve portal tests cover concurrent anonymous session creation, mutation retry keys, explicit Telegram consent, expiry, stale reads, safe Start links, reference-only storage and static RU/EN status rendering; run them with `npm --prefix apps/portal test`. The static HTML checks do not exercise browser events or layout. The final project validation report records API integration results separately. That original foundation check did not have browser access. The later District implementation includes browser automation with actual rules and a separate built-server, two-browser full game; see [District validation](../../games/district/VALIDATION_V0_2.md). Human/physical-device acceptance remains separate. This README does not claim that production email, Telegram, hosting or chess integration has been activated.
