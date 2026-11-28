# COLOSSUS assets

Created for the game on 26 November 2026; revised on 27 November 2026 for the complete-play review. These are actual repository assets, not found-asset recommendations.

## Provenance and reproducibility

All geometry, vector paths and synthesis code are original work for Iva Games. No downloaded character, model, texture, artwork or sound recording is included. The generated content introduces no third-party asset attribution requirement. Three.js is used as the geometry/export tool under its existing dependency licence; dependency notices remain in the build.

- 10 GLBs: six carved stone/brass army figures, Regent, Spire, Archivist, and the tutorial-only ashwood/brass Warden (`sentinel`). Generator: `games/chess/colossus/scripts/generate-colossus-models.mjs`. All geometry is authored in that reproducible source.
- 25 SVG engravings: each of sixteen player cards and nine boss cards has its own image. Generator: generate-colossus-cards.mjs.
- 17 mono 32 kHz WAV files: distinct move, capture, promotion tiers, boss responses, impacts, wards, card, fire and finale cues. Generator: `generate-colossus-audio.py`. The audio manifest records measured peaks, duration and SHA-256; the original synthesis source is included.
- Six comparison clips for armor hits and shield protection live in `src/audio-review/variants`. Generate them with `python3 -B games/chess/colossus/scripts/generate-audio-review-variants.py`. The comparison build bundles these clips on its own entry and plays them through the game mixer at the same gain as the original bank.

The generators were executed successfully before product rendering. Each directory contains a manifest with SHA-256 hashes; GLB manifests also contain dimensions, triangle counts and material mesh counts. Static geometry is merged by material to reduce rendering work, retaining separate stone, brass, armour, fractures, wood and emissive surfaces. One world unit is one board square. Model material names and meshes separate unit stone, inlay, armour and living core.

## Recreate

Run these from the repository root after npm ci:

    node games/chess/colossus/scripts/generate-colossus-models.mjs
    node games/chess/colossus/scripts/generate-colossus-cards.mjs
    python3 games/chess/colossus/scripts/generate-colossus-audio.py

All output is under games/chess/colossus/public/assets/colossus. Paths are owned by this game and do not replace existing REMORSE or OVERDRIVE assets.

## Card rarity

Rarity changes the complete background material, engraved pattern and frame: slate / lapis / amethyst / gold. A written rarity name and a distinct seal remain visible without colour perception. The crowned boss mark identifies ownership separately from rarity. Individual SVG illustrations are not used as the only signal of rarity.

## Evidence limit

Generation and asset structure are verified. User artistic approval and listening on the owner's device are separate acceptance steps. Browser visual observations are recorded in the implementation validation report when performed.


## Board and figure presentation — 27 November 2026

The six original SVG expedition figures and four boss engravings are in `src/ui/PieceIcon.tsx`. They are native vector paths with independent ivory/stone, brass, inset and core layers, not rasterized Unicode glyphs. The same artwork serves the board, roster, promotion choice and boss selection. `Board2D` places a boss using its registry width/height, and keeps independent moving piece sprites above a 64-cell keyboard-accessible grid. Parent-size measurement keeps the board square; rank/file labels sit outside the playing cells.

`Board3D` loads actual GLBs from `/assets/colossus/models/${boss.id}.glb`. An orthographic camera fits the arena volume to the available parent rectangle. Pieces and boss models have their own pointer handlers. HP, activation, shields, invulnerability, damage, promotions and armour loss follow committed core state/events. Loss of the WebGL context switches to the same playable `Board2D`; loading/renderer errors are also handled by the app boundary. The tutorial guide highlights exact core squares in both views. Reduced motion preserves information without the moving guide or movement/promotion pulses.

Executed asset checks for this revision: all **10 GLBs**, **350,304 bytes** combined; valid GLB 2 headers/lengths, SHA-256 matches, finite vertex coordinates, declared triangle counts, no referenced images/textures, and dimensions inspected. Models use 3–6 material meshes apiece after batching. Colossus TypeScript check passed. A CPU triangle contact sheet was generated directly from these GLB files and inspected under ignored `.qa/colossus-visuals`; it is an asset inspection, not a WebGL, frame-rate or target-device result. Browser observations are recorded by the owning review separately.

## Adding another boss's assets

1. Give the boss a stable ID and footprint in the core boss registry. Normal encounters use the exported normal roster; the Warden stays tutorial-only.
2. Add one geometry builder under `bosses` in `generate-colossus-models.mjs`. Keep one board cell equal to one model unit and keep the mesh within the declared footprint. Use `boss_armour`, `boss_heart` and `armour_fracture` material names for shared visual reactions; other materials may retain their own authored appearance.
3. Run the generator. It writes `<id>.glb` and updates the checked manifest with hashes, dimensions and material batches. `Board3D` needs no new boss-specific branch.
4. Add the corresponding native vector engraving to the single `bossGlyphs` registry in `PieceIcon.tsx`. `Board2D` gets the footprint from the core rather than hardcoded boss cases. A tall rectangular boss may use the board's stretched engraving; selection artwork keeps its natural aspect ratio.
5. Add card engravings/audio only when the new boss requires them, then verify file integrity and inspect the actual game in both views. Asset generation alone does not validate new rules or balance.
