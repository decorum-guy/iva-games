import { describe, expect, it } from 'vitest';
import { observePrecisionStall, type PrecisionStallSample, type PrecisionStallState } from '../scripts/qa-driver';
import { getTrack } from '../src/tracks';

const START = 2960;
const FORWARD = { throttle: 1, steering: 0, brake: false };
const BRAKE = { throttle: 0, steering: 0, brake: true };

/** Pose, speed, charge, cargo, tick and acknowledgement are copied from Bob's
 * first retained Precision tail observation in candidate8 RTT120 job141041478368
 * (run46165328742, checkout77043f7bd267cde87662c1542cea83fb0a4ac873).
 * The compact browser record did NOT contain tilt. Upright tilt=0 below is an
 * explicit unit-test precondition, not a claimed browser measurement.
 * Subsequent regular 15Hz samples are synthetic unit observations; the saved
 * browser tail was too sparse to prove this detector's continuous-time gate.
 */
function sample(tick = START): PrecisionStallSample {
  const serverTime = 1795883726497 + (tick - START) * 1000 / 60;
  return {
    scope: 'connection3/match/epoch-after-restart/stage1/phase11',
    track: getTrack('precision', true),
    nowMs: serverTime + 85,
    snapshotTimeMs: serverTime,
    lastAcceptedSeq: 2222 + Math.floor((tick - START) / 2),
    sentInput: { ...FORWARD },
    plannedInput: { ...FORWARD },
    lane: {
      tick, gatesPassed: 1, resets: 0, finished: false,
      car: { position: { x: -1.4926316738128662, z: 16.774662017822266 }, speed: 0.0006099435800771421, charge: 14.024999999997615, tilt: 0 },
      cargo: [{ status: 'secured', health: 100 }, { status: 'secured', health: 100 }, { status: 'secured', health: 100 }],
    },
  };
}

type Change = (value: PrecisionStallSample) => void;
function feed(from: number, until: number, previous: PrecisionStallState | null = null, change?: Change) {
  let state = previous;
  const triggers = [];
  for (let tick = from; tick <= until; tick += 4) {
    const observation = sample(tick);
    change?.(observation);
    const result = observePrecisionStall(state, observation);
    state = result.state;
    if (result.restore) triggers.push(result.evidence);
  }
  return { state, triggers };
}

