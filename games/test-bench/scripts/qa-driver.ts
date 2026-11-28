/** Pure policy/catalog imports for the external UI test runner.
 * This file is never imported by the game and has no state/transport access. */
import { chooseBotInput } from '../src/bots';
import { PARTS } from '../src/catalog';
import type { LaneSnapshot, TrackDefinition } from '../src/types';

export { chooseBotInput };
export { chooseBotBlueprint } from '../src/bots';
export { PARTS };
export { PRESETS, PRESET_NAMES, SLOT_NAMES, blueprintCost, blueprintEdits } from '../src/catalog';
export { getTrack } from '../src/tracks';

export interface SentSteering {
  /** Estimated server delivery time: observed frame send time plus relay delay. */
  due: number;
  steering: number;
}
export interface KeyboardTiming {
  snapshotTimeMs: number;
  nowMs: number;
  delayMs: number;
  sentSteering: readonly SentSteering[];
}

/** The external driver's exact keyboard policy, shared with its headless replay.
 * Precision's optional estimate uses only a received own-lane snapshot and
 * actual sent-input history. It never advances or changes the real simulation.
 * Clock timestamps must share the isolated server/runner host's time origin.
 */
export function chooseBrowserKeyboardInput(lane: Readonly<LaneSnapshot>, track: TrackDefinition, timing?: KeyboardTiming) {
  const limit = (33 - 16 * Math.min(1, lane.car.speed / PARTS[lane.blueprint.motor].maxSpeed!)) * Math.PI / 180;
  let planned = lane;
  let actual = lane.car.wheels[0]?.steering ?? 0;
  let prediction: { horizonMs: number; steps: number; historyFrames: number; observedWheelAngle: number; estimatedWheelAngle: number } | null = null;
  if (track.id === 'precision' && timing && timing.delayMs > 0) {
    const horizonMs = timing.nowMs + timing.delayMs - timing.snapshotTimeMs;
    if (![timing.nowMs, timing.snapshotTimeMs, timing.delayMs, horizonMs].every(Number.isFinite) || horizonMs < 0) throw new Error('Invalid shared-clock keyboard prediction timing');
    const horizon = horizonMs / 1000;
    planned = { ...lane, car: { ...lane.car, position: { ...lane.car.position, x: lane.car.position.x + lane.car.velocity.x * horizon, z: lane.car.position.z + lane.car.velocity.z * horizon }, yaw: lane.car.yaw + lane.car.angularVelocity.y * horizon } };
    const stepMs = 1000 / 60;
    const steps = Math.ceil(horizonMs / stepMs - 1e-8);
    let held = 0;
    for (let step = 0; step < steps; step++) {
      const at = timing.snapshotTimeMs + step * stepMs;
      // Preserve send order, including the last input already delivered before
      // the snapshot. The observed wheel angle itself is never reset to zero.
      for (const sent of timing.sentSteering) if (sent.due <= at + 1e-7) held = sent.steering;
      actual += Math.max(-2.8 / 60, Math.min(2.8 / 60, held * limit - actual));
    }
    prediction = { horizonMs, steps, historyFrames: timing.sentSteering.length, observedWheelAngle: lane.car.wheels[0]?.steering ?? 0, estimatedWheelAngle: actual };
  }
  const decision = chooseBotInput(planned, track, 'normal');
  const desired = decision.input.steering * limit;
  const steering = desired > .02 ? actual < desired ? 1 : 0 : desired < -.02 ? actual > desired ? -1 : 0 : 0;
  return { decision, steering, prediction };
}
