/** Pure policy/catalog imports for the external UI test runner.
 * This file is never imported by the game and has no state/transport access. */
export { chooseBotInput, chooseBotBlueprint } from '../src/bots';
export { PARTS, PRESETS, PRESET_NAMES, SLOT_NAMES, blueprintCost, blueprintEdits } from '../src/catalog';
export { getTrack } from '../src/tracks';
