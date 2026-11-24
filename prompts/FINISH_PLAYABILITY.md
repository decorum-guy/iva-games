# REMORSE — finish the playability revision on the owner's Mac

## Your job

Finish the current game to a playable, visually convincing state after the owner's first playtest. This is an execution task: inspect the existing implementation, finish what is missing, fix actual defects, run the game, perform acceptance, commit/push the result and leave a working preview. Do not stop at a plan, a successful compile or a claim that unit tests prove the design looks good.

The owner delegates routine decisions and does not want clarification questions. Preserve local work, permissions and the rules. Resolve small product ambiguities coherently and record decisions. Do not bypass an actual access restriction or invent a test, model, screenshot, device or deployment result.

Repository: https://github.com/decorum-guy/remorse-chess

Expected checkout: `/Users/aartemida/Developer/remorse-chess` / `~/Developer/remorse-chess`. Inspect git status and history before fetching/switching. Fetch the latest remote revision. If local edits or concurrent work are present, preserve them and use an isolated worktree when appropriate. Do not destructively reset the checkout, delete saves, clear browser storage or force-push.

Read:

1. `AGENTS.md`, `docs/BUILD_STATUS.md` and `docs/PLAYABILITY_REVIEW.md`.
2. This entire brief.
3. `docs/ART_DIRECTION.md`, `docs/TUTORIAL.md`, `docs/ACCEPTANCE.md`, `docs/RULES_DIGITAL_V1.md` and the checked-in frontend-design guide.
4. Architecture, capture HUD, rating and localization documents where relevant.

The owner's latest corrections in this brief take priority over earlier preparation wording. The old `docs/VALIDATION.md` is historical evidence for the previous delivery, not acceptance of this revision.

## Implementation and acceptance models

The main implementation executor is **Sol 6.2 with max reasoning**, as selected by the owner.

Use a **real separate 6.1 Terra agent with high reasoning for interactive visual acceptance and computer use**. The requested identity is `gpt-6.1-terra` / `high` where those identifiers are actually exposed by the available agent tool. Inspect model/agent availability in this installation and use its supported mechanism. Do not invent CLI flags, aliases or a successful model switch.

Give the Terra reviewer this brief, the current preview URL, the status/review documents, and the concrete acceptance scenarios below. It should operate the actual browser and inspect screenshots/motion. Its job is to find defects and verify the player experience. The main executor owns implementation changes and integrates feedback. After corrections, have the reviewer repeat the affected scenarios against the updated build.

Record the actual model and reasoning level that performed acceptance. If this environment cannot launch the requested Terra model, complete all other authorized work and available checks, report that specific unfulfilled acceptance requirement, and do not claim a Terra review. Never simulate another agent or silently substitute a model in the report.

## Continue the implementation already present

The preparation pass added concise RU/EN lessons, phased tutorial input, a reading spotlight, stronger materials/markers, sound, viewport layout, a real 3D die reveal, shared timing, teaching camera focus and temporary material emphasis. Inspect these changes before deciding what remains; do not rebuild the project from scratch or replace the visual direction without evidence.

Checks already completed in the preparation environment: TypeScript, ESLint, production build and **183 unit tests**. Playwright collected **46 cases**, but that suite was **not executed there**. New rendering, motion, audio and layout have not received Mac visual acceptance. The old local build at `127.0.0.1:4173` was inspected and showed the reported problems. Do not reuse old screenshots or the previous acceptance report as proof of the new build.

Finish the requirements below and anything real checks uncover. A feature's presence in code is not proof that its effect is convincing or its UI usable.

## Required product behavior

### 1. Tutorial: the next action must always be obvious

The player should immediately know whether to read, select a figure, make a particular move, inspect a counter or press the primary button. One concise instruction and one current action dominate the screen. Put long reasoning behind optional help.

For reading, frame/glow the instruction and dim unrelated content. For a move, emphasize the actual figure and destination with contrast that works on both light and dark squares at normal zoom. Do not rely on a faint golden outline. Keep pointer/touch input available where the requested action needs it.

