# Art direction and interaction

This document contains **design decisions for this implementation**, not claims from the original rules. Asset facts and download instructions are in `SOURCES_AND_ASSETS.md`. Capture-row semantics and the material badge follow `CAPTURED_PIECES_AND_MATERIAL.md`; the ten difficulty profiles and local rating follow `RATING_AND_DIFFICULTY.md`. Complete first-release Russian/English support follows `LOCALIZATION.md`; Russian examples here have equivalent English copy.

## Supplementary design workflow

Read the checked-in [frontend-design guide](reference/frontend-design/GUIDE.md), copied from Anthropic's official skill with its license. Apply its brief review, typography/composition discipline and screenshot-based self-critique to this project. This reference is explicitly read during the build; no installed plugin or Mac configuration is implied.

The established Remorse direction below governs choices. Start with the existing palette, a small Cyrillic/Latin type system, and an actual playable board as the main composition. Use the real game content. Review a compact implementation plan against the brief, then build; do not spend the run generating several competing concepts or waiting for aesthetic approval. Keep source tutorial/UI strings in both locales. The guide's generic subject-discovery scenario does not apply because this product is already specified.

After the game works, inspect real laptop/phone screenshots and actual motion. Fix concrete issues in hierarchy, board scale, spacing, typography, material readability and target accessibility. The guide does not implement shaders, supply models or prove performance; the detailed 3D requirements and acceptance checks remain mandatory.

## Visual identity

REMORSE should look like a carefully lit physical chess set with supernatural consequences visible on the pieces. Use an obsidian/dark-marble and ivory/porcelain palette, restrained warm-metal accents, soft studio reflections, and a quiet dark background. The board is the main subject. The visual character should remain recognizable with all effects turned off.

Starting tokens, to tune by looking at the actual scene:

| Role | Starting value |
|---|---|
| App background | `#0D1014` |
| Raised UI surface | `#181D23` |
| Primary text | `#F0EAE0` |
| Secondary text | `#A6ADB5` |
| Warm accent | `#C9AC75` |
| Guilt | `#DAAD62` + broken-ring icon |
| Devastation | `#7796BE` + countdown segments |
| Berserk | `#E67D55` + double-action icon |
| Bloodlust | `#C84D60` + capture-only icon |
| Absolution | `#C9E2D3` + expanding thin halo |

These are art-direction starting points, not a guarantee of sufficient contrast. Adjust to preserve text, legal-target and check visibility. Do not make every panel glassy or cover the board with persistent neon. State color must not obscure army color: use the base, outline, small surface details, icon and explanatory text.

Use a restrained, readable type system with complete Cyrillic and Latin support, including «ё», punctuation and the numeric symbols used by the HUD. A high-contrast serif can be used for the wordmark and large titles; use a clean sans serif for controls and explanations. Local bundled fonts or system fonts; preserve any font license. Avoid decorative small text, excessive letter spacing, gradient CTA clutter and dashboard-like metric cards. Missing glyphs, broken Russian encoding and font-loading layout jumps are defects.

## Scene and assets

- A real, fully three-dimensional board and real three-dimensional pieces are the default experience on both laptop and phone. Perspective, silhouettes, light and surface reflections must respond to the scene; a rendered background, flat cutouts or decorative 3D beside a separate playable board do not meet this requirement.
- Start from the real Poly Haven marble chess set, with one-square world normalization, correct ground contact and per-instance identity. Use the original board geometry where appropriate; a custom slim plinth or square-overlay layer is acceptable.
- Light with local Studio Small 09 HDRI for reflections plus a small deliberate key/fill/rim setup. Do not show the studio panorama as the background.
- All six silhouettes must read at the default distance. Dark pieces need enough edge light to remain distinct from dark squares. Check white saturation and specular clipping.
- Default elevated camera around 50–60 degrees above the board, adjusted by real inspection. Keep all 64 squares visible. Offer a clean top view and a fixed tactical view. Orbit controls must not make selecting pieces unreliable; use a separate interaction or secondary drag.
- Pieces sit on squares, not partly sunk into the board or floating. Knight orientation must be deliberate. Shadows follow movement; no z-fighting legal-move decals.
- State rings and target highlights belong to the board surface. UI tooltips must be rendered legibly above the canvas and reposition within the viewport.
- Use a custom lightweight REMORSE favicon/wordmark. The product is not an official release by the original rules creator.

## Effects on the pieces themselves

