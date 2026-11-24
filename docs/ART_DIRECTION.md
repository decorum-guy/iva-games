# Art direction and interaction

This document contains **design decisions for this implementation**, not claims from the original rules. Asset facts and download instructions are in `SOURCES_AND_ASSETS.md`.

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

Use a restrained, readable type system with Cyrillic support. A high-contrast serif can be used for the wordmark and large titles; use a clean sans serif for controls and explanations. Local bundled fonts or system fonts; preserve any font license. Avoid decorative small text, excessive letter spacing, gradient CTA clutter and dashboard-like metric cards.

## Scene and assets

- Start from the real Poly Haven marble chess set, with one-square world normalization, correct ground contact and per-instance identity. Use the original board geometry where appropriate; a custom slim plinth or square-overlay layer is acceptable.
- Light with local Studio Small 09 HDRI for reflections plus a small deliberate key/fill/rim setup. Do not show the studio panorama as the background.
- All six silhouettes must read at the default distance. Dark pieces need enough edge light to remain distinct from dark squares. Check white saturation and specular clipping.
- Default elevated camera around 50–60 degrees above the board, adjusted by real inspection. Keep all 64 squares visible. Offer a clean top view and a fixed tactical view. Orbit controls must not make selecting pieces unreliable; use a separate interaction or secondary drag.
- Pieces sit on squares, not partly sunk into the board or floating. Knight orientation must be deliberate. Shadows follow movement; no z-fighting legal-move decals.
- State rings and target highlights belong to the board surface. UI tooltips must be rendered legibly above the canvas and reposition within the viewport.
- Use a custom lightweight REMORSE favicon/wordmark. The product is not an official release by the original rules creator.

## Composition

At desktop sizes, reserve most of the first screen for the board. A narrow secondary area can show turn, selected piece, concise recent events and collapsible history. A compact header contains the wordmark, mode and settings. All routine game controls stay reachable without scrolling through a landing page.

On mobile, center the board and use a bottom information sheet that can collapse. Give the phone its own more top-down tactical camera when needed; it must remain possible to select pieces and target squares on both the near and far ranks confidently. Keep state badges, promotion choices, tutorial instructions and turn controls visible without hiding the required square. Fit 360 px width without horizontal scroll. Controls should generally provide at least a 44 px touch area. Use dynamic viewport sizing and safe-area insets. Preserve the game when rotating the phone. Do not constrain every possible short screen to zero vertical scroll if that makes the board or tutorial unusable.

The phone experience is a required first-class layout, not a smaller desktop screenshot or a mandatory switch to 2D. The 2D fallback should be attractive and fully playable, but six consistent SVG silhouettes and clear state marks are enough; a second elaborate effects/theme system is not required.

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
| Guilt | A restrained amber fracture/ring effect, icon and state explanation; the army material stays recognizable. |
| Devastation | Cooler desaturated finish, restrained collapsed-looking aura, visible 3/2/1 full-cycle countdown and progress detail. Do not deform a recognizable knight into an unreadable object. |
| Berserk | Brief hot pulse and slightly stronger trail; an unmistakable second-action indicator. No automatic second move. |
| Bloodlust | Dark red detail and capture-only icon; friendly capture targets visibly distinguished from enemy captures. |
| Absolution | A quiet halo from the bishop/king, clearing the afflicted surface and updating the state badge. |
| Shame | A readable connection/pulse on the affected target when the stage actually matures; a warning preview before the deadline. |
| Conversion | Material dissolves briefly, army color changes, piece reforms in place; its ownership and new movement direction are explained. |
| Self-removal | Quiet dissolution and an empty square; distinguish it from an enemy capture in the event log. |
| Promotion | Smooth transformation/reveal after a legible chooser; the chosen kind is shown before a capture roll is revealed. |
| Castling | King and rook animate coherently from one game command. |
| Check / game over | Clear king highlight and compact result presentation; no large effect obscuring the cause. |

All animation is an event-driven presentation of committed rules results. Rapid repeated taps, resize, board flip, tab suspension, new game and undo must not duplicate a move or resolve a die again. New game/undo cancels or snaps obsolete visuals safely. A tutorial can wait for a presentation event to finish explaining, but the core never waits for frame timing to determine a rule result.

## Tutorial integration

Use the same visual scene in tutorials. A spotlight/cutout and one anchored coachmark should lead the eye. Clearly highlight source and destination, animate a subtle directional cue, and let the player perform the actual action. A tutorial explanation must not cover the very square it asks the user to select.

Educational fixed dice show a small «Учебный бросок» label. State tooltips use both Russian names and brief functional explanations. The tutorial must remain comprehensible in 2D, on touch and with reduced motion.

## Audio

Start muted. If enabled, use restrained, locally generated Web Audio cues or licensed local audio: move contact, capture, dice, absolution and end of turn. Respect autoplay policies by creating/resuming audio after user interaction. Do not acquire background music or create an always-playing soundtrack for this version.

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
