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

## Optional audio audition candidates

The files in [public/assets/audio/auditions](public/assets/audio/auditions/README.md) are comparison candidates, not the selected runtime sound bank. The catalog records each source, source hash, output hash, license, editing recipe and timing. The four original comparison MP3 files are also included.

CC0 recordings are by qubodup (Energy Drain; 3 dark magic spells), lentikula (Basic Spell Impacts), Julie Damsgaard / Spring Spring / Spring Enterprises (Various Sound Effects), rubberduck (75 breaking / falling / hit SFX), pyranostudios (Air whoosh), and JaggedStone (Magic Spell SFX). The [candidate notices](public/assets/audio/auditions/README.md#источники-и-лицензии) contain their primary source links and the [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) reference.

R2 and parts of P2 include **Fantasy SFX Pack Vol 1 by JC Sounds**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Original source](https://opengameart.org/content/jc-sounds-fantasy-sfx-pack-vol-1). The original R2 audition changes are resampling to 48 kHz stereo, constant per-clip gain, comparison pauses and MP3 encoding, with the source clips uncut. Individual R2 candidates omit the comparison pauses and are encoded from the corresponding lossless windows. P2 changes include trimming, resampling, pitch/time changes on selected layers, filtering, fades, gain and layering with additional CC0 audio; individual P2 candidates add MP3 encoding from the existing scene WAVs. No selected production remix is implied by these audition edits.

The separate P1 fracture audition isolates the already existing CC0 stone layers with their original processing and shared scene gain, and removes only verified trailing digital silence. It must not be added again over the complete P1 queen mix.

Local comparison playback adds clip windows, gain and fades, including a 1.54-second R2 chant excerpt. The compare page links each recording to its author and license. [Playback edit and timing](docs/SFX_AUDITION.md#монтаж-для-сравнения)

## Selected showcase playback

The installed R2 devastation and chant, the P2 formation and queen, and the P1/P2 rook mix include recordings from **Fantasy SFX Pack Vol 1 by JC Sounds**, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Original pack](https://opengameart.org/content/jc-sounds-fantasy-sfx-pack-vol-1). Runtime edits include shortening selected reaction recordings, gain, fade envelopes, and synchronization to scene clocks. The rook adds contact-aligned P1/P2 mixing, a short stereo echo and room reverb, and MP3 re-encoding. The [audio manifest](public/assets/audio/manifest.json) records individual original filenames, hashes and CC0 contributors. [Installed choices and timing](docs/SHOWCASE_SFX.md)

Optional dice demos contain trimmed, level-matched transient excerpts of the public CC0 previews by [aunrea](https://freesound.org/people/aunrea/sounds/485950/), [schoman3](https://freesound.org/people/schoman3/sounds/506914/), and [WallyDM](https://freesound.org/people/WallyDM/sounds/815672/). [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

## Software

React, React DOM, Three.js, React Three Fiber and Drei are MIT-licensed. `idb` is ISC-licensed. Exact installed versions are pinned in [the lockfile](package-lock.json). The production build generates `dist/THIRD_PARTY_LICENSES.md` from the bundler’s dependency metadata. [The React Three Fiber license](public/assets/licenses/react-three-fiber.txt) is also included because the npm archive lists MIT without a standalone license text.

The stored [frontend-design guide](docs/reference/frontend-design/GUIDE.md) is from Anthropic and retains its [Apache 2.0 license](docs/reference/frontend-design/LICENSE.txt).
