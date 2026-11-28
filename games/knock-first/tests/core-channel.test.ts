import { describe, expect, it } from 'vitest';
import { acousticCostLowerBound, acousticPath, applyCommand, canOccupy, CHANNEL_LENGTH_FACTOR, connectParticipant, createMission, cueForNoise, DIFFICULTIES, distance, getLevel, knockTarget, navigationPath, STEP_SECONDS, stepMission, viewForParticipant } from '../src';
import type { Difficulty, NoiseEvent, Vec3 } from '../src';

/** Controlled authoritative fixtures. These are unit scenarios, not browser play. */
function relay(difficulty: Difficulty = 'normal', listenerPosition: Vec3 = { x: 36, y: 0, z: 18 }) {
  const state = createMission({ seed: 29, settings: { route: 'relay', difficulty }, participants: [
    { participantId: 'a', playerId: 'account-a', displayName: 'A', kind: 'human' },
    { participantId: 'b', playerId: 'account-b', displayName: 'B', kind: 'human' },
  ] });
  connectParticipant(state, 'a'); connectParticipant(state, 'b'); state.phase = 'active'; state.preparationRemaining = 0;
  const level = getLevel('relay'), duct = level.portals.find(portal => portal.channel)!, resonator = level.resonators.find(item => item.zoneId === 'S')!;
  const actor = state.actors[0]; actor.position = { x: resonator.position.x - 0.7, y: 2.2, z: resonator.position.z }; actor.zoneId = 'S'; actor.yaw = -Math.PI / 2;
  state.listener.position = { ...listenerPosition }; state.listener.zoneId = 'P';
  const strike = knockTarget(state, actor.id); expect(strike.kind).toBe('resonator');
  const event: NoiseEvent = { id: 'test-resonator', at: state.time, tick: state.tick, type: 'resonator', position: strike.position, zoneId: 'S', power: 81, echoRadius: 16, actorId: actor.id };
  const knock = () => applyCommand(state, actor.id, { actionId: 'actual-resonator-strike', controllerEpoch: actor.controllerEpoch, payload: { type: 'knock' } });
  return { state, level, duct, actor, strike, event, knock };
}

