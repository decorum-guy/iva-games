# REMORSE — current build status

## Active task: corrections after the owner's first playtest

The implemented baseline is `aa4aceb1023bfee0947fd5ce974bfe5d313039b8`. The previous Mac delivery report remains in [VALIDATION.md](VALIDATION.md); its results belong to that earlier version and are not acceptance of the current changes.

The owner wants the Mac executor to finish this iteration. Read [the complete execution brief](../prompts/FINISH_PLAYABILITY.md). The main executor uses Sol 6.2 / max. **Interactive visual acceptance must use a real, separate 6.1 Terra agent with high reasoning**, if the environment exposes that model. Verify actual availability and identity; never simulate or claim a Terra review that did not happen.

| Area | Implemented in this revision | Remaining acceptance |
|---|---|---|
| Tutorial | Concise RU/EN instructions, optional detail, current-action spotlight, no false legal targets/drag on read steps, restricted promotion/end-turn choices, preserved v1 checkpoints. | Execute the complete browser routes and manually check the lesson 3/4 boundary in 3D. |
| Inspection | Select the counter figure, read it, explicitly press Got it; authored focus targets and end-of-example focus. | Verify pacing, target visibility and return to overview on Mac and mobile sizes. |
| Legibility | Cooler/darker marble, stronger piece-state surfaces, clearer targets and badges, improved 2D contrast. | Inspect actual GPU output at normal zoom for both armies and all states. |
| Camera | Eased 850 ms flip and teaching close-up; temporary material emphasis; delayed counter frame. | Judge motion and fix clipping, obstruction or excessive bloom. |
| Die | Rounded 3D mesh, drop/tumble/settle, shared timestamp and sound timing, reveal gate for either side/AI, reduced-motion and WebGL fallbacks. | Run browser regressions; inspect the throw and reveal, including loading and cancellation. |
| Sound | Distinct generated cues, header mute, volume, gesture unlock, transient commit-only playback and cancellation. | Real Web Audio checks and listening where actually possible. Unit tests use mocked audio APIs. |
| Layout | Dynamic-viewport game surface, compact phone layout, short-landscape layout, bounded optional details. | Measure no document scroll and inspect essential controls at requested sizes. |
| Rules, Elo and saves | Core and rating formula unchanged; presentation state is transient and renderer-only. | Run existing game/storage/rating browser regressions. |

## Checks actually completed in the preparation environment

- `npm ci` completed on Node 24.22.3 / npm 11.19.1.
- Final `npm run check` passed: TypeScript, ESLint and **183 unit tests across 11 files**.
- `npm run build` passed. Vite still reports a large shared 3D chunk; no FPS/device-performance claim follows from this build.
- `npx playwright test --list` collected **46 tests across four files and two projects**. **Collection is not execution.**
- `git diff --check` passed.
- Actual browser inspection of the old local game at `http://127.0.0.1:4173/` confirmed poor white-piece contrast, a nearly invisible guilt surface, faint golden targets, preset-dice notices and document overflow. The observed old page was 949 px tall at a 390×844 viewport.

The new browser suite was **not executed here**: bundled browsers could not be downloaded (403), and installed Chromium cannot create its required socket in this environment. The Browser plugin could inspect the owner's old Mac preview after it was started, but the new checkout was not deployed there. New graphics, sound and layout are **implemented and awaiting Mac acceptance**, not declared visually finished.

## Next concrete action

On the Mac, fetch the latest repository without discarding local work, read `prompts/FINISH_PLAYABILITY.md`, build and run this revision, execute all browser tests, and have **6.1 Terra / high** perform interactive visual acceptance. Fix observed defects, repeat the affected checks, update this file with real results, push finished changes and leave a current playable preview running. Do not stop after reading this status or producing another plan.