Guilt, devastation, berserk and bloodlust must visibly affect the **surface of the actual three-dimensional piece**. Use restrained material-aware cracks or veins, local roughness changes, fine emissive details and short surface transitions. A ring under the piece, a colored outline or an icon alone does not satisfy the requested effect quality. Rings and icons remain useful as secondary information.

Extend the imported PBR appearance instead of replacing it with flat unlit color. Preserve the normal maps, useful marble/porcelain detail, contact lighting and recognizable shape. Keep white and black ownership immediately readable in every state; state color occupies controlled details rather than repainting the entire army. Tune the effects at the normal playing distance, not only in a close-up.

Bind surface masks to the figure's UVs or object-space coordinates so cracks and veins stay attached when the piece moves, rotates or converts. Give each figure independently controlled material parameters; reuse geometry and immutable textures, but never mutate a shared material or shared uniform object in a way that recolors another figure. Do not create materials or compile new shader variants on every animation frame.

The appearance at rest should be a deliberate, mostly static material treatment. Brief pulses accompany committed events; continuous flashing, orbiting particles and breathing effects are not necessary to communicate a state. Reduced motion keeps a legible static surface treatment and replaces moving sweeps/dissolves with short restrained transitions. A lower phone quality setting may simplify shader detail, particles, bloom and shadows, but must retain a visible material distinction for each state, plus its icon and explanation.

## Composition

At desktop sizes, reserve most of the first screen for the board. A narrow secondary area can show turn, selected piece, concise recent events and collapsible history. A compact header contains the wordmark, mode and settings. All routine game controls stay reachable without scrolling through a landing page.

On mobile, center the board and use a bottom information sheet that can collapse. Give the phone its own more top-down tactical camera when needed; it must remain possible to select pieces and target squares on both the near and far ranks confidently. Keep state badges, promotion choices, tutorial instructions and turn controls visible without hiding the required square. Fit 360 px width without horizontal scroll. Controls should generally provide at least a 44 px touch area. Use dynamic viewport sizing and safe-area insets. Preserve the game when rotating the phone. The owner's playtest correction requires no document scrolling during a game or tutorial. Use a separate short-landscape layout and bounded internal scrolling for optional details; essential play must stay within the viewport.

The phone experience is a required first-class layout, not a smaller desktop screenshot or a mandatory switch to 2D. The 2D fallback should be attractive and fully playable, but six consistent SVG silhouettes and clear state marks are enough; a second elaborate effects/theme system is not required.

### Language controls and text layout

Provide a compact, explicit **«Рус / EN»** selector on the home screen and in settings reachable during play and learning. Russian is the fresh-profile default; an explicit choice persists locally. The switch changes presentation immediately without resetting the board, scene/camera, history, selection, pending worker, die result or tutorial step. Keep it in the compact header/settings structure rather than adding another game panel.

All HUD, rules, tutorial, captured-row, material, rating, result, error and accessibility text is complete in both languages. Nicknames, the wordmark, coordinates and canonical notation are stable. Let translated controls and explanations wrap naturally or grow within their panel; do not solve longer text by making it tiny or hiding the required action. Reposition coachmarks after a switch and verify both languages at the phone widths. Use the shared glossary in `LOCALIZATION.md` for badges and explanations instead of inconsistent terms.

### Player identities, captured pieces and numbers

Each player's nickname/side has a compact identity block adjacent to that player's end of the board. Put the captured enemy-piece icons **directly under that nickname on both laptop and phone**, with a positive `+N` material badge beside the row only for the side ahead. Keep both rows visible during play, including learning. Board flip moves the identity blocks without exchanging their owners or histories.

Reserve the row's height before the first capture so the board does not jump. Use consistent small SVG silhouettes and compact repeated-type groups when necessary at 360 px width. A group-level hover target on desktop or tap target on phone opens the breakdown; every tiny icon need not be a separate button. The row updates from committed state as ordinary static HUD. Do not add a flying-trophy animation, trophy cabinet or another panel for this request.

Apply the exact ledger and score rules in `CAPTURED_PIECES_AND_MATERIAL.md`: a conversion, self-removal or friendly bloodlust capture is not an enemy trophy, and `+N` comes from current material rather than summing the visible icons. Show no `+0` or negative counterpart. Its hover/tap explanation is «Условный баланс фигур на доске. Не учитывает состояния и позицию».

