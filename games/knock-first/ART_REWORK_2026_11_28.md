# 3D rework — work in progress, 28 November 2026

The owner rejected the earlier hands and empty, poorly readable industrial scene.
This candidate is not visually accepted and is not authorized for production.
The external operative design was separately liked by the owner and is retained.

The current priority is real-client clipping and animation continuity. The owner
also rejected synchronized up/down viewmodel walking and floating pipe badges.
Every visual audit must compare full frames with real game references, with
quality taking precedence over speed. Clay anatomy, grasp, and first-person
composition require review before calling the gloves finished.

## Reproducible tools and provenance

Blender 4.3.2 ARM64: `/Users/aartemida/Applications/Blender.app/Contents/MacOS/Blender`.
Official distribution: https://download.blender.org/release/Blender4.3/blender-4.3.2-macos-arm64.dmg
DMG SHA-256: `32297d20fae74683052267b9171945712c0aeb8a499d8e677e44740d3e30a034`.
Coordinator independently matched the official checksum, verified strict deep
codesigning, and ran a background bpy smoke test successfully.

The imported hand foundation is MakeHuman graphical data, pinned at
`a8bc2d54ff0ac92e78ff71431b1023eda42bf482`: `base.obj` and
`default_weights.mhw`. Both contain explicit CC0 notices. Local originals,
license files and source paths are in `assets-src/vendor/makehuman/`. This is
not a claim that the application code is CC0, nor that the resulting glove
contains no imported mesh. `anatomical_glove.py` retains continuous anatomical
geometry, maps the weighted fingers, and adds a glove surface and sewn panel.
`generate_models.py` supplies editable Blender construction, rig and clips;
`generate_surfaces.py` supplies original local textures. Sound is unchanged.

## Technical findings and current checks

- The previous knock clip reset the equipped wrist twist and opened the fingers.
  Its authored motion now begins and ends in the equipped grasp.
- The earlier CPU test only put the wrist joint on the handle. That could pass
  while the palm missed the bar. New PalmGrip frames test contact position and
  world orientation while preserving both arm segment lengths. The old
  operative solver remains available. Actual exported GLB tests pass across
  eight yaws, both battery sides and three floor offsets. These are CPU joint
  checks, not evidence that skin contact looks correct in the client.
- The camera stayed outside the authoritative wall (about 0.30 m clearance),
  while the viewmodel extended through it. Initial physical retraction poses were rejected because they hid the hands
  or enlarged them near the lens. The current free-hands renderer retains the
  authored screen projection and remaps only viewmodel depth near permitted
  walls/doors, with a restrained wrist response. This is explicit first-person
  compositing, not a claim of physical hand-to-wall IK. World projection/depth
  and gameplay visibility are retained; carrying uses ordinary world depth.
- A following bot can block direct retreat from the wall. A sideways escape
  succeeded in the live tutorial. No server collision changes were made here.
- Glove and panel UV names previously differed from the joined sleeve mesh.
  Their materials sampled an empty shared TEXCOORD_0, appearing flat despite
  authored textures. Unified UVMap fixes actual delivered material sampling.
- Mobile gameplay was cancelled by the owner during this review; desktop
  mouse/keyboard is the current target.
- Real local Chromium reports `ANGLE (Apple, ANGLE Metal Renderer: Apple M5,
  Unspecified Version)`. The measurement is queried from WebGL; a launch flag
  alone is not GPU proof. Physical phone performance is untested.
- Latest motion, carry, doorway, all-route, narrow-screen and low-quality
  visual acceptance remain open. No 60/30 FPS claim is made.

## Visual comparison sources

These are references for anatomy, composition, material response and grounded
architecture, not sources of copied product assets:

- Resident Evil Village, official guard pose:
  https://game.capcom.com/manual/village/en/ps5/page/14/6
  https://game.capcom.com/manual/village/locale/ps5/page/146_16_1.jpg
- Metro Exodus work glove and wrist equipment:
  https://www.gamesradar.com/metro-is-back-with-metro-exodus-and-the-wasteland-looks-more-horrifying-than-ever/
  https://cdn.mos.cms.futurecdn.net/zDzFWFxXENKkUEgkL2AA5A-1920-80.jpg
