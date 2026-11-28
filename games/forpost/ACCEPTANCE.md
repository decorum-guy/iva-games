# Forpost acceptance evidence

## Status

Implementation is in progress. This document records observed results, not a release certificate. Browser acceptance rounds completed: **0**. No public Forpost release has been made by this task.

Sources: the normative project documents merged from PR #41 at `0479cdd43d783afbccc54ed7050637a052edb220`, the local implementation, and actual command results. No remembered conversations or fabricated play sessions are used as evidence.

## Environment limitations observed

The execution environment gives separate commands isolated process and network namespaces. A realtime server launched on loopback port 4274 remained alive in its command session, but a separate command and the cloud browser both received connection refusal. An explicit request to run that loopback server outside the command sandbox was rejected by the configured approval policy (`sandbox_approval: false`). No namespace or permission bypass was attempted.

The cloud browser also rejected inspecting its resulting internal error page because its URL protocol is outside the permitted HTTP/HTTPS protocols. This is not a game failure or a passed browser check.

The installed Chromium wrapper has no matching browser executable. The normal `npx playwright install chromium` download from `cdn.playwright.dev` failed with HTTP 403. No browser rendering, pointer passage, visual FPS, audio listening or physical touch-device result is claimed from that attempt.

The repository's release mechanism currently needs host provisioning before enabling a third image/service. An ordinary two-image release does not implicitly authorize or configure the new realtime service. The implementation preserves the existing fail-closed activation gate. No administrator SSH access has been established in this session.

## Development defects found before browser acceptance

These are integration, code-review and automated-test findings, **not browser acceptance rounds**.

| ID | Finding and original scenario | Change | Verification evidence |
|---|---|---|---|
| D01 | Creating practice without optional weapon/tool returned HTTP 503 | Canonicalize the serialized request shape before fingerprinting | Real HTTP/WS smoke reran practice creation successfully |
| D02 | Client expected different control/phase fields and sent an extra claim field | Match `controlling`, `phase`, strict claim envelope; gate spectator input | Static protocol comparison; browser verification pending |
| D03 | Setting controller every simulation tick reset repair/input | Apply controller changes only on actual transitions | Runtime takeover and pause regressions passed; UI passage pending |
| D04 | Opposite-team transport payload copied escort/private timers | Explicit radar projection, own-team-only private fields | Core privacy regression and filtered real WS snapshots; pixel/audio checks pending |
| D05 | Chamfered model triangles wound inward | Correct generator winding; regenerate 52 GLBs | Structural GLB validation; browser render pending |
| D06 | Maximum-scene server tick exceeded its budget | Navigation/visibility caches reduced routine cost; maximum scene still fails | Frozen f2fe93 p99 wall 48.996 / 15.977 / 22.287 ms; two variants exceed 16.667 ms |
| D07 | Build confirmation closed after a rejected command | Return command success and close preview only on success | Typecheck/lint; original browser scenario pending |
| D08 | Reload/build/delivery sound names did not match engine events | Explicit sound-event mapping; play weapon audio once per sound event | Code audit; audible verification pending |
| D09 | Lobby lacked per-seat team/loadout/bot setup | Ownership-checked setup endpoint and room controls | Platform HTTP tests; browser verification pending |
| D10 | A future runtime image could not recover an older artifact's unfinished match | Retain verified simulation and client artifacts for each match | Real restart/old-artifact smoke passed; final candidate retest recorded by runtime report |

| D11 | Result/reconnect/paused overlays left controls active | Neutralize and disable controls outside connected gameplay | Source audit; UI passage pending |
| D12 | New guest practices could leave the sole resumable prior practice occupying capacity | Explicitly abandon the prior guest practice before creating a replacement | Endpoint smoke passes; repeated UI replacement pending |
| D13 | Occupied pad navigation opened construction options instead of its building | Resolve the selected pad to its current visible building | Typecheck/lint; UI passage pending |
| D14 | Own fighter disappeared on death, making loadout controls inaccessible | Keep loadout in the inspector and add a respawn entry; explain base restriction | Source audit; UI passage pending |
| D15 | Explicit attack moved toward the selected enemy but shot a different priority enemy | Prefer the valid explicit target for fighter/drone fire | Regression verifies actual shots; final core 57 tests pass |