describe('external QA Precision upright-stall observation', () => {
  it('requests one ordinary restore after 90 simulation ticks in the recorded stall shape', () => {
    const before = feed(START, START + 88);
    expect(before.triggers).toEqual([]);
    const input = sample(START + 92);
    const original = structuredClone(input);
    const result = observePrecisionStall(before.state, input);
    expect(result.restore).toBe(true);
    expect(result.evidence).toMatchObject({ startTick: START, tick: START + 92, stalledTicks: 92, gatesPassed: 1, resets: 0, charge: 14.024999999997615 });
    expect(result.evidence?.gateId).toBe(input.track.orderedGates[1]!.id);
    expect(input).toEqual(original);
    expect(feed(START + 96, START + 296, result.state).triggers).toEqual([]);
  });

  it.each<[string, Change]>([
    ['moving chassis', value => { value.lane.car.speed = 0.4; }],
    ['still loading', value => { value.lane = { ...value.lane, cargo: [{ status: 'at-dock', health: 100 }] }; }],
    ['broken cargo', value => { value.lane = { ...value.lane, cargo: [{ status: 'secured', health: 0 }] }; }],
    ['empty battery', value => { value.lane.car.charge = 0; }],
    ['finished lane', value => { value.lane = { ...value.lane, finished: true }; }],
    ['another track', value => { value.track = getTrack('fragile', true); }],
    ['passed next gate plane', value => { value.lane.car.position.z = 17.01; }],
    ['far from next gate', value => { value.lane.car.position.z = 14; }],
    ['all gates passed', value => { value.lane = { ...value.lane, gatesPassed: value.track.orderedGates.length }; }],
    ['tilted car', value => { value.lane.car.tilt = 80; }],
    ['planned braking', value => { value.plannedInput = BRAKE; }],
    ['actual sent braking', value => { value.sentInput = BRAKE; }],
    ['no observed sent throttle', value => { value.sentInput = { throttle: 0, steering: 1, brake: false }; }],
    ['stale snapshot', value => { value.nowMs = value.snapshotTimeMs + 301; }],
    ['future snapshot', value => { value.nowMs = value.snapshotTimeMs - 1; }],
    ['missing acknowledgement', value => { value.lastAcceptedSeq = -1; }],
    ['invalid pose', value => { value.lane.car.position.x = NaN; }],
  ])('does not request recovery for %s', (_name, change) => {
    expect(feed(START, START + 200, null, change).triggers).toEqual([]);
  });

  it('requires real snapshot ticks and advancing input acknowledgements', () => {
    let state: PrecisionStallState | null = null;
    for (let i = 0; i < 100; i++) {
      // Polling a duplicate snapshot cannot turn wall-clock time into race time.
      const duplicate = sample();
      duplicate.nowMs += i;
      const result = observePrecisionStall(state, duplicate);
      expect(result.restore).toBe(false);
      state = result.state;
    }
    expect(state?.startTick).toBe(START);
    expect(feed(START + 4, START + 200, state, value => { value.lastAcceptedSeq = 2222; }).triggers).toEqual([]);
  });

  it('does not infer continuous throttling from the sparse retained browser tail', () => {
    let state: PrecisionStallState | null = null;
    // The retained tail has approximately 32-tick gaps, exceeding the detector's
    // 18-tick continuity limit. These sparse observations alone cannot trigger.
    for (let tick = START; tick <= START + 960; tick += 32) {
      const result = observePrecisionStall(state, sample(tick));
      expect(result.restore).toBe(false);
      state = result.state;
    }
  });

  it.each<[string, Change]>([
    ['reconnect or recovered phase scope', value => { value.scope += '/new-epoch'; }],
    ['normal reset counter', value => { value.lane = { ...value.lane, resets: 1 }; }],
    ['new gate', value => { value.lane = { ...value.lane, gatesPassed: 2 }; value.lane.car.position.z = 23.77; }],
    ['actual position progress', value => { value.lane.car.position.x += 0.11; }],
  ])('starts a fresh observation window after %s', (_name, change) => {
    const before = feed(START, START + 88);
    const reset = feed(START + 92, START + 180, before.state, change);
    expect(reset.triggers).toEqual([]);
    expect(reset.state?.startTick).toBe(START + 92);
    expect(feed(START + 184, START + 184, reset.state, change).triggers).toHaveLength(1);
  });

  it('clears accumulated time on braking, but retains a triggered latch during the held R', () => {
    const before = feed(START, START + 60);
    const braking = feed(START + 64, START + 68, before.state, value => { value.sentInput = BRAKE; });
    expect(braking.state?.startTick).toBeNull();
    const resumed = feed(START + 72, START + 160, braking.state);
    expect(resumed.triggers).toEqual([]);
    const triggered = feed(START + 164, START + 164, resumed.state);
    expect(triggered.triggers).toHaveLength(1);
    const heldR = feed(START + 168, START + 212, triggered.state, value => { value.sentInput = value.plannedInput = BRAKE; });
    expect(heldR.state?.triggered).toBe(true);
    expect(feed(START + 216, START + 416, heldR.state).triggers).toEqual([]);
    // Only an observed actual reset (or another real scope/progress boundary)
    // rearms the request; releasing the R key alone does not.
    expect(feed(START + 420, START + 512, heldR.state, value => { value.lane = { ...value.lane, resets: 1 }; }).triggers).toHaveLength(1);
  });

  it('clears an incomplete observation on a server tick rollback', () => {
    const before = feed(START, START + 88);
    const rewind = observePrecisionStall(before.state, sample(START + 40));
    expect(rewind.restore).toBe(false);
    expect(rewind.state?.startTick).toBe(START + 40);
    expect(feed(START + 44, START + 128, rewind.state).triggers).toEqual([]);
    expect(feed(START + 44, START + 132, rewind.state).triggers).toHaveLength(1);
  });
});