- Alien Isolation, physically supported signage and readable dark architecture:
  https://images.cgames.de/images/gsgp/287/alien-isolation-pc-screenshots-aus-der-test-version_2560691.jpg
- Amnesia: The Bunker, closed grasp and asymmetric hand work:
  https://www.hobbyconsolas.com/reviews/analisis-amnesia-bunker-nuevo-juego-terror-ps4-ps5-xbox-one-xbox-series-xs-pc-1255736
  https://imagenes.hobbyconsolas.com/files/image_1920_1080/uploads/imagenes/2023/06/05/6903a1c363a18.jpeg

Full QA images, videos, databases and editable inspection scenes stay in ignored
`.qa/art` and `.qa/knock-first/assets`. A fixture render is explicitly distinct
from the real authenticated room and its authoritative permitted PlayerView.

## First technical checkpoint (not final art acceptance)

Executed: portal TypeScript and scoped ESLint, portal production build, six
actual-GLB/prediction tests, and structural asset validation (35 models,
23 animation clips, 23 textures). The latter does not accept appearance.
The predictor now shares the static capsule sweep and respects only already
visible crew members, preventing repeated extrapolation into a stopped bot.

Real 1280×800/FOV65 Metal tutorial pass: idle, walk, stop, run, quiet walk,
wall approach, Q and turn. Evidence in ignored `.qa/art`:
`candidate-idle.png`, `candidate-wall.png`, `candidate-wall-q.png`,
`candidate-turn.png`, and `motion-candidate/page@f247c465747ee003f13f70424e99945e.webm`.
Before evidence is `motion-before-wall.png` and `motion-before-q0.png`.
The new pass uses a new real room and the same wall scenario; it is not a
pixel-aligned replay of the old room. The old UI banner is still visible;
Terra's separate UI changes are not yet integrated at this checkpoint.

The wall no longer cuts away both hands or enlarges them near the lens, and
Q retains its closed grasp. Remaining self-rejection: fingers wrapping the
right handle are less readable than the Amnesia reference; glove material and
sleeve construction still need art review. Carry/door contact and the full
route package remain unfinished. The source and evidence are published for
review and continued work, not as completed or accepted graphics.


## Hero contact revision after coordinator play

Owner corrections: remove all nonfunctional wrist boxes/needles and separate
black tabs; keep the continuous glove/sleeve base; avoid both a claw and a limp
left wrist; narrow the striker grip and show a real closed grasp; face the
working tool end forward and actually touch the pipe plate during Q.

The new striker grip is approximately 30–32 mm across instead of 48–56 mm
including the earlier large rings. Rings across the fingers are removed.
Each finger has separate MCP/PIP/DIP flex and slight spread fitted against the
actual skinned GLB surface. The CPU regression now checks weighted mesh
vertices around the handle, not just wrist/PalmGrip coordinates. It prevents
deep penetration and a detached grasp. Visual approval remains separate.

StrikeTip is on the working face and StrikeRear defines its normal. The actual
GLB face points forward throughout the authored knock. A permitted own
knock/resonator event starts an arm-chain contact gesture to the rendered
KnockPoint or an allowed wall. The solver preserves arm segment lengths and
retains the finger grasp. Its contact test covers surfaces at 0.3/0.6/0.9 m.
The resonator marker is on the plate face, not 9 mm in front of it. This is
client presentation of an event already received, not a new rules command.

Real-client evidence: `.qa/art/strike-contact.mp4`, `strike-contact-full.png`,
`strike-contact-sequence.png`, source video
`strike-client/page@cb6fb6d99151040394b1abb2d878b194.webm`. This was a real Q
advancing tutorial 03→04, with the integrated Terra interface. The sequence
shows the tool arriving at the plate and returning with its grasp maintained.
The later 8 mm anchor correction uses the model's actual named anchor.

Live door opening and taking the T battery were also exercised. The initial
`carry-paired.png` filename is misleading: its snapshot has only one holder,
so it is not evidence of paired carry. Old battery grip diameter/usable length
and two-hand target spacing still require correction and actual review. No
claim of completed carry/route acceptance is made at this checkpoint.
