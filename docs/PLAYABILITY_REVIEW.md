# Playability review and implementation handoff

## Evidence

This iteration is based on the owner's direct playtest feedback, source inspection at `aa4aceb1023bfee0947fd5ce974bfe5d313039b8`, a browser visit to that old local build, and the checks in [BUILD_STATUS.md](BUILD_STATUS.md). No uploaded image was needed for the code diagnosis. No new-version visual, physical-phone, audio-listening or FPS result is claimed.

The complete remaining job for the Mac executor is [FINISH_PLAYABILITY.md](../prompts/FINISH_PLAYABILITY.md). The owner explicitly requested a prompt for that executor and a **6.1 Terra / high** acceptance pass.

## Confirmed tutorial cause

At the end of lesson 3, `removal-material-only` is a read step, followed by `position-complete`. The core allows `h1 → g1`, but tutorial guidance allows no board command. The original UI advertised core-legal king moves and submitted them to a controller that correctly rejected them. The actual taught king move in lesson 4 is legal and cures both intended pieces.

The UI now distinguishes reading, selecting, moving and completing an example. Read/end steps do not expose move targets or dragging. Directed steps show directed targets; promotion and end-turn choices follow the current instruction. Stable IDs, order and saved indices remain compatible.

All 55 main instructions were shortened in both languages. Longer reasoning is optional. Preset-dice notices were removed from the roll card, lesson copy and history prefixes at the owner's explicit request. Deterministic tutorial rolls remain isolated from normal games.

## Attention, effects and camera

Reading frames the instruction and dims unrelated content; actions bring the board forward. Counter selection no longer immediately advances the lesson: the player reads and chooses Got it. Authored focus targets are validated against live positions. A surviving afflicted figure at the end of an example can also receive focus.

The camera approaches and returns over an eased 850 ms transition. Ordinary game moves do not invoke the teaching camera. Material receives one short colored emphasis, then the counter is enlarged/framed. Reduced motion uses static emphasis. Manual flips also use an eased 850 ms orbit.

The original warm board and broad fill light washed white-piece effects out. The new code cools/darkens marble, reduces uniform lighting, strengthens silhouettes and makes fractures larger/darker with colored cores. Badges and targets have stronger backing. Surface masks remain independent per figure. The artistic balance still needs normal-scale inspection on the Mac GPU for both colors, all states and both quality levels; framing calculations do not establish visual quality.

## Die and presentation ordering

The small CSS cube/card is supplemented by a central 3D reveal: rounded mesh, pips, local material, contact shadow, drop, decreasing bounces and tumble into the committed face. Both board modes and both colors use it. Ordinary play and tutorial share presentation code but keep separate rule providers.

Full motion is 1500 ms plus 350 ms result hold; reduced motion is 180 ms plus hold. Cabinet, graphics and audio share timing and presentation start. Late mounting catches up. AI waits for release. Undo/navigation cancel the reveal; restore/review do not throw again. Loading/WebGL fallbacks conceal the final face until settling.

A renderer-only projection delays new state surfaces while retaining moved geometry. The real result is already committed and remains authoritative for rules, saves, rating and search. Move/capture and revealed reaction events are disjoint, preventing repeated movement/capture ghosts. Both game and tutorial publication paths set presentation state before exposing the new position.

## Sound and layout

The old default was muted and playback depended on animated moves, missing some results and unlock races. The new module consumes transient committed events and supplies separate generated cues. Fresh profiles enable effects after a gesture; an existing stored mute is respected. Header mute and settings volume are visible. Undo, navigation, hidden tabs and mute cancel sounds. Delayed readiness skips expired contacts instead of restarting a die soundtrack.

Active play uses the dynamic viewport. Both player rows, board and current action are primary. Optional inspector/history are initially collapsed and scroll inside a bounded panel. Short landscape has a separate layout. These CSS changes require actual viewport checks; clipping a required control behind hidden overflow is not acceptable.

## Validation boundary

Final preparation checks: TypeScript, ESLint, production build, **183 unit tests** and diff check passed. The browser suite contains **46 collected cases**, including old-save recovery, full RU/EN routes, layout, sound preferences and real recorded dice for both sides. It still needs execution on the Mac.

The previous [VALIDATION.md](VALIDATION.md) remains historical evidence for the earlier delivery. Record future acceptance by revision and actual environment. Screenshots, recordings and traces stay in ignored `.qa/`, outside Git and GitHub Actions artifacts.