describe('approved Relay sound-channel adjustment', () => {
  it('measures the actual resonator face, inlet, outlet and Listener ear without moving geometry', () => {
    const { state, level, duct, actor, strike } = relay();
    const ear = { ...state.listener.position, y: state.listener.position.y + 1.6 };
    expect(CHANNEL_LENGTH_FACTOR).toBe(0.1);
    expect(actor.position).toEqual({ x: 4, y: 2.2, z: 38.1 }); expect(strike.position).toEqual({ x: 4.4, y: 3.25, z: 38.1 });
    expect(duct.aPoint).toEqual({ x: 4.6, y: 4.6, z: 36 }); expect(duct.bPoint).toEqual({ x: 31.4, y: 2.4, z: 18 });
    expect(duct.channelLength).toBeCloseTo(40.30930413688631, 10);
    expect(canOccupy(level, state.doors, actor.position)).toBe(true); expect(canOccupy(level, state.doors, state.listener.position, 0.36)).toBe(true);
    const approach = acousticPath(level, state.doors, strike.position, 'S', duct.aPoint, 'S', 81)!;
    const departure = acousticPath(level, state.doors, duct.bPoint, 'P', ear, 'P', 81)!;
    const path = acousticPath(level, state.doors, strike.position, 'S', ear, 'P', 81)!;
    expect(approach.distance).toBeCloseTo(2.5044959572736394, 10); expect(departure.distance).toBeCloseTo(4.669047011971502, 10);
    expect(path.distance).toBeCloseTo(approach.distance + 4 + 0.1 * duct.channelLength + departure.distance, 10);
    expect(path.distance).toBeCloseTo(15.204473382933772, 10); expect(path.residual).toBeCloseTo(20.182106468264912, 10);
    expect(path.portals).toEqual([duct.id]); expect(path.channel).toBe(true); expect(path.virtualSource).toEqual(duct.bPoint);
    expect(path.residual).toBeGreaterThan(DIFFICULTIES.normal.hearing);
    const ordinaryLevel = structuredClone(level); ordinaryLevel.portals = ordinaryLevel.portals.filter(portal => !portal.channel);
    const ordinary = acousticPath(ordinaryLevel, state.doors, strike.position, 'S', ear, 'P', 81)!;
    expect(ordinary.distance).toBeCloseTo(41.75436516775946, 10); expect(ordinary.residual).toBeLessThan(8);
  });

  it('retains audible cues that the old global Euclidean pruning would discard, in both directions', () => {
    const { state, level, duct, strike, event } = relay();
    const observer = { position: { x: 36, y: 0, z: 18 }, zoneId: 'P', yaw: 0 }, ear = { ...observer.position, y: 1.4 };
    expect(event.power - 4 * distance(strike.position, ear)).toBeLessThan(8);
    const path = acousticPath(level, state.doors, strike.position, 'S', ear, 'P', event.power)!;
    expect(acousticCostLowerBound(level, strike.position, ear)).toBeLessThanOrEqual(path.distance + 1e-8);
    expect(cueForNoise(level, state.doors, event, observer)).toMatchObject({ channel: true, occluded: true, position: duct.bPoint });
    const reverse: NoiseEvent = { ...event, id: 'reverse-timer', type: 'timer', power: 78, position: { x: 31.8, y: 0.15, z: 18 }, zoneId: 'P' };
    const upperObserver = { position: { x: 4, y: 2.2, z: 36 }, zoneId: 'S', yaw: 0 };
    expect(reverse.power - 4 * distance(reverse.position, { ...upperObserver.position, y: 3.6 })).toBeLessThan(8);
    const reverseCue = cueForNoise(level, state.doors, reverse, upperObserver)!;
    expect(reverseCue).toMatchObject({ channel: true, occluded: true, position: duct.aPoint });
    expect(reverseCue.position).not.toEqual(reverse.position);
  });

  it('a real resonator command makes the normal Listener investigate through the duct without exposing its position or teleporting it', () => {
    const { state, level, duct, strike, knock } = relay(), before = { ...state.listener.position };
    expect(knock()).toMatchObject({ ok: true });
    expect(state.listener.mode).toBe('investigate'); expect(state.listener.target).toEqual(strike.position);
    expect(state.listener.lastHeardPower).toBeCloseTo(20.182106468264912, 10); expect(state.listener.position).toEqual(before);
    const view = viewForParticipant(state, 'a'); expect(view.listener).toBeNull();
    expect(JSON.stringify(view)).not.toContain('lastHeardPower'); expect(JSON.stringify(view)).not.toContain('targetActorId');
    for (let i = 0; i < 13; i++) stepMission(state);
    expect(state.listener.mode).toBe('investigate');
    expect(distance(before, state.listener.position)).toBeGreaterThan(0); expect(distance(before, state.listener.position)).toBeLessThanOrEqual(2.45 * STEP_SECONDS * 13 + 1e-8);
    expect(state.listener.zoneId).toBe('P'); expect(canOccupy(level, state.doors, state.listener.position, 0.36)).toBe(true);
    expect(viewForParticipant(state, 'a').listener).toBeNull();
    const route = navigationPath(level, before, strike.position, { allowClosed: true });
    expect(route.length).toBeGreaterThan(2); expect(route).not.toContainEqual(duct.aPoint); expect(route).not.toContainEqual(duct.bPoint);
  });

  it.each(['calm', 'normal', 'tense'] as const)('keeps the %s hearing threshold and reacts near the P outlet', difficulty => {
    const { state, knock } = relay(difficulty, { x: 35, y: 0, z: 18 });
    expect(knock().ok).toBe(true); expect(state.listener.mode).toBe('investigate');
    expect(state.listener.lastHeardPower).toBeGreaterThan(DIFFICULTIES[difficulty].hearing);
  });

  it('does not lower the calm threshold to make every point in P audible to the creature', () => {
    const { state, knock } = relay('calm'); expect(knock().ok).toBe(true); expect(state.listener.mode).toBe('patrol');
    expect(DIFFICULTIES.calm.hearing).toBe(22);
  });

  it('keeps the channel out of movement and echo, including the actual mission echo clusters', () => {
    const { state, level, duct, strike, actor, knock } = relay(), target = { ...state.listener.position, y: 1.6 };
    const echo = acousticPath(level, state.doors, strike.position, 'S', target, 'P', 81, true)!;
    expect(echo.portals).not.toContain(duct.id); expect(echo.distance).toBeGreaterThan(16);
    const route = navigationPath(level, actor.position, state.listener.position, { allowClosed: true });
    expect(route.length).toBeGreaterThan(2); expect(route).not.toContainEqual(duct.aPoint); expect(route).not.toContainEqual(duct.bPoint);
    expect(knock().ok).toBe(true);
    for (const wave of state.echoes) for (const cluster of wave.clusters) expect(level.echoClusters.find(item => item.id === cluster.id)!.zoneId).not.toBe('P');
    expect(state.discoveredZones).not.toContain('P');
  });

  it('keeps ordinary free-space and open/closed-door attenuation unchanged', () => {
    const { state, level } = relay(), source = { x: 18, y: 1.4, z: 18 }, target = { x: 20, y: 1.4, z: 18 };
    expect(acousticCostLowerBound(level, source, target)).toBe(2);
    expect(acousticPath(level, state.doors, source, 'G', target, 'G', 57)).toMatchObject({ distance: 2, residual: 49, channel: false, occluded: false, virtualSource: source });
    const archive = getLevel('archive'), old = createMission({ participants: [{ participantId: 'a', displayName: 'A' }, { participantId: 'b', displayName: 'B' }] });
    const near = { x: 7, y: 1.4, z: 18 }, far = { x: 11, y: 1.4, z: 18 };
    expect(acousticCostLowerBound(archive, near, far)).toBe(4);
    expect(acousticPath(archive, old.doors, near, 'C', far, 'X', 57)!.residual).toBeCloseTo(13);
    old.doors.find(door => door.id === 'C-X')!.open = true;
    expect(acousticPath(archive, old.doors, near, 'C', far, 'X', 57)!.residual).toBeCloseTo(35);
  });
});
