# MakeHuman anatomical base (CC0)

Upstream: https://github.com/makehumancommunity/makehuman
Pinned revision: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`.

- `base.obj`: `makehuman/data/3dobjs/base.obj` at that revision.
- `default_weights.mhw`: `makehuman/data/rigs/default_weights.mhw`.
- `LICENSE.md` and `LICENSE.ASSETS.md`: unchanged upstream license files.

The OBJ header and weights explicitly identify these graphical assets as CC0.
No MakeHuman application source code is incorporated. `anatomical_glove.py`
extracts the left hand's continuous topology, mirrors it for the other hand,
remaps its three phalanges and weighted skin to the game's rig, fits a glove
surface, and adds original seams. The final glove therefore contains an
imported anatomical foundation; it must not be called wholly original or
reported as containing no imported mesh. The sleeve, tool, scene and textures
are separately authored project assets.
