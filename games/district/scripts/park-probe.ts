import assert from 'node:assert/strict';
import { applyDistrictAction, assertDistrictInvariants, createDistrictState } from '../src/core';
import { chooseDistrictBotAction } from '../src/bot';
import { getDistrictMap } from '../src/maps';
import type { DistrictAction, DistrictState } from '../src/types';
import type { Participant } from '@iva-games/session-kit';
import { viewDistrict } from '../src/view';

const participants: Participant[] = ['a', 'b'].map((id, seatIndex) => ({
  participantId: id, playerId: id, displayName: id, seatIndex,
  controller: { kind: 'human', playerId: id },
}));

/** Matched scripted plans. Both seats commit to the same buildings in both runs. */
export function runParkProbe() {
  const input = {
    matchId: 'park-plan', roomId: 'park-probe', participants,
    map: getDistrictMap('crossroads', '1'), now: 1_000_000, seed: 'park-plan-6',
  };
  const initial = createDistrictState(input);
  const plans = {
    a: { goal: 'green', builds: [{ id: 'B1', kind: 'house' }, { id: 'A2', kind: 'house' }] },
    b: { goal: 'sponsor', builds: [{ id: 'D1', kind: 'cafe' }, { id: 'E2', kind: 'workshop' }] },
  } as const;

  function match(parks: boolean) {
    let state: DistrictState = initial;
    let now = input.now;
    const responses: string[] = [];
    const act = (id: string, action: DistrictAction) => {
      state = applyDistrictAction(state, id, action, now++);
      assertDistrictInvariants(state);
    };
    for (const id of ['a', 'b'] as const) act(id, { type: 'choose-goal', goal: plans[id].goal });
    for (let round = 1; round <= 6; round++) {
      if (round === 4 && parks) act('a', { type: 'bank', direction: 'buy', resource: 'materials', quantity: 1 });
      if (round === 4) act('b', { type: 'bank', direction: 'buy', resource: 'crews', quantity: 1 });
      if (parks && (round === 2 || round === 4)) {
        act('a', { type: 'offer-park', parkId: round === 2 ? 'C1' : 'A3', contributions: [
          { participantId: 'a', resources: { coins: 3, materials: 1, crews: 1 } },
          { participantId: 'b', resources: { coins: 1, materials: 0, crews: 0 } },
        ] });
        const offer = state.offers.at(-1)!;
        const peer = viewDistrict(state, 'b', now);
        const answer = chooseDistrictBotAction(peer, 'hard', 'park-probe-counterparty');
        assert.equal(answer?.type, 'sign-park');
        responses.push(answer.type);
        act('b', { type: 'sign-park', offerId: offer.id, version: offer.version });
      }
      // A house produces crews and B's workshop is planned for round 2. A buys
      // the second material in both runs after the same first round income.
      if (round === 2) act('a', { type: 'bank', direction: 'buy', resource: 'materials', quantity: 1 });
      if (round === 2) act('b', { type: 'bank', direction: 'buy', resource: 'materials', quantity: 1 });
      for (const id of ['a', 'b'] as const) act(id, { type: 'ready', ready: true });
      for (const id of ['a', 'b'] as const) {
        const building = plans[id].builds[round - 1];
        if (building) act(id, { type: 'bid', bid: { lotId: building.id, amount: 1 } });
        act(id, { type: 'confirm-bid' });
      }
      while (state.phase === 'development') {
        const active = viewDistrict(state, 'a', now).activeParticipantId as 'a' | 'b';
        const building = plans[active].builds[round - 1];
        const first = plans[active].builds[0];
        // Upgrade B's cafe once its workshop starts producing materials.
        act(active, building ? { type: 'build', lotId: building.id, building: building.kind }
          : active === 'b' && round === 4 ? { type: 'upgrade', lotId: first.id } : { type: 'work' });
      }
    }
    assert.equal(state.outcome?.reason, 'completed');
    const results = state.outcome.results.map(({ participantId, capital, goal, goalCompleted }) => ({ participantId, capital, goal, goalCompleted }));
    assert.ok(results.every(row => row.goalCompleted === parks));
    return { parks: state.cells.filter(cell => cell.completed).map(cell => cell.id), results, responses };
  }

  return { seed: input.seed, map: 'crossroads@1', plan: plans,
    noParks: match(false), negotiatedParks: match(true) };
}
