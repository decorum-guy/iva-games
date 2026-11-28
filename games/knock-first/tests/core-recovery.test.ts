import { describe, expect, it } from 'vitest';
import {
  advanceMission, applyCommand, batteryHandlePositions, canOccupy, connectParticipant,
  createMission, disconnectParticipant, distanceXZ, getLevel, setInput, stepMission,
} from '../src';

function course() {
  const state = createMission({ seed: 31, settings: { tutorial: true, difficulty: 'calm' }, participants: [
    { participantId: 'human', displayName: 'Human', kind: 'human' },
    { participantId: 'bot', displayName: 'Partner', kind: 'bot' },
  ] });
  connectParticipant(state, 'human');
  applyCommand(state, 'human', { actionId: 'ready', controllerEpoch: state.actors[0].controllerEpoch, payload: { type: 'ready' } });
  stepMission(state);
  return state;
}

describe('observed tutorial and teammate recovery failures', () => {
  it('lets a human back away from a wall when the idle follower stands behind them', () => {
    const state = course(), [human, bot] = state.actors, level = getLevel('tutorial');
    state.tutorial!.step = 2;
    human.position = { x: 2.223, y: 0, z: 13.303 };
    bot.position = { x: 2.027, y: 0, z: 13.841 };
    human.zoneId = bot.zoneId = 'L';
    bot.botIntent = 'follow'; bot.botNextAt = state.time;
    expect(canOccupy(level, state.doors, human.position)).toBe(true);
    expect(canOccupy(level, state.doors, bot.position)).toBe(true);
    const start = human.position.z;
    for (let tick = 0; tick < 60; tick++) {
      setInput(state, human.id, { ...human.input, seq: human.input.seq + 1, moveX: 0, moveZ: 1, yaw: 0 });
      stepMission(state);
      expect(distanceXZ(human.position, bot.position)).toBeGreaterThanOrEqual(0.54 - 1e-8);
      expect(canOccupy(level, state.doors, bot.position)).toBe(true);
    }
    expect(human.position.z - start).toBeGreaterThan(1.5);
  });

  it('does not deliver a learner\'s held battery while their tutorial client is disconnected', () => {
    const state = course(), [human, bot] = state.actors, battery = state.batteries[0];
    battery.position = { ...getLevel('tutorial').sockets[0] };
    battery.lastStable = { ...battery.position }; battery.zoneId = 'L';
    for (const [handle, holder] of [human, bot].entries()) {
      holder.position = batteryHandlePositions(battery, true)[handle]; holder.zoneId = 'L';
      expect(applyCommand(state, holder.id, { actionId: `take-${handle}`, controllerEpoch: holder.controllerEpoch,
        payload: { type: 'takeHandle', batteryId: battery.id, handle } }).ok).toBe(true);
    }
    state.tutorial!.step = 6;
    disconnectParticipant(state, human.id, human.controllerEpoch);
    advanceMission(state, 13);
    expect(battery.installed).toBe(false);
    expect(human.carrying).toBe(battery.id);
    expect(state.tutorial!.step).toBe(6);
    const epoch = connectParticipant(state, human.id);
    applyCommand(state, human.id, { actionId: 'manual-release', controllerEpoch: epoch, payload: { type: 'drop' } });
    stepMission(state);
    expect(state.tutorial!.step).toBe(7);
  });

  it('rearms the real carry exercise instead of awarding release for an already installed training battery', () => {
    const state = course(), battery = state.batteries[0];
    state.tutorial!.step = 6; state.tutorial!.hadPair = true;
    battery.installed = true; battery.socket = 0; state.sockets[0] = battery.id;
    stepMission(state);
    expect(state.tutorial!.step).toBe(5);
    expect(state.tutorial!.hadPair).toBe(false);
    expect(state.tutorial!.released).toBe(false);
    expect(state.tutorial!.completed).toBe(false);
    expect(state.outcome).toBeNull();
    expect(state.batteries.filter(item => !item.installed)).toHaveLength(1);
  });

  it('retains the normal mission assistant after a disconnection', () => {
    const state = createMission({ settings: { route: 'archive', difficulty: 'calm' }, participants: [
      { participantId: 'human', displayName: 'Human', kind: 'human' },
      { participantId: 'bot', displayName: 'Partner', kind: 'bot' },
    ] });
    connectParticipant(state, 'human');
    disconnectParticipant(state, 'human', state.actors[0].controllerEpoch);
    advanceMission(state, 11);
    expect(state.actors[0].assistant).toBe(true);
  });
});
