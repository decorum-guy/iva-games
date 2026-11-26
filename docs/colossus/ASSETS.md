# COLOSSUS assets

Created for the game on 26 November 2026. These are actual repository assets, not found-asset recommendations.

## Provenance and reproducibility

All geometry, vector paths and synthesis code are original work for Iva Games. No downloaded character, model, texture, artwork or sound recording is included. The generated content introduces no third-party asset attribution requirement. Three.js is used as the geometry/export tool under its existing dependency licence; dependency notices remain in the build.

- 9 GLBs: six stone/bronze army silhouettes and Regent, Spire, Archivist. Generator: games/chess/colossus/scripts/generate-colossus-models.mjs.
- 25 SVG engravings: each of sixteen player cards and nine boss cards has its own image. Generator: generate-colossus-cards.mjs.
- 9 mono 24 kHz WAV files: moves, stone/armour impacts, wound, ward, card, fire, victory and defeat. Generator: generate-colossus-audio.py.

The generators were executed successfully before product rendering. Each directory contains a manifest with SHA-256 hashes; GLB manifests also contain dimensions and triangle counts. One world unit is one board square. Model material names and meshes separate unit stone, inlay, armour and living core.

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