Place the player's explicitly labeled Remorse Elo and the bot's compact level/approximate-rating label with their identity, separately from the material row. Use one concise selector for the ten bot profiles in game setup, for example «Уровень 4/10 · ≈1000 Elo Remorse», plus a clear Rated/Practice choice. Do not place ten difficulty buttons, a rating dashboard or a second material meter around the board. Keep provisional bot-scale wording and local-profile details in their relevant setup/profile explanation as specified in `RATING_AND_DIFFICULTY.md`. `+N` material is not Elo or the engine's evaluation.

The game must communicate:

1. Whose decision it is, including a pending berserk action.
2. Which piece is selected and why it can or cannot act.
3. Where it may move or capture, distinguishing friendly captures.
4. What just happened and what a timer means.

Do not show internal reducer phases, request IDs, rules implementation vocabulary or performance diagnostics in normal player flows. Those belong in a local developer view/report.

## Motion specification

Durations below are **design targets**. Tune for clarity and responsiveness, not an unmeasured performance claim.

| Event | Required visual behavior |
|---|---|
| Quiet move | Approximately 220–380 ms; slight lift, smooth acceleration/deceleration and firm landing. Longer moves may be slightly longer, with a sensible cap. |
| Movement trail | Short translucent ribbon or 2–4 sparse ghost silhouettes, fading within roughly 150–300 ms after arrival. It follows the actual motion path and reflects the piece/state subtly. |
| Knight | Clear elevated arc over intervening pieces, with restrained orientation change; logical movement remains the L-shaped chess displacement. |
| Capture | Short contact emphasis, controlled dissolution/fragments/light residue of the captured piece, then clear destination occupancy. No persistent debris or shaking camera on each move. |
| Reaction die | An actual 3D d6 reveal with legible final face and matching text. It displays the committed outcome. Normal reveal target 450–700 ms; fast/reduced-motion mode is much shorter. |
| Guilt | Sparse fine amber cracks/veins appear within the piece's surface in a short reveal, then settle into a restrained static treatment. Keep an icon and explanation; the army material stays recognizable. |
| Devastation | A cooler, more matte surface with muted fractures and a restrained base aura; visible 3/2/1 full-cycle countdown and progress detail. Preserve silhouette and both army colors rather than making the piece uniformly gray or deforming it. |
| Berserk | Fine ember-like veins across the piece, a brief hot surface impulse after capture and a slightly stronger movement trail; an unmistakable second-action indicator. No automatic second move or endless flashing. |
| Bloodlust | Deeper crimson surface veins, briefly intensified by an action, plus a capture-only icon. Distinguish friendly capture targets visibly from enemy captures. |
| Absolution | A restrained light sweep travels over the actual piece, closes its afflicted surface details and restores the normal material. A quiet bishop/king halo can support the effect; update the state badge coherently. |
| Shame | A readable connection/pulse on the affected target when the stage actually matures; a warning preview before the deadline. |
| Conversion | A short surface mask/dissolve changes the actual piece's army material and clears its old affliction details; it reforms in place without changing logical square or identity. Explain ownership and new movement direction. |
| Self-removal | Quiet dissolution and an empty square; distinguish it from an enemy capture in the event log. |
| Promotion | Smooth transformation/reveal after a legible chooser; the chosen kind is shown before a capture roll is revealed. |
| Castling | King and rook animate coherently from one game command. |
| Check / checkmate | A short surface impulse for check and a complete scene for mate, with a readable king, directed fragments, sound, and return to the board. [Staging brief](../prompts/IMPLEMENT_CHECK_AND_MATE.md) |

All animation is an event-driven presentation of committed rules results. Rapid repeated taps, resize, board flip, tab suspension, new game and undo must not duplicate a move or resolve a die again. New game/undo cancels or snaps obsolete visuals safely. A tutorial can wait for a presentation event to finish explaining, but the core never waits for frame timing to determine a rule result.

## Tutorial integration

Use the same visual scene in tutorials. A spotlight/cutout and one anchored coachmark should lead the eye. Clearly highlight source and destination, animate a subtle directional cue, and let the player perform the actual action. A tutorial explanation must not cover the very square it asks the user to select.

Do not display preset-dice notices or a special tutorial-roll label. Show the face and its consequence, using the same visible 3D throw for a human, the bot and either hotseat player. The cube drops, bounces, tumbles and settles on the already committed face; reveal the figure's new surface effect after it settles. Use a shared presentation start and timing for motion, sound and the next-turn gate. A restored result is static, never another throw.

