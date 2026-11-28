import { describe, expect, it } from 'vitest';
import { createMission, viewForParticipant } from '../src/core/mission';
import { getLevel } from '../src/core/level';
import { predictPlayerPosition } from '../src/client/prediction';

const input = { moveX: 0, moveZ: 1, yaw: 0, pitch: 0, run: false, quiet: false, interact: false };
function sample() {
  const state = createMission({ seed: 19, settings: { tutorial: true }, participants: [
    { participantId: 'a', displayName: 'A', kind: 'human' }, { participantId: 'b', displayName: 'B', kind: 'human' },
  ] });
  const view = viewForParticipant(state, 'a');
  view.phase = 'active'; view.self.position = { x: 0, y: 0, z: 19 };
  view.actors = [{ ...view.self, id: 'b', position: { x: 0, y: 0, z: 18.46 } }];
  return view;
}

describe('permitted-view camera prediction', () => {
  it('does not oscillate into a blocking crew member between snapshots', () => {
    const view = sample();
    for (const age of [0, .016, .033, .067, .1, .14]) {
      expect(predictPlayerPosition(getLevel('tutorial'), view, input, age)).toEqual(view.self.position);
    }
  });
  it('allows moving away from a nearby crew member', () => {
    const view = sample();
    expect(predictPlayerPosition(getLevel('tutorial'), view, { ...input, moveZ: -1 }, .1).z).toBeGreaterThan(view.self.position.z);
  });
  it('does not invent an unseen actor obstruction', () => {
    const view = sample(); view.actors = [];
    expect(predictPlayerPosition(getLevel('tutorial'), view, input, .1).z).toBeLessThan(view.self.position.z);
  });
});
