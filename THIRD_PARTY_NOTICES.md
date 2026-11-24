# Third-party notices

## Game source

Remorse Chess is a chess variant by **Bardelo Bardalini** (`@bardelo_bardalini`). REMORSE is an independent digital adaptation based on the [rules transcript supplied by the project owner](docs/reference/transcript.md). The project’s [digital rulings](docs/RULES_DIGITAL_V1.md) specify interactions that the supplied rules leave open.

## Runtime assets

| Asset | Creator and source | License |
|---|---|---|
| Chess Set, glTF 1K | [Riley Queen / Poly Haven](https://polyhaven.com/a/chess_set) | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) |
| Studio Small 09, HDR 1K | [Sergej Majboroda / Poly Haven](https://polyhaven.com/a/studio_small_09) | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) |
| Cormorant Garamond | [Christian Thalmann / Cormorant project](https://github.com/CatharsisFonts/Cormorant) | [SIL OFL 1.1](public/assets/licenses/cormorant-garamond.txt) |
| Manrope | [Mikhail Sharanda / Manrope project](https://github.com/sharanda/manrope) | [SIL OFL 1.1](public/assets/licenses/manrope.txt) |

The shipped chess files, upstream paths and hashes are recorded in the [asset manifest](public/assets/chess/manifest.json). The application uses original 2D silhouettes, wordmark and die graphics.

## Recorded sound

| Source | Use in REMORSE | License |
|---|---|---|
| [Wooden dice on wodden table roll, take 4 — Wuzzy](https://opengameart.org/content/wooden-dice-on-wodden-table-roll) | First impact, rebounds, and settling contact | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Dice_Rolls_15cm.wav — andresix](https://freesound.org/people/andresix/sounds/347807/) | The brighter edge contact | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [chess_move_on_alabaster.wav — mh2o](https://freesound.org/people/mh2o/sounds/351518/) | Placement and the capture layer | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Ceramic clack / glass hit — SamsterBirdies](https://freesound.org/people/SamsterBirdies/sounds/745291/) | Surface fracture and short resonance | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The recordings were cut at individual transients, filtered, faded, and combined into a local mono PCM bank. [Source files, hashes and clip frames](public/assets/audio/manifest.json).

## Software

React, React DOM, Three.js, React Three Fiber and Drei are MIT-licensed. `idb` is ISC-licensed. Exact installed versions are pinned in [the lockfile](package-lock.json). The production build generates `dist/THIRD_PARTY_LICENSES.md` from the bundler’s dependency metadata. [The React Three Fiber license](public/assets/licenses/react-three-fiber.txt) is also included because the npm archive lists MIT without a standalone license text.

The stored [frontend-design guide](docs/reference/frontend-design/GUIDE.md) is from Anthropic and retains its [Apache 2.0 license](docs/reference/frontend-design/LICENSE.txt).
