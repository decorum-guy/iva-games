import { describe, expect, it } from 'vitest';
import { acousticPath, applyCommand, canOccupy, connectParticipant, createMission, cueForNoise, distance, emitNoise, getLevel, knockTarget, lineOfSight, viewForParticipant, zoneAt } from '../src';
import type { NoiseEvent, Vec3 } from '../src';

function mission() {
  const state = createMission({ seed: 29, participants: [
    { participantId: 'a', playerId: 'account-a', displayName: 'A', kind: 'human' },
    { participantId: 'b', playerId: 'account-b', displayName: 'B', kind: 'human' },
  ] });
  connectParticipant(state, 'a'); connectParticipant(state, 'b'); return state;
}
const noise = (position: Vec3, power = 26, zoneId = 'A'): NoiseEvent => ({ id: 'test-noise', at: 0, tick: 0, type: 'listener-step', position, zoneId, power, echoRadius: 0.8 });

describe('physical intra-zone acoustics and hidden-source privacy', () => {
  it('keeps the exact real source and Euclidean attenuation for a short unobstructed direct ray', () => {
    const state = mission(), level = getLevel('archive'), source = { x: 0, y: 1.4, z: 0 }, target = { x: 2, y: 1.4, z: 0 };
    const path = acousticPath(level, state.doors, source, 'A', target, 'A', 26)!;
    expect(path.distance).toBe(2); expect(path.residual).toBe(18); expect(path.virtualSource).toEqual(source); expect(path.occluded).toBe(false);
    expect(cueForNoise(level, state.doors, noise(source), { position: { x: 2, y: 0, z: 0 }, zoneId: 'A', yaw: 0 })).toMatchObject({ position: source, occluded: false });
  });

  it('routes around an archive shelf and exposes a visible bend instead of the hidden Listener position', () => {
    const state = mission(), level = getLevel('archive'), observer = state.actors[0];
    observer.position = { x: 3.5, y: 0, z: 4.5 }; observer.zoneId = 'A';
    state.listener.position = { x: 4.4, y: 0, z: 2 }; state.listener.zoneId = 'A';
    const source = { ...state.listener.position, y: 0.1 }, eye = { ...observer.position, y: 1.4 };
    expect(canOccupy(level, state.doors, observer.position)).toBe(true);
    expect(canOccupy(level, state.doors, state.listener.position, 0.36)).toBe(true);
    expect(lineOfSight(level, state.doors, source, eye)).toBe(false);
    const path = acousticPath(level, state.doors, source, 'A', eye, 'A', 26)!;
    expect(path.distance).toBeGreaterThan(distance(source, eye));
    expect(path.occluded).toBe(true); expect(path.virtualSource).not.toEqual(source);
    expect(lineOfSight(level, state.doors, path.virtualSource, eye)).toBe(true);
    emitNoise(state, 'listener-step', source, 26, 0.8);
    const view = viewForParticipant(state, observer.id), cue = view.cues.find(c => c.type === 'listener-step')!;
    expect(view.listener).toBeNull(); expect(cue).toBeDefined();
    expect(cue.position).toEqual(path.virtualSource); expect(cue.occluded).toBe(true);
    expect(view.echoes.every(echo => JSON.stringify(echo.source) !== JSON.stringify(source))).toBe(true);
    expect(viewForParticipant(state, 'b').listener).toBeNull();
  });

  it('does not cut across a wall or the void between two same-zone corridor arms', () => {
    const state = mission(), level = getLevel('archive'), source = { x: 8.5, y: 1.4, z: 18 }, target = { x: 0, y: 1.4, z: 26.5 };
    expect(zoneAt(level, source)).toBe('C'); expect(zoneAt(level, target)).toBe('C');
    expect(lineOfSight(level, state.doors, source, target)).toBe(false);
    const straight = distance(source, target), power = 4 * straight + 8.2;
    const path = acousticPath(level, state.doors, source, 'C', target, 'C', power)!;
    expect(path.distance).toBeGreaterThan(straight + 0.1);
    expect(path.residual).toBeCloseTo(power - 4 * path.distance);
    expect(lineOfSight(level, state.doors, path.virtualSource, target)).toBe(true);
    expect(cueForNoise(level, state.doors, noise(source, power, 'C'), { position: { ...target, y: 0 }, zoneId: 'C', yaw: 0 })).toBeNull();
    expect(acousticPath(level, state.doors, source, 'C', target, 'C', power, true)!.distance).toBeGreaterThan(straight + 0.1);
  });

  it('does not invent a ray through a completely separating solid wall', () => {
    const state = mission(), level = structuredClone(getLevel('archive'));
    level.walls.push({ id: 'test-full-barrier', zoneId: 'A', position: { x: 0, y: 1.65, z: 2 }, size: { x: 0.3, y: 3.3, z: 15 }, yaw: 0, material: 'concrete' });
    const source = { x: -2, y: 1.4, z: 0 }, target = { x: 2, y: 1.4, z: 0 };
    expect(acousticPath(level, state.doors, source, 'A', target, 'A', 81)).toBeNull();
  });

  it('emits wall and resonator knocks outside their colliders so physical routing keeps them audible', () => {
    for (const resonator of [false, true]) {
      const state = mission(), level = getLevel('archive'), actor = state.actors[0];
      actor.position = resonator ? { x: 22, y: 0, z: 2.1 } : { x: 0, y: 0, z: -4.3 };
      actor.zoneId = resonator ? 'I' : 'A'; actor.yaw = resonator ? -Math.PI / 2 : 0;
      const strike = knockTarget(state, actor.id); expect(strike.kind).toBe(resonator ? 'resonator' : 'knock');
      expect(lineOfSight(level, state.doors, { ...actor.position, y: 1.45 }, strike.position)).toBe(true);
      expect(applyCommand(state, actor.id, { actionId: `strike-${resonator}`, controllerEpoch: actor.controllerEpoch, payload: { type: 'knock' } }).ok).toBe(true);
      const event = state.noises.at(-1)!;
      expect(acousticPath(level, state.doors, event.position, event.zoneId, { ...actor.position, y: 1.4 }, actor.zoneId, event.power)?.residual).toBeGreaterThan(16);
      expect(state.echoes.length).toBeGreaterThan(0);
    }
  });
});