The reported king problem has a confirmed UI cause: at the lesson 3 read/end boundary the core allowed a king move while the tutorial expected a UI transition, yet the UI advertised the move. Verify the correction and the genuinely taught king move in lesson 4. A player must not see an advertised legal target followed by a misleading “legal, but follow instructions” rejection. The forward action must be visible.

Only offer promotion choices and bonus/end-turn actions permitted by the current step. Read/inspect/script phases must not look draggable/playable when they are not. Wrong clicks must leave an understandable objective, not a trap.

**Remove every visible explanation that tutorial dice are fixed/preset.** No separate window, subtitle, badge, repeated paragraph or special history prefix. Deterministic tutorial results remain internal and must not leak into normal play or continuation.

Keep existing lesson IDs, positions, step order and old checkpoints compatible. Preserve nine lessons and both working finish paths: continue the current position against real AI in practice, or open setup and start a clean game. Tutorial continuation does not affect Elo.

### 2. Use the 3D camera to explain effects and counters

During inspection, smoothly approach the relevant figure while keeping its complete shape and counter in frame. First emphasize its state surface, then frame/enlarge the counter. Give the player time to read. Selecting the figure must not immediately launch the next scripted move and pull the camera away: use explicit Got it acknowledgement.

After the explanation, return smoothly to the board. Keep source and destination available before asking for a move. Handle corner pieces and flipped orientation. Language switching must not replay a camera movement or material pulse.

Current code provides an eased 850 ms transition, authored inspection focus and end-of-example focus. Judge the actual result and correct abruptness, excessive zoom, poor framing or obstruction. The ordinary board flip must have a smooth start and stop, not the former quick snap.

The teaching accent must strengthen the effect **on the figure itself**: visible colored fractures/veins/material light for guilt, devastation, berserk and bloodlust, followed by a smooth return to the normal state appearance. It is one short accent, not permanent glare or endless blinking. Neutral/reborn figures must not acquire a false affliction color.

Reduced motion keeps clear static focus without camera travel, orbit animation or flashing. A 2D player must understand the same lesson and count.

### 3. Readable figures, states and square targets

White figures blended with the old bright board; guilt/devastation surfaces and halos were almost invisible without zoom. Correct the actual rendering, not just labels.

Inspect both armies in neutral and all four afflicted states, on light and dark squares. Compare same-kind figures side by side. Silhouette, surface effect, badge and counter must be readable at normal browser zoom, including mobile low quality.

Keep polished marble, ivory and obsidian materials. Use useful dark structure and controlled colored light instead of washing figures out with stronger bloom. Rings, badges and highlights support the surface effect, not replace it. Keep independent material state and masks attached to each figure through moves and camera changes.

### 4. Visible 3D die throws for human, AI and both hotseat sides

Show a volumetric die that drops, bounces, tumbles and stops on the correct face. The same presentation serves the human, AI, both local-player colors and tutorial.

The rules commit the face first; animation only reveals it and never consumes or changes gameplay RNG. The current sequence is 1500 ms motion plus 350 ms result hold; reduced motion is 180 ms plus hold. Assess the actual scale, contacts and pacing rather than treating those numbers as an artistic guarantee.

Synchronize contacts, settling, figure-state reveal and sound. Do not announce the result in another panel before settling. AI and input cannot overtake the reveal. Late component mounting catches up to the shared start time. Pending loading/WebGL-failure placeholders must not expose a static final face.

Verify all six faces, both colors and AI. Also check when no new die is appropriate: remembered reaction, mercy and the applicable special-piece exceptions must not cause a decorative fake roll. Restore, review, undo and locale changes must not reroll/replay old events. Navigation and undo during a throw must cancel it cleanly.

### 5. Working, intentional sound

Local generated cues now cover movement, captures, die contacts, states, healing, conversion/removal, promotion, check and results. Verify real Web Audio behavior: first gesture, the bot's opening move, results without a moving figure, delayed resume, hidden tabs, undo and navigation.

Fresh profiles enable effects after a genuine gesture. Preserve an existing saved mute. Provide visible header mute and settings volume. The old profile's `sound:false` must not be mistaken for broken sound. No background music, paid assets or external audio services are required.

