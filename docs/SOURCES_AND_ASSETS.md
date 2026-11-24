# Sources, assets and provenance

Prepared 2026-11-24 (Europe/Moscow). This file distinguishes uploaded evidence, direct observations, technical inferences and implementation decisions. It is not an assertion that the game already exists.

## 1. Rules source and attribution

**Direct user input:** the owner supplied `remorse-chess_-official-rules.pdf`, and stated that the idea's creator permits others to digitalize it. That permission statement comes from the owner; the uploaded transcript itself does not contain it.

The supplied original and a verbatim extraction are in `docs/reference/`. SHA-256 of the PDF:

```text
aea94a4eb3b7ea603ab726e7705e745c1a52e113ff499448360b2b1c9b59422d
```

Read the transcript as the primary source for this version. Web pages describing older Remorse rules differ from it and must not overwrite the supplied d6 table or exceptions.

**Attribution discovery:** indexed listings identify Bardelo Bardalini, `@bardelo_bardalini`, with the exact video title “Remorse Chess: Official Rules”. The inspected listing is [here](https://urlebird.com/video/remorse-chess-official-rules-7711097926713363743/), and an announcement listing is [here](https://urlebird.com/video/remorse-chess-announcement-7711153081991400735/). These are secondary metadata, not an independently heard permission statement.

Candidate primary video references derived from those listed IDs:

- `https://www.tiktok.com/@bardelo_bardalini/video/7711097926713363743`
- `https://www.tiktok.com/@bardelo_bardalini/video/7711153081991400735`

The primary TikTok pages could not be retrieved by the research browser. Do not say they were watched or quote an announcement that was not heard. Give clear creator credit in the application/README, distinguish this independent digital implementation and its rule interpretations, and do not claim official endorsement. Do not relicense the creator's rules as CC0/MIT based on the unrelated asset licenses. This is recorded provenance, not a new question for the sleeping user or a blocker to the authorized implementation.

## 2. Primary 3D model

[Chess Set — Riley Queen, Poly Haven](https://polyhaven.com/a/chess_set), [asset license](https://polyhaven.com/license).

The source page labels the model CC0 and offers glTF, Blender and FBX with several texture resolutions. Use the **1K glTF package** initially. Preserve credit even though CC0 assets do not require attribution. Website preview renders are a separate category; render our own game scene instead of using them as app artwork.

Primary machine-readable inventory:

```text
https://api.polyhaven.com/files/chess_set
```

Request with a recognizable custom User-Agent, e.g. `RemorseChessAssetDownloader/1.0`. The [official API guidance](https://polyhaven.com/our-api) and [terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md) describe this requirement. Download during setup and serve game assets locally; the live game does not need the Poly Haven API.

Select:

```text
files["gltf"]["1k"]["gltf"]
```

This object contains `url`, `size`, `md5` and `include`, a mapping from relative dependency path to metadata/URL. Fetch the main file and every dependency, preserving relative paths. Never guess dependency paths by replacing `8k` with `1k`; the geometry binary uses an `8k` directory even for the valid 1K package.

Verified main file:

```text
https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/chess_set/chess_set_1k.gltf
```

**Directly fetched and parsed during preparation:** 53,740 bytes; 33 named scene nodes, comprising the board and 32 figures; its MD5 matched the API. SHA-256 of that fetched JSON:

```text
3e21ecd0c2ffb703dfdb3f3ea7a379c1dbd4ec513ba2cb8e6cb1e5f276d7eb91
```

The complete package is **6,983,829 bytes by summed API metadata**, with nine JPG dependencies and one binary. The full package was not rendered during preparation; implementation must download/verify dependencies and inspect the model in the game.

Useful names observed in the glTF:

```text
board
piece_king_white
piece_queen_white
piece_bishop_white_01
piece_knight_white_01
piece_rook_white_01
piece_pawn_white_01
piece_king_black
piece_queen_black
piece_bishop_black_01
piece_knight_black_01
piece_rook_black_01
piece_pawn_black_01
```

Paired pieces have `_01`/`_02`; pawns extend through `_08`. Material names are `chess_set_pieces_white`, `chess_set_pieces_black` and `chess_set_board`.

### Practical import

1. Use `GLTFLoader`/R3F loading once, build a catalog by name, and instantiate geometry according to the rules state. Do not treat the imported starting-position transforms as authoritative game state.
2. Normalize a logical square to one world unit. Node translations suggest source square spacing about `0.05788808` meters and board top around `y = 0.017392585`; these are initial estimates, **not a tested integration guarantee**.
3. Use `Box3`/bounds to center each base on the square and seat it on the board. Some geometry bases are slightly below local zero; blindly trusting origin produces errors.
4. Verify knight facing. Black-source knight vertices already embody a different orientation; do not automatically double-rotate them.
5. Reuse geometry but do not share a mutable animated material across figures that can independently change state/owner. Keep UVs and normal maps intact.
6. Serve dependencies from the app's own asset path. Test the production base path, not just Vite dev. Optional GLB packing/texture optimization is useful only if it improves delivery without consuming the implementation effort.
7. Save an actual asset manifest with source URLs, author, license, file sizes and hashes. Include applicable license notices. Blender is not required for this import path.

## 3. Studio lighting

[Studio Small 09 — Sergej Majboroda, Poly Haven](https://polyhaven.com/a/studio_small_09), CC0.

API: `https://api.polyhaven.com/files/studio_small_09`, entry `hdri.1k.hdr`.

Verified URL and size **from directly retrieved API metadata**:

```text
https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr
1,615,248 bytes
MD5 d5d7eb9d26d341d6aa4d11c1a54fd97c
```

The HDR binary was not rendered during preparation. Use for reflections/environment lighting with a separate dark background. If unavailable, a local `RoomEnvironment` or deliberate light setup must preserve an attractive playable scene.

## 4. Reserve model source

If the primary source remains inaccessible after a reasonable retry, use [Free Game Assets — Stylized Casual Chess Set](https://www.freegameassets.com/stylized-casual-3d-models/stylized-casual-chess-set).

Its source page labels the package CC0-1.0 and supplies separate GLB figures, a board and a complete setup. The package was actually downloaded and its manifest/archive license inspected during preparation; it was not rendered in this app.

Exact inspected ZIP URL:

```text
https://media.freegameassets.com/models/stylized-casual-3d/v1/stylized-casual-chess-kit/ce89aade643ec6bcfcf5cf28eb2a9514fb54326f1001b47532d79538fe3d9767/kit-710cef1cf0b9f54f7cc06f4639ac7e4368562ca490efb3b2c52d6b0d87b1e910.zip?download=stylized-casual-chess-set.zip
```

Observed archive size: 210,648 bytes. Contains `glb/{bishop,king,knight,pawn,queen,rook}-{blue,orange}.glb`, `glb/board.glb`, `glb/starting-position.glb`, `README.md`, `LICENSE.txt` and `manifest.json`. License text identifies CC0 1.0 Universal. The package's own README describes base-centered Y-up origins and a 0.05 m cell; verify in scene.

Replace its blue/orange material/vertex-color presentation with the agreed ivory/obsidian direction. This is a practical fallback, not a reason to abandon visual polish or use primitive stand-ins. Avoid downloading additional huge asset packs once this requirement is met.

## 5. Technical references and licenses

| Source | What it supports / how to use it |
|---|---|
| [chess.js](https://github.com/jhlywa/chess.js), [license](https://github.com/jhlywa/chess.js/blob/master/LICENSE) | Orthodox rules library, not AI; BSD-2-Clause. Optional development reference only. Preserve notices if code is actually reused. |
| [Fairy-Stockfish custom variants](https://fairy-stockfish.github.io/custom-variants/) and [configuration](https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish/master/src/variants.ini) | Variant configuration exists. Suitability for the whole Remorse ruleset is not established; choosing a custom engine is our engineering inference. Source declares GPL-3.0-or-later; no import is required for the proposed approach. |
| [React Three Fiber introduction](https://r3f.docs.pmnd.rs/getting-started/introduction) | React/R3F major compatibility and declarative Three rendering. Use current stable compatible versions. |
| [Vite features](https://vite.dev/guide/features.html), [workers](https://vite.dev/guide/features.html#web-workers) | Worker bundling and separate TypeScript checking. |
| [Three.js documentation](https://threejs.org/docs/) | Actual loader, material, lighting, geometry, raycasting and lifecycle APIs; use versions matching installed packages. |
| [Chess.com captured-pieces help](https://support.chess.com/en/articles/8708638-how-can-i-see-the-captured-pieces-and-material-count) | The requested captured icons sit under usernames; only the side with more remaining material shows a positive number. Remorse-specific event handling is our explicit product decision. |
| [Chess.com piece values](https://www.chess.com/terms/chess-piece-value) | Conventional P=1, N=3, B=3, R=5, Q=9 for the HUD material count; not a calibrated evaluation of Remorse states. |
| [The US Chess Rating System — Mark Glickman and Thomas Doan](https://www.glicko.net/ratings/rating.system.pdf), 2026-04-06, printed pp. 10–11 | Primary support for logistic expected score and the Elo update principle. K=32, starting value 1000, floor 100, eligibility rules and provisional bot anchors are this project's choices; the full US Chess system is not implemented. |

Track only **actually used** dependencies/assets in `THIRD_PARTY_NOTICES.md`. Do not label every internet asset “free” without its license or claim an unused engine is integrated. Documentation and libraries can change; verify package compatibility during implementation and preserve the lockfile that was actually tested.

## 6. Supplementary frontend-design guidance

The owner asked whether a design skill would help. Our recommendation is to apply the official [Anthropic frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design) as a focused supplement to the established Remorse brief. This is a judgment about fit, not measured evidence that a skill guarantees visual quality.

The full text and neighboring Apache-2.0 license were retrieved and inspected. A byte-preserving reference copy is stored as `docs/reference/frontend-design/GUIDE.md`, with the original `LICENSE.txt` beside it. Only the filename changes from upstream `SKILL.md`; its contents are unmodified. Source revision, the latest commit affecting that directory at retrieval:

```text
41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f
```

- [Pinned source text](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md).
- [Pinned license](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/LICENSE.txt).

The inspected skill directory contains the guidance and license, with no executable installer. The build prompt explicitly directs Codex to read the reference. This preparation does **not** install a personal/global skill, plugin or MCP on the owner's Mac, and no such installation is needed to read its instructions for this run. Preserve the source/license attribution when distributing the copied reference.

[OpenAI's current skill documentation](https://learn.chatgpt.com/docs/build-skills) describes skills as instructions with optional resources, explicit or implicit activation, and project discovery in `.agents/skills`. A formal reusable installation can use that supported project scope later; it is unnecessary for the already explicit reference workflow. The guide's generic client narrative is not evidence about this owner. Project requirements control any conflicting style recommendation or request for client input.