| D16 | Saved mute/volume values were not applied when the audio object was first created | Configure the mixer immediately from saved settings | Source audit and client build; listening pending |
| D17 | Neutral input during host pause received an error that falsely restored connected status; claim did not resume simulation | Gate input/actions by host phase; resume paused matches using fresh admission | Five added client protocol regressions; 10/10 client protocol tests pass |
| D18 | Unlisted power consumers appeared in creation order rather than the core default order | Use explicit priority, RULES.powerOrder, createdTick and ID; identify each pad | TypeScript/ESLint; visible interaction pending |

| D19 | A retained fire-press counter looked like a new press after controller input reset | Reset local input only on fresh session/generation/epoch | Real-core regression reproduces the phantom shot and verifies zero shots after reset; ordinary pause/errors preserve the counter |
| D20 | Releasing a movement finger also released repair held by another finger | Track tool pointer IDs and keyboard ownership independently | Controls EventTarget regressions for own/other pointer, keyboard combination, blur and cancel |
| D21 | Focus on a button/link blocked movement after using the HUD | Keep movement active while preserving native button/link activation and editable-field shortcuts | Controls keyboard/focus/modifier regressions; physical/browser interaction still pending |

## Evidence already obtained

- Full `npm run check` passed: 106 files, 1304 passing tests, one intentionally disabled opt-in 72-match test. TypeScript, ESLint, registry and boundary checks passed. Later explicit-target regression passed in the 57-test core suite.
- `npm run build:all` passed for existing games, portal, platform, Forpost and realtime.
- Same-command real HTTP/WebSocket stack passed 10 checks including all 151 asset hashes, real account admission and acknowledged mode/build actions; this was not browser play.
- Package-boundary validation passed across 301 source files at the full regression checkpoint; pure core imports remained isolated.
- Final core rule/tutorial/privacy suites passed 57 tests at aggregate source hash f2fe9304a57859a8a7767f49f31df9bfba31dfe1e19c0d4de63088bcca367e08. The final technical series completed 72/72 normal matches with zero technicalErrors; see CORE_HANDOFF.md for all rows.
- Seven lessons were walked through with real core commands in automated tests. This demonstrates the lesson predicates, not the usability of their visible controls.
- Realtime tests used actual HTTP, WebSockets and SQLite: signed admission, one-use tickets, isolated guests, controller takeover, idempotent durable actions, empty pause, restart and abandonment. Final rerun results will be recorded below.
- Existing deployment Python tests passed after the third-service changes. Docker itself is unavailable here, so no container-build result is inferred from those tests.
- Original assets were structurally validated. Sources, licenses, hashes, polygon counts and audio measurements are in `art/ASSET_REGISTER.md` and its machine manifests.

## Required release matrix

`Pending` means not accepted. An implementation or passing unit test does not change that status by itself.

