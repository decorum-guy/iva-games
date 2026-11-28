# First-person scene — source and CPU audit

Recorded on 2026-11-28 against the uncommitted `feat/knock-first` worktree. The release journal must associate this report with the eventual commit. This report is based on the local specification, actual source files, exported GLB data and executed automated checks. It is not a browser playthrough or release acceptance.

## Implemented contracts

- `KnockScene` accepts only `PlayerView`, visual/audio preferences and callbacks. It does not read mission state. Actors, Listener, batteries, cues and echo clusters are drawn only from the participant's permitted view. Static geometry comes from the authoritative level definition.
- `onInput` remains **camera-local**: positive X is right, positive Z is forward; yaw zero faces world −Z. `KnockFirst` converts that vector into world space before network submission. Input is bounded and emitted at up to 30 Hz.
- Mouse capture is optional; dragging provides mouse look without capture. Touch sticks and look use the same input owner. Deactivation, blur, hidden document and capture loss clear movement, run/quiet modes and the held hand.
- High/low quality changes actual rendering cost: pixel ratio, shadow rendering, nearby lights and prop distance. Floors have the authoritative slopes; door panels have server state; collidable fixtures use the asset dimensions agreed with the core.
- Required actor or collidable model failure disables control and reports `unavailable`. Initial loading reports `restoring`, then `ready` only when loading finishes. WebGL loss immediately disables controls; restoration recompiles the scene, then the outer client reconnects for a fresh server view.
- Spatial sound uses authoritative virtual sources, quantized residual strength and occlusion/channel flags. It does not reconstruct hidden emitter coordinates. The same cue creates its directional caption while muted. Audio starts through a user gesture and has mono output, master gain, quiet mode, compression and limiting.

## Concrete defects and verified regression guards

| Finding | Change | Evidence in this audit |
| --- | --- | --- |
| Capture loss cleared keys but could leave touch movement/run held | Release the complete shared input state | Mock-DOM regression test |
| Required GLB failures could produce empty actors/fixtures | Gate readiness and stop controls on failure | Source inspection; browser failure injection still pending |
| A pending ambience decode could start a loop after the mission result | Cancel by phase, route and request generation before playback | Mock-Web-Audio regression, including immediate restart during the same pending decode |
| Replayed snapshots and stale initial cues require an explicit audio guard | Retain ID deduplication and treat a decreasing mission tick as a fresh view | Mock-Web-Audio regressions cover duplicate snapshots, initial stale cues and restart lifecycle |
| Some UI audio events used incompatible event spelling | Match the actual camel-case mission event names | Source contract inspection |
| Authored wrist attachment nodes initially sat at the origin | Asset generator corrected bone parenting; actual GLB attachments now match wrist joints | GLB matrix inspection; asset report contains the generator validation |
| Operative arms were too short to reach the level handles | Asset author extended the arm chain and baked a bent carry stance with floor-pinned ankles | Actual exported carry animation sampled by asset validator; renderer CPU tests use the resulting GLB |
| Camera-attached arms moved away from held handles when looking around | During carry, anchor arms to world/body orientation and preserve independent camera yaw/pitch | Source inspection and actual-GLB joint reach tests; visual browser inspection pending |
| Opposite holder used the same left/right crossbar order | Reverse grip ordering for the second handle | Both handle slots covered by actual-GLB tests |
| Uphill feet can be above the battery-centre floor, exceeding arm reach | Add visual pelvis/knee compensation, keep boots on their floors and lower first-person arm origin as needed | Both assets tested at −0.31, 0 and +0.31 m carrier-floor offsets |
| Procedural corrections could accumulate with constant STEP animation channels | Restore the preceding authored bone pose before the next mixer update | 120 repeated stance frames verify no pelvis or ankle drift |
| First-person knock animation was tied to keyboard input | Drive it from accepted local server knock/click/resonator events | Source inspection; touch playback still requires a browser |
| 3D labels could retain an old locale or omit a newly assigned assistant | Refresh name labels from the current permitted actor state and locale | Source inspection |
| Removed timer/battery resources were outside scene-only disposal | Dispose cached model resources and retired placeholder geometry too | Source inspection |

