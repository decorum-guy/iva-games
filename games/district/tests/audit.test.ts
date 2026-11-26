import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Participant } from '@iva-games/session-kit';
import { advanceDistrictTime, applyDistrictAction, createDistrictState, roundOrder } from '../src/core';
import { chooseDistrictBotAction } from '../src/bot';
import { getDistrictMap } from '../src/maps';
import { viewDistrict } from '../src/view';
import { sha256Words } from '../src/random';
import type { DistrictAction, DistrictState, ParkOffer } from '../src/types';

const participant = (index: number, bot = false): Participant => ({ participantId: `p${index}`, playerId: bot ? null : `u${index}`, displayName: `Player ${index}`, seatIndex: index,
  controller: bot ? { kind: 'bot', difficulty: 'normal', botProfileId: 'district:normal', botVersion: '1' } : { kind: 'human', playerId: `u${index}` } });
const input = (participants = [participant(0), participant(1)]) => ({ participants, matchId: 'audit-match', roomId: 'audit-room', map: getDistrictMap('crossroads'), now: 1_000, seed: 'audit-reproducible-seed' });
const act = (state: DistrictState, id: string, action: DistrictAction, now = 1_001) => applyDistrictAction(state, id, action, now);
function negotiation(participants = [participant(0), participant(1)]): DistrictState {
  let state = createDistrictState(input(participants));
  for (const p of state.players) state = act(state, p.participant.participantId, { type: 'choose-goal', goal: p.goalOptions[0] });
  return state;
}
function parkFixture(): DistrictState {
  const state = negotiation([participant(0), participant(1, true)]);
  for (const [id, ownerId] of [['A2', 'p0'], ['A4', 'p1']]) {
    const cell = state.cells.find(c => c.id === id)!; cell.ownerId = ownerId; cell.building = { kind: 'house', level: 1 };
  }
  return state;
}