| Area | Required evidence | Current status |
|---|---|---|
| Exact build | Client and running server identities; asset hashes; immutable source revision | Pending final candidate |
| Three maps | FP01, FP02, FP03 completed through normal UI to match result | Blocked browser access |
| Combat | All three weapons, reload, protection, ray collision, smoke/barrier/repair | Core tests; UI pending |
| Tactics | Own selection, group selection, orders, drones, delivery without direct shooting | Core tests; UI pending |
| Construction | Reservations, physical builder, queue/reorder/cancel, limits and refunds | Core tests; UI pending |
| Power | Relay graph, personal supply, priority, outages, generator restoration | Core tests; UI pending |
| Objectives | Stations, routes, escort, unloading, same-tick deaths/deliveries, overtime | Core tests; UI pending |
| Outcomes | Three-operation progression, side changes, wins/draws, repeat and menu | Core tests; full UI pending |
| Tutorial | Seven actual exercises, skip/restart/resume, isolated save | Core walkthroughs; UI pending |
| Network | 2+3 independent clients; latency/loss/jitter; backpressure; controller handover | Real HTTP/WS smoke and 14 controlled TCP-delay profiles passed on their recorded old artifacts; true IP loss and final-build matrix pending |
| Privacy | Raw views, events, sound sectors, statistics, stale memories and pixels | Projection tests; pixel/audio checks pending |
| Recovery | Crash, durable receipts, owner fencing, 24h empty pause, exact old artifact | Partial tests; final matrix pending |
| Interaction | Every element/state in `UI_COVERAGE.md` | Inventory prepared; specific R2 automated subcases observed, complete state matrix pending |
| Desktop/touch | Keyboard, pointer/touch, focus loss, fire release, rotation, 390×600, 130% text | R2 automated layout/rotation assertions passed; native multitouch automation and physical device acceptance pending; executor browser access blocked |
| Performance | Maximum scene, four-room/hour load, client FPS/frame times on named hardware | Maximum-scene p99 gate failed; both four-room hour attempts failed before an hour; client FPS pending |
| Bot series | 3 maps × 3 sizes × 2 sides × 4 seeds = 72 normal-rule matches | Final 72/72 technical matches, zero technicalErrors; not UI acceptance |
| Human balance | Separate observed matches with shooter and strategy players | Not performed; bot data is not a proxy claim |
| Public release | Accepted candidate, normal merge/CI/deploy, actual public catalog/room/game actions | Not released; provisioning prerequisite unresolved |

## Post-series correctness fixes

These are the technical corrections preceding CI round 2, not browser rounds. Their core source aggregate is `22a7132db389203fa93bb430998c92d4cf632e827a708c74d7c138208c60c768`; 59 targeted tests passed. The previous 72-match result and maximum-scene measurements remain attached to `f2fe9304…`. Later optimization `14d49d29…` and its still-failing performance gate are recorded separately in `CORE_PERFORMANCE.md`.

| Finding | Correction | Actual verification |
|---|---|---|
| New controller generation could acknowledge the previous generation’s consumed sequence | Reset consumed sequence on admission | Reproduced old ACK713 on generation2; real reconnect regression checks initial −1 |
| A slow/failed durable write could expose an uncommitted tick or final outcome | Maintain a separate committed publication boundary | Four runtime fault-injection tests, including failed writer and drain race |
| Silent half-open sockets could delay empty pause twice | Count from the actual last-seen heartbeat | Deterministic runtime regression |
| Temporary human takeover used normal reactions but original strong/novice strategy branches | Use one effective normal profile for all decisions | Two decision regressions fail before the change and pass after |
| Client stopped recovering after one failed renewal and could lose a finished-game receipt | Retry recoverable admission errors; replay original pending IDs after reconnect/control; suspend timeout during pause | 23 mocked client protocol tests pass; not a browser/WAN claim |
| Docker builder lacked git metadata and the build revision | Pass VCS_REF to IVA_BUILD_SHA in builder stage | Source check; actual container build delegated to repository CI |

See `ACCEPTANCE_MATRIX.md` for all F01–F22 and E01–E16 requirements, and the realtime validation report for actual artifact IDs and the two failed load attempts.

## Executor-operated browser rounds

None completed. Any future round must record source commit, compiled client hash, server artifact ID, actual environment, UI scenarios, defects and original-scenario retests here before release.

## Repository CI round 1 — automated, not executor browser play