Check for silence, clipping, harsh/weak effects, overlapping cues and repeated historical audio. Existing unit tests use mocks and do not establish actual output or listening quality. Report listening only if it actually occurred. If listening is unavailable, perform real output/signal checks where supported and state the remaining limitation accurately.

### 6. One viewport during games and learning

The document must not scroll during a game/tutorial. Keep both player names/captured-piece rows, the board and the current required action visible. Optional inspector/history and long rule help may scroll inside bounded panels/dialogs.

Check at least **1440×900, 1280×800, 1512×715, 390×844, 360×800, 844×390 and 568×320**. Check browser chrome, safe areas and rotation. Measure scroll dimensions and inspect the actual screen: hiding overflow while clipping a required button is not a fix. Preserve browser zoom and reliable touch selection.

The capture HUD stays as requested: enemy captured-piece icons under each nickname and positive current material `+N`. Do not replace this information with a new capture animation. Keep nicknames, material, difficulty and Elo legible on phones.

### 7. Preserve the working game and both languages

Keep variant-aware AI, all ten difficulty profiles, local transactional Elo, hotseat, saves, undo restrictions, history/export/import, complete Russian and English, 2D fallback and the future multiplayer boundary. Do not invent measured external bot Elo or add a network backend/accounts in this revision.

All logic uses the shared rules core. `maskRollResult` is only a renderer projection, never a legal state for search, storage, rating or check calculation. Results and dice survive refresh; rated outcomes finalize only once, including two tabs. Normal and tutorial RNG remain separate.

## Concrete acceptance procedure

1. Confirm the exact checkout revision. Build a fresh production preview so you cannot accidentally review the old server/build.
2. Run `npm ci` as needed, `npm run check`, `npm run build`, and the **entire** Playwright suite in Chromium and WebKit. Use a separate test port while the user's preview runs, for example `REMORSE_TEST_PORT=4175 npm run test:e2e`. Install supported browser binaries through normal Playwright tooling if absent. `--list` does not count as execution.
3. Fix real failures. If an old test assumes superseded behavior, establish the intended behavior and update it meaningfully. Do not delete/disable assertions to obtain green output. Preserve core, storage, session and rating coverage.
4. Have **6.1 Terra / high** operate the actual new browser build. Use ordinary 3D at normal zoom, not only fixtures/2D. Complete all nine lessons; examine the counter until Got it; check the old lesson 3/4 boundary and both completion paths. Check in-place RU/EN, saved progress, promotions and bonus turns.
5. Inspect die motion, surfaces, halos/targets, teaching zoom/material accent/counter frame, return to overview and flip. Play against AI and produce hotseat rolls for both sides. Repeat relevant scenes in low quality and reduced motion.
6. Check crowded game/tutorial layouts, promotion, result, help and tutorial-finish dialogs at target viewport sizes. Test a physical phone if available; distinguish hardware from emulation in the report.
7. Keep real screenshots, recordings, traces and generated QA output in ignored `.qa/`. Do not commit them or upload them as GitHub Actions artifacts. Use them to critique the actual result and record concise textual evidence tied to the revision.
8. After corrections, reload the updated preview and repeat affected scenarios. A review of an earlier build does not accept a later commit.

## Finish and deliver

Update `docs/BUILD_STATUS.md` and a revision-specific acceptance report with actual commands/results, browser/device/viewport details, reviewer model, remaining limitations and current revision. Keep previous reports identifiable as historical. Reconcile old document wording with the owner's latest feedback rather than restoring removed notices.

Commit/push logical changes to `decorum-guy/remorse-chess` without rewriting unrelated history. On an unchanged main, main is the delivery branch; handle concurrent work safely.

Leave a freshly built playable preview running on the Mac, normally `http://127.0.0.1:4173/`. Restart only this project's stale preview if needed. For a phone URL, verify the current Wi-Fi address/listener rather than copying an old address. Open the finished game in Chrome.

Final report: playable link first, concise changes, exact commit, actual acceptance results, and any unfulfilled requirement. Do not call the game accepted merely because it compiles or an earlier agent reported green tests. Complete everything possible without asking the owner to design, debug or choose routine implementation details.