describe('independent District rules audit', () => {
  it('matches Node SHA-256 across UTF-8 and padding/block boundaries used by seeded streams', () => {
    for (const text of ['', 'район 🏡', ...[1, 55, 56, 63, 64, 65, 127, 128, 129, 1000].map(length => 'a'.repeat(length))]) {
      const actual = sha256Words(text).map(word => word.toString(16).padStart(8, '0')).join('');
      expect(actual).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });

  it('validates the full map profile at the pure-core boundary, not only in the catalog', () => {
    const malformed = input(); malformed.map.rows = ['.....', '.....', '.....', '.....', '.....'];
    expect(() => createDistrictState(malformed)).toThrow();
    const incorrectSeats = input(); incorrectSeats.map.supportedPlayers = [2];
    expect(() => createDistrictState(incorrectSeats)).toThrow();
  });

  it('does not repeat a declined identical park contract after the initiative cooldown without an economic change', () => {
    let state = parkFixture();
    const proposal: DistrictAction = { type: 'offer-park', parkId: 'A3', contributions: [
      { participantId: 'p1', resources: { coins: 2, materials: 1, crews: 0 } },
      { participantId: 'p0', resources: { coins: 2, materials: 0, crews: 1 } },
    ] };
    state = act(state, 'p1', proposal);
    const offered = state.offers.at(-1)!;
    state = act(state, 'p0', { type: 'decline-offer', offerId: offered.id, version: offered.version });
    const before = structuredClone(state);
    expect(() => act(state, 'p1', proposal, 11_001)).toThrow();
    expect(state).toEqual(before);
    expect(chooseDistrictBotAction(viewDistrict(state, 'p1', 11_001), 'normal', 'same-decision')).not.toEqual(proposal);
  });

  it('allows a new park proposal after a real public economic change', () => {
    let state = parkFixture();
    const proposal: DistrictAction = { type: 'offer-park', parkId: 'A3', contributions: [
      { participantId: 'p1', resources: { coins: 2, materials: 1, crews: 0 } },
      { participantId: 'p0', resources: { coins: 2, materials: 0, crews: 1 } },
    ] };
    state = act(state, 'p1', proposal);
    const offer = state.offers.at(-1)!;
    state = act(state, 'p0', { type: 'decline-offer', offerId: offer.id, version: offer.version });
    state = act(state, 'p0', { type: 'bank', direction: 'buy', resource: 'materials', quantity: 1 }, 11_001);
    state = act(state, 'p1', proposal, 11_002);
    expect(state.offers.at(-1)?.status).toBe('open');
  });

  it('rejects integer multiplication overflow atomically before bank payment', () => {
    const state = negotiation(); const before = structuredClone(state);
    expect(() => act(state, 'p0', { type: 'bank', resource: 'materials', direction: 'buy', quantity: Number.MAX_SAFE_INTEGER })).toThrow();
    expect(state).toEqual(before);
  });

  it('keeps an uninvited player outside a private park contract before and after refusal', () => {
    let state = negotiation([participant(0), participant(1), participant(2)]);
    state = act(state, 'p0', { type: 'offer-park', parkId: 'A3', contributions: [
      { participantId: 'p0', resources: { coins: 3, materials: 1, crews: 0 } },
      { participantId: 'p1', resources: { coins: 1, materials: 0, crews: 1 } },
    ] });
    const offer = state.offers.at(-1)! as ParkOffer;
    expect(viewDistrict(state, 'p2').you.offers).toHaveLength(0);
    expect(() => act(state, 'p2', { type: 'sign-park', offerId: offer.id, version: offer.version })).toThrow();
    expect(() => act(state, 'p2', { type: 'decline-offer', offerId: offer.id, version: offer.version })).toThrow();
    state = act(state, 'p1', { type: 'decline-offer', offerId: offer.id, version: offer.version });
    expect(viewDistrict(state, 'p2').you.offers).toHaveLength(0);
    expect(JSON.stringify(viewDistrict(state, 'p2').history)).not.toContain(offer.id);
    expect(state.cells.find(c => c.id === 'A3')).toMatchObject({ ownerId: null, completed: false, sponsors: [] });
  });

  it('uses competition ranks 1,1,3 and retains all shared winners', () => {
    let state = negotiation([participant(0), participant(1), participant(2)]);
    state = advanceDistrictTime(state, state.deadlineAt!);
    state = advanceDistrictTime(state, state.deadlineAt!);
    state.round = state.totalRounds; state.phaseId = `${state.round}:development:${state.developmentIndex}`;
    state.players.forEach((p, i) => { p.resources = { coins: i === 2 ? 10 : 12, materials: 0, crews: 0 }; });
    const now = state.updatedAt + 1;
    for (let i = 0; i < 3; i++) state = act(state, roundOrder(state)[state.developmentIndex], { type: 'work' }, now);
    expect(state.outcome?.results.map(result => result.rank)).toEqual([1, 1, 3]);
    expect(new Set(state.outcome?.winnerParticipantIds)).toEqual(new Set(['p0', 'p1']));
  });

  it('a last-human leave at an already-expired final decision cannot rewrite the normal outcome', () => {
    let state = negotiation([participant(0), participant(1, true)]);
    state = advanceDistrictTime(state, state.deadlineAt!);
    state = advanceDistrictTime(state, state.deadlineAt!);
    state.round = 6; state.initialOrder = ['p1', 'p0']; state.developmentIndex = 1; state.phaseId = '6:development:1';
    const expiredAt = state.deadlineAt!;
    const completed = advanceDistrictTime(state, expiredAt);
    expect(completed.outcome?.reason).toBe('completed');
    expect(() => act(completed, 'p0', { type: 'leave' }, expiredAt)).toThrow();
    expect(completed.outcome?.reason).toBe('completed');
    expect(completed.history.filter(entry => entry.type === 'income')).toHaveLength(1);
  });
});