PR [47](https://github.com/decorum-guy/iva-games/pull/47), branch head `03530767e678fe2017b520d14f1b81665345d8ed`, tree `2f0444e6ed83e4faa845e81c3f166dd035ebd191`; GitHub checks built PR merge ref `4a4fde3f38a727f3434ea233ad822487e9b690a4`. Fresh accepted main `1f571a7fa24a5c682a236d5fa0ef5a499f09c24d` is included.

- [Platform run](https://github.com/decorum-guy/iva-games/actions/runs/46157811110): full check passed **1332 tests in 107 files**, one optional series test skipped; TypeScript, ESLint, boundaries, 55 deployment tests and build:all passed. The network-smoke step failed at reading `participant.statistics.spent`: live statistics are deliberately absent. The corrective test uses its own readonly QA SQLite ledger; privacy is not loosened. The corrected smoke subsequently passed locally, awaiting the next CI run. Downstream portal/District checks in this failed job were skipped, not passed.
- The same platform run's **overdrive-tutorial job passed**. Its [Forpost browser job](https://github.com/decorum-guy/iva-games/actions/runs/46157811110/job/141018214763) completed with **0 passed / 6 failed**. Catalogue navigation, matching build attributes, all three map selections and opening a lesson were reached. Exact label locators for language, building pad and lobby capacity timed out; all three match scenarios stopped before room creation. The mobile test's teardown masked its first timeout. **No match was played to a result.**
- Corrected selectors use the real combobox role and visible label prefix; mobile settings use the visible Game menu. Playwright now preserves the originating mobile error and limits individual actions to 15 seconds while keeping the full match deadline unchanged. Static checks and discovery of the same six tests passed; original-scenario browser replay is still pending. These are test-harness corrections, not a passing acceptance claim.
- [Release image run](https://github.com/decorum-guy/iva-games/actions/runs/46157811112): **all three images** (chess/platform/realtime) built and passed isolated runtime/volume verification. Publish and deploy jobs were **skipped** on this PR.
- [Colossus review](https://github.com/decorum-guy/iva-games/actions/runs/46157811117): rules/server tests, full build and Colossus browser tests passed. This is regression evidence for the existing game, not Forpost acceptance.

## Public catalogue observation

The executor opened `https://iva-games.pro/games` in the cloud browser and waited for the actual catalogue to render. It showed «Пробный стол» and «Район» as playable and «Гавань» as coming soon. There was **no Forpost card**. This was a read-only inspection of the existing public site, not a Forpost game round or a publication of this branch. The visible catalogue did not expose its exact deployed commit; no public Forpost revision is asserted.

## Repository CI round 2 — automated, not executor browser play

PR head `0120205d3b4ac8399ab394a0eafe896d7e03eb67`, tree `87803efc0a68a84b5304f11df2e468a4281d912b`; the observed checkout and client/server build revision were GitHub merge commit `f957ca52d7e3899f9075a7a4197d6b18e3fcb27f`. This round does not test subsequent local renderer, admission, core or control changes.

- [Platform general check](https://github.com/decorum-guy/iva-games/actions/runs/46160751975/job/141027294700) **passed**: 1351 tests / 108 files, one optional series skipped; types, lint, boundaries, 55 deployment tests, full builds, real network smoke and existing portal/District browser regression steps. The earlier statistics-fixture failure is closed by its original real-server scenario. Overdrive tutorial and [Colossus review](https://github.com/decorum-guy/iva-games/actions/runs/46160751960) also passed.
- [All three release images](https://github.com/decorum-guy/iva-games/actions/runs/46160751947) passed their actual container/volume checks. Publish/deploy were skipped.
- [Forpost automatic browser job](https://github.com/decorum-guy/iva-games/actions/runs/46160751975/job/141027294468): **2 passed / 4 failed**, no complete match. Catalogue/build identity/all maps/RU–EN/settings persistence passed. Touch layout, 130% text, visible menu-to-settings route, 2D and rotation passed. These replay and close the corresponding R1 selector/navigation failures.
- FP01/FP02 created real account rooms, started matches and loaded the pinned client. Their initial battle wait failed: preparation remained at 15 seconds and the UI reported a saved pause. The cause is not yet established; a blocked client and missing application heartbeats are a hypothesis, not a measured conclusion.
- The construction lesson accepted both real orders but did not complete them. After the timeout the visible clock had advanced about two simulation seconds, with both orders still queued. Browser scheduling/rendering requires diagnosis; this is not a passing build lesson.
- FP03 reached two actual operation results (1:1). During the transition, its result overlay intercepted an Escort click, and the automation failed before the third operation. The full match was not completed. The correction must handle an observed phase transition through the visible interface, without forced clicks or removing the overlay.

Independent executor browser rounds remain **0**. There have been **2 completed automated Forpost UI rounds**, both failed overall. New interaction scenarios and isolated map jobs are prepared for the next candidate; discovery/static validation is not their execution.

## Candidate corrections prepared for CI round 3

These changes have source/unit validation and are awaiting original-scenario browser replay. They are not counted as a third executed UI round yet.

- Restoring a lesson now resets the local input stream's consumed fire sequence, preserving the lesson itself. The regression failed before the fix and passed afterwards. Enter and Space release only the tool input that they own; two regressions failed before the fix and passed afterwards. Gameplay buttons and dispatched actions share the same paused/modal/result/controller guard.
- Scene work reuses unchanged visibility contours, fog textures and hazard geometry. There were 580 exact comparisons with the previous contours and six invalidation/upload tests. Default 3D, shadows and sight rules are preserved. Node CPU timings do not establish browser FPS or prove the cause of R2's stalls.
- The FP03 automation tolerates a click timeout only when it has actually observed a new operation or result phase. It never force-clicks through the result screen. Every suite now logs bounded failure diagnostics without world snapshots, cookies or tokens.
- The UI suite contains 17 scenarios in three files: existing map/catalogue checks, all seven lessons and associated settings/economy/control assertions, plus native Chromium-emulated multitouch. CI isolates each map in its own real server/database/browser job and runs the interaction suite separately in WebKit. No new UI scenario is accepted before execution.
- The complete local unit run initially had 1399 PASS, one skipped test and a timeout in the existing Remorse king-fracture test. Its four original tests passed alone. Repeating the full suite with two workers passed **1400 tests in 114 files**, one optional series skip; no test timeout or old game source was altered. TypeScript, ESLint and boundaries passed; **55 infrastructure tests passed**. A subsequent narrow cgroup-ancestor correction has its own 14 passing capacity tests. The final CI checkout will bind these changes to one immutable revision.
- Admission FIFO/reservations, resource checks, durable commit batching and explicit age/CPU metrics are implemented in this candidate. A production capacity profile is not asserted; the conservative fallback permits one room. Exact-artifact network replay and the four-room/hour gate remain separate requirements.

## Repository CI round 3 — automated, not executor browser play

PR head `5cc963b84aa8401e24621e595beca9ed16f9e0ae`, tree `f3ff57573fb9ce7f3399e6cc0312aee56160943e`; actual CI checkout/build `d0e1833c75685ce51612b58bac3db2e555cdf1f5`. Runtime artifact `sha256:f9190c52e5085d217299aec0957894aed6694028b639618f382b8903a7956826`; CI client content `sha256:7a2aa7a3428005155829e41523d0beef3dd7fa5cd74c4501ada86ded91fd42e3`. Sanitized observations: [ci-round-3.json](qa/ci-round-3.json).

- [Chromium interface](https://github.com/decorum-guy/iva-games/actions/runs/46164755197/job/141039707438): **13 PASS / 1 FAIL**. All ten interaction cases passed in the explicitly selected 2D renderer, plus catalogue/settings, mobile layout and native browser-emulated multitouch. Six lessons reached their completed predicates; the infrastructure interaction checked cancellation/refund but did not yet wait for completion. Default-3D construction still failed: about three simulation seconds advanced during the observed 60.4 seconds. SwiftShader frame p50 was 266.6 ms, p95 350 ms; 215 long tasks totalled 59.155 seconds. No page errors were reported. This identifies slow rendering/scheduling, not its precise expensive operation.
- [FP01](https://github.com/decorum-guy/iva-games/actions/runs/46164755197/job/141039707659), [FP02](https://github.com/decorum-guy/iva-games/actions/runs/46164755197/job/141039707741) and [FP03](https://github.com/decorum-guy/iva-games/actions/runs/46164755197/job/141039707679) all **failed**, with no complete match. Every pause explicitly reported `SERVER_BUSY`. FP01/FP02 paused during preparation; FP03 reached battle first. Worker p99 was 2.3 / 3.1 / 3.7 ms, durable commit RPC p99 155 / 261.5 / 79.1 ms, maximum commit 267.3 / 396.2 / 343.6 ms. `storageFailures=0`; connection queues were empty. Missing heartbeats are not the observed cause. Writer/checkpoint attribution remains under investigation; thresholds and `synchronous=FULL` are not relaxed.
- [WebKit 27.2](https://github.com/decorum-guy/iva-games/actions/runs/46164755197/job/141039707733): **9 PASS / 1 FAIL**. Tab-switch firing continued after `bringToFront`; R3 did not record a real blur/visibility transition. Installed Playwright's WebKit setup forces active/focused state, so driver behavior is a hypothesis requiring an explicit focus-loss precondition, not a confirmed Safari game defect.
- Across Chromium's 17 and WebKit's 10 executions: **22 PASS / 5 FAIL**. These are automated scenarios, not 22 full games or physical-device checks. Complete browser matches and executor-operated Forpost passages remain **0**.
- [Strict maximum-scene CI probe](https://github.com/decorum-guy/iva-games/actions/runs/46164755197/job/141039707705) **passed** the unchanged 500-sample, 30-warmup, p99 <16.667 ms criterion: smoke 7.492575 ms, barriers 4.326724 ms, mixed 2.698969 ms. Runner: Node 24.22.3, AMD EPYC 7763, available parallelism 4 and about 16.76 GB reported memory; explicit cgroup quotas unavailable. This named CI result does not erase the local 17.939 ms failure or establish production capacity, a four-room hour or browser FPS.
- [All three images](https://github.com/decorum-guy/iva-games/actions/runs/46164755199) passed actual container checks; publish/deploy skipped. [Colossus review](https://github.com/decorum-guy/iva-games/actions/runs/46164755218) and Overdrive tutorial passed. [The general check](https://github.com/decorum-guy/iva-games/actions/runs/46164755197/job/141039707765) also passed 1401 tests in 114 files (one optional skip), types/lint/boundaries, infrastructure checks, full builds, real network smoke and existing-game browser regressions.

Local real-server smoke R6 on the identical source tree passed **14/14**, including lost purchase ACK/SIGKILL/recovery and exact prior runtime/client restoration. Its local build revision gives client hash `sha256:0b5313c7c6ef1456ba7c9dd554a81860bd2535c7add5f33bcd389aa93a48f48c`, distinct from CI. Its two-room profile is explicitly a test fixture; maximum observed commit batch size was one. R5 core series finished **72/72**, with the same recorded game outcomes as R4; this does not replace the failed browser passages.

There have now been **three completed automatic Forpost UI rounds**, all failed overall. Further candidate work adds separate 2D full-map passages while preserving all three default-3D checks, finishes the infrastructure lesson after its refund case, records actual focus history and measures writer/render work. These additions remain unaccepted until replayed on another exact build.

## Candidate corrections for round 4 — not an executed browser round

The old lesson scheduler ran one core step per main-thread timer callback. R3's long tasks therefore delayed the tutorial clock itself. The candidate moves that isolated simulation into a module Worker with fixed 30Hz steps and at most two catch-up steps per timer cycle. It never substitutes a larger dt or advances from render frames. One unconsumed view bounds Worker-to-UI delivery. A genuine new input sample has a new sequence; 250ms input expiry, the core expiry and a discarded press counter prevent blocked UI or delayed neutral samples from reviving old fire.

Acknowledged lesson actions are saved before their receipt resolves. The client caches the exact serialized world paired with its latest displayed view, saves that synchronously on pagehide, and requests a final Worker flush on ordinary close. Reload cannot reliably await a final Worker reply: recovery is from the last delivered snapshot, not an asserted unavailable final tick. A later lesson owns the save; an older worker cannot overwrite it. Pagehide neutralizes input without permanently closing a page that may return from the back/forward cache.

The focused engine/client run passed **31 tests**: eight Worker clock/input/lifecycle regressions and 23 existing protocol tests. The transport fixture uses the real core with asynchronous message delivery and controlled test timers; this is not native Worker execution, browser FPS or a fourth UI round. TypeScript and the owned ESLint checks passed. The unchanged default-3D construction scenario still needs its original browser replay.

Other R4 preparations include bounded static geometry merging, read-only render wall-time counters, actual blur/visibility history, and a native Web Audio scenario for the 29 shipped WAVs. That scenario checks real decode/voices, fresh cues, mute and saved-lesson reload without replaying old shots. Source/static checks do not establish native audio execution or listening. The writer checkpoint candidate and version-retention image/preflight work likewise require combined build and real recovery/container replay.

A source-derived navigation race is also corrected: a delayed create/ticket response must not reopen a game over a newer menu or lesson. A navigation generation guards these transitions and later session callbacks; a cancelled create attempts to abandon only its returned match. The prepared UI regression holds delivery of a real server response, selects another real lesson, then requires app-driven cleanup and a working new lesson. Practice fixtures now clean up their own matches after assertions so the one-room admission guard remains active. This scenario has passed discovery/types/lint, not native browser execution yet.

The capped-image harness has 17 passing Node fixture tests. Its planned four-room hour uses the actual production image bytes, a separately labelled diagnostic admission profile and observed cgroup resources. Socket closure, stopped ticks, storage failure and queue overflow cannot silently reduce the workload. No production capacity profile is generated from these fixture checks.

### R4 local combined verification and real network R7

The normal merge includes accepted main `81597cefd83ba278bbaa41c782b1e6aa7f9d0999`, including PR49/51/52. The sole HTTP-route conflict retained both room-history operations and Forpost setup/tickets. Clean local commit `e5f91064e1ece289c719356f19c2456b8b93d0af`, tree `99ba139440905da0e3b497eaf3f0249c55bc3ce8`, passed boundaries, global TypeScript/ESLint, **1440 tests in 120 files** (one optional series skip), **17 profile-harness tests**, **74 infrastructure tests**, and `build:all`. Infrastructure tests mock host activation; their `ACTIVE` messages are not a deployment. Exact commands, exit codes and raw-log hashes are recorded in [local-round-4.json](qa/local-round-4.json).

Real HTTP/WS/SQLite smoke R7 on that exact build passed **14/14**, exit 0, 57.909 seconds. It replayed the real purchase/lost ACK/SIGKILL/one charge-and-receipt scenario and continued an older exact runtime/client after a controlled compiled-artifact change. All own server processes shut down normally. Runtime: `sha256:e943da72ab09c23299e5649a6339a40dc02807a7cced95f98467a1f7c31abbb7`; local client: `sha256:f03c0ec6de5fa1ca95e133deaad04450c46cfcf5883241e6ccd3e0d3378283a9`. New source inventory `iva-forpost-source-2` covers 245 files and hashes to `9de79f7fe50cde2e0c51256b07c2dc05325f38732bc55621696b4d29b348023a`; it is a broader inventory than the old 55-file R6 method. Core hash remains `14d49d29954d0f7f427feea026beb23113699ff8ecb36ec4480f61f339a61e68`.

Observed functional-probe metrics: worker work p99 5.2 ms, worker RPC p99 11.7 ms, commit RPC p99 19.4 ms, writer transaction p99 9.9 ms, writer queue p99 4.9 ms, checkpoint p99 7.5 ms. Storage/checkpoint failures and queued output bytes were zero. FULL remained `synchronous=2`; `wal_autocheckpoint=0`. The two-room admission is still an explicit synthetic test fixture, observed maximum commit batch size is one, and the new sealed-image path is not exercised by this local non-container probe. These numbers do not close the R3 browser overload failures, prove causation, or accept capacity. Native browser, image and hour jobs must report their own CI checkout and client hash.