State tooltips use the shared localized names and brief functional explanations. The complete tutorial must remain comprehensible in both languages, in 2D, on touch and with reduced motion. One concise instruction and one current action are primary. Dim unrelated content and frame the current instruction; show an unmistakable source/target when a move is requested. Inspection steps may smoothly bring the camera closer to the figure, briefly strengthen its actual material effect, then emphasize the counter. Keep the counter readable until explicit acknowledgement and return smoothly to the whole board. Manual flips use one eased orbit at a constant stand-off. The board can extend past the widget edge during the turn. Reduced motion keeps clear static emphasis without camera travel or repeated pulsing. Switching language must not replay camera or game events.

## Audio

Fresh profiles enable effects after the first genuine user gesture. Preserve an explicitly stored mute, show a direct header mute control and a volume slider. Use the recorded [local CC0 sound bank](../public/assets/audio/manifest.json) for contact, capture, dice, states, healing, promotion, check and results. Bounce sounds use the same contact times as the rendered die. A committed action owns the audio output until the next action and has at most one expressive accent. Respect autoplay policies; never replay old sounds after restore, undo, review or a delayed gesture. Do not acquire background music or create an always-playing soundtrack for this version.

## Performance and reliability

- Use WebGL with stable Three/R3F dependencies. Do not require WebGPU, SharedArrayBuffer, special server headers or a proprietary API.
- Start with 1K textures and 1K HDRI. Increase only where a visible improvement justifies it. A 4K display does not require every texture to be 4K.
- Target approximately 60 FPS on the actual available Mac in a normal desktop scene, and usable mobile performance. Measure before reporting. Record hardware/browser/resolution/quality and whether rendering was hardware accelerated.
- Initial budget: eager game assets roughly 12 MB or less when practical; source glTF package plus HDRI is already approximately 8.6 MB by upstream sizes. Runtime JavaScript is additional. Do not turn a rough budget into a false guarantee.
- Reuse geometries, avoid materials/textures per-frame, bound particle pools, keep shadow maps and postprocessing modest, and avoid React state updates on each animation frame.
- Use adaptive DPR/quality presets. Reduce reflections, postprocessing, particle count and shadows first; preserve readable pieces and move targets.
- Suspend unnecessary rendering in a hidden tab; do not advance game timers by real time. A quiet idle board should not burn the GPU continuously for no visible reason.
- Recover gracefully from WebGL context loss, asset fetch failure, missing HDRI and worker errors. Keep a working 2D path.

## Mandatory visual review

Inspect the actual browser at all acceptance sizes. Make moves and watch the trail; a static screenshot cannot demonstrate motion. Review all state effects with deterministic local scenarios. Check board orientation, overlays, touch targeting, tutorial coachmarks, promoted models and converted materials. Improve at least the concrete defects you observe before delivery; do not write an invented aesthetic score.

Required focused inspections:

- Place two figures of the same kind and army next to each other in different states. Change one state, move that figure and adjust the camera. Its surface effect must remain attached, its neighbor must remain unchanged, and the material must respond as a three-dimensional object. Repeat for white and black pieces and inspect all four afflictions plus healing/conversion.
- Repeat state readability at normal laptop and phone playing scale, on lower phone quality and with reduced motion. Low quality must retain the on-piece state treatment; reduced motion must not erase the meaning of a state. After the transition settles, an idle scene should not require constant animation solely to keep its state visible.
- At **360×800**, inspect a crowded real gameplay/tutorial state containing both nicknames with captured-piece rows, a positive material badge, compact rating/level labels, a selected afflicted figure with its needed counter, one coachmark and the bonus-turn control. Both source and destination squares and the required action remain accessible. Collapse secondary details or adjust the phone camera/sheet instead of hiding either player row or forcing the player into 2D.
- Verify the capture rows and their hover/tap explanations after board flip, resize and phone rotation. Reserve stable layout space; no new capture-row animation or panel may obstruct play. Confirm visually that the material `+N` and labeled Elo are clearly different information.
- Repeat the crowded phone scene, promotion chooser, result card and tutorial finish actions in Russian and English. Switch language in place and inspect text wrapping, glyphs, focus, coachmark placement and unchanged board/camera/targets; no raw message key or untranslated fallback may remain. Previously recorded event history must display in the selected language without changing its facts.