## Executed checks

All of the following completed successfully after the final source changes in this audit:

```text
npx tsc --noEmit --pretty false
npx eslint <the seven scene-owned source files and three client test files>
npx vitest run --project knock-first \
  games/knock-first/tests/client-controls.test.ts \
  games/knock-first/tests/client-audio.test.ts \
  games/knock-first/tests/client-rig.test.ts
```

The client regression run passed **13 tests in 3 files**. Six use EventTarget-based DOM doubles; four use Web Audio graph doubles. Three load actual GLB hierarchy/animation data and run the production IK on the CPU. The rig checks cover 96 complete combinations of asset, yaw, handle slot and height offset, checking both wrist targets to a tolerance below 5 mm and the operative ankle heights. The repeated-pose test checks 120 frames without accumulated drift. These are numerical transform tests; they do not render skinned vertices, compile GPU shaders or inspect an image.

The renderer contract for carry uses `left/right_upper_arm → forearm → hand`, `left/right_thigh → shin → foot`, and `pelvis`. Battery handles are at local X ±0.62 m, Y 0.32 m; carried battery origin is floor +0.33 m. Operative carry wrist targets on level ground are local `(±0.11, 0.65, −0.31)` m. First-person arm origin is 1.48 m above the lower of the carrier/battery floors, 0.03 m forward, with body-facing yaw and zero body pitch. Actual asset dimensions, PBR material references, animation names and source provenance are recorded in `public/knock-first/models/model-contract.json` and the asset manifest.

## Unperformed checks and acceptance limit

No real-browser mission, complete acceptance cycle, successful scene screenshot, physical-phone run or actual audio listening was performed by this scene agent. Earlier attempts to launch a local Playwright browser did not produce a browser frame. Subsequently the parent received an explicit browser-origin approval rejection and instructed all agents not to try another browser or surface; this agent respected that boundary.

Still required: both independent browser profiles; all mission routes and outcomes; actual shader/asset appearance, animation transitions and skinning; free-look/pointer-lock/touch behavior; short-screen layouts; measured rendering performance; WebGL loss/restore in a real browser; and actual spatial/stereo/quiet-mode listening. The unit tests above do not substitute for these checks or for the user's two full acceptance cycles. This report does not authorize release.

## Follow-up game UI source audit

The parent subsequently assigned `KnockFirst.tsx`, `copy.ts` and narrow HUD/return-panel CSS corrections to this agent. The following defects were established by reading the handlers together with the authoritative state transitions:

- Tutorial completion and skip both produce a finished outcome, so the former `completed && !result` completion panel could never appear. Its `tutorial/restart` command was also deliberately rejected by the core. Training results now distinguish completion from skipping, omit evacuation statistics, offer a guarded room rematch for repetition, and use the parent's dedicated mission-selection navigation callback.
- Clock formatting floored minutes separately from rounding seconds, so `839.966…` became `13:60`. `formatMissionTime` now rounds the total once, then splits it into minutes and seconds.
- Touch always said “Knock” while its handler could execute “Call”. Desktop and touch now share the label keyed by the authoritative `knockKind`.
- Carrying UI did not read the authoritative battery obstruction. It now shows opposed effort, mismatched effort or obstruction, plus a free far handle or the named second holder.
- Readiness confirmation previously appeared only while controls were captured. It now lives in the unlocked return panel, uses server readiness for its disabled/confirmed state and has no optimistic local ready flag. The active preparation panel is informational. Tutorial sound/caption confirmation likewise uses the unlocked lesson-start action.
- A modal left open when the outcome arrived could remain above the result. Finishing now closes that modal.
- HUD controls now stack above the touch look surface. The return panel has a bounded height and scrolls on a short screen; these CSS changes have not been visually accepted in a browser.

The follow-up completed full TypeScript checking, ESLint for the changed TypeScript files, and **8 focused countdown boundary tests** in `client-copy.test.ts`. No additional browser cycle, real click-through, listening session or physical-device run was performed. Lobby-only findings were reported to the parent for their separate changes; this agent did not edit `Lobby.tsx` or the application navigation file.
