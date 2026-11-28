import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Participant } from '@iva-games/session-kit';
import { applyTerritory, createTerritory, emptyStock, territoryMaps, viewTerritory } from '@iva-games/district/territorial';
import type { Stock, TerritoryState } from '@iva-games/district/territorial';
import { randomStream } from '../../../games/district/src/random';
import { ResourceStock } from './TerritorialResources';
import { counterDraft, inspectTradeDraft, parseTradeDraft, tradeDraftKey } from './territorialTradeDraft';

const hand = (values: Partial<Stock>): Stock => ({ ...emptyStock(), ...values });
const participant = (id: string, seatIndex: number): Participant => ({
  participantId: id, playerId: id, displayName: id, seatIndex, controller: { kind: 'human', playerId: id },
});
function table() {
  const state = createTerritory({ matchId: 'draft-match', roomId: 'draft-room', map: territoryMaps[0],
    participants: [participant('a', 0), participant('b', 1), participant('c', 2)],
    seed: 'draft-check', preset: 'easy', now: 1000 });
  state.phase = 'play'; state.turn = 1;
  state.news.nextRound = 1000;
  state.players.a.hand = hand({ wood: 4, ore: 1 });
  state.players.b.hand = hand({ brick: 4, grain: 1 });
  state.players.c.hand = hand({ wool: 4 });
  return state;
}
const play = (state: TerritoryState, id: string, action: Parameters<typeof applyTerritory>[2]) => applyTerritory(state, id, action, 2000 + state.revision);
function rollWithoutSeven(state: TerritoryState, id: string) {
  for (let index = 0; index < 100; index++) {
    const seed = `draft-safe-roll-${index}`;
    const rng = randomStream(seed, `roll:${state.turn}`);
    if (rng(6) + rng(6) + 2 !== 7) { state.seed = seed; break; }
  }
  return play(state, id, { type: 'roll' });
}

describe('Territorial trade draft recovery against the real rules core', () => {
  it('preserves an edited counteroffer after the author ends the turn, then sends the same conditions as a legal new offer', () => {
    let state = play(table(), 'a', { type: 'offer', targetId: 'b', give: hand({ wood: 1 }), receive: hand({ brick: 1 }) });
    const firstView = viewTerritory(state, 'b', 2000);
    const draft = counterDraft(firstView.offers[0]);
    draft.give.brick = 2;
    draft.receive.wood = 2;
    const stored = JSON.stringify(draft);
    expect(inspectTradeDraft(firstView, draft).ready).toBe(true);

    state = play(state, 'a', { type: 'end' });
    const restored = parseTradeDraft(stored)!;
    expect(restored).toEqual(draft);
    const expired = inspectTradeDraft(viewTerritory(state, 'b', 3000), restored);
    expect(expired.ready).toBe(false);
    expect(expired.closedParent?.status).toBe('expired');
    expect(restored.targetId).toBe('a');
    expect(restored.give.brick).toBe(2);

    state = rollWithoutSeven(state, 'b');
    expect(inspectTradeDraft(viewTerritory(state, 'b', 4000), restored).ready).toBe(false);
    const reused = { ...restored, parentId: null };
    expect(inspectTradeDraft(viewTerritory(state, 'b', 4000), reused).ready).toBe(true);
    state = play(state, 'b', { type: 'offer', targetId: reused.targetId, give: reused.give, receive: reused.receive });
    const sent = viewTerritory(state, 'b', 5000).offers[0];
    expect(sent).toMatchObject({ authorId: 'b', targetId: 'a', give: hand({ brick: 2 }), receive: hand({ wood: 2 }) });
    state = play(state, 'a', { type: 'accept', offerId: sent.id });
    state = play(state, 'b', { type: 'accept', offerId: sent.id });
    const confirmed = viewTerritory(state, 'b', 6000);
    expect(confirmed.offerHistory?.find(offer => offer.id === sent.id)?.status).toBe('accepted');
    expect(confirmed.you.hand).toMatchObject({ wood: 2, brick: 2 });
  });

  it('reuses preserved conditions as a broadcast after the active player changes', () => {
    let state = play(table(), 'a', { type: 'offer', targetId: 'c', give: hand({ wood: 1 }), receive: hand({ wool: 1 }) });
    const draft = counterDraft(viewTerritory(state, 'c', 2000).offers[0]);
    state = play(state, 'a', { type: 'end' });
    state = rollWithoutSeven(state, 'b');
    const reused = { ...draft, parentId: null };
    const inspection = inspectTradeDraft(viewTerritory(state, 'c', 3000), reused);
    expect(inspection.targetAllowed).toBe(true);
    expect(inspection.ready).toBe(true);
    expect(reused.targetId).toBe('a');
    expect(reused.give.wool).toBe(1);
  });

  it('keeps quantities after another transfer and reports the exact missing amount', () => {
    let state = play(table(), 'a', { type: 'offer', targetId: 'b', give: hand({ wood: 1 }), receive: hand({ brick: 4 }) });
    const draft = counterDraft(viewTerritory(state, 'b', 2000).offers[0]);
    state = play(state, 'a', { type: 'offer', targetId: 'b', give: hand({ ore: 1 }), receive: hand({ brick: 3 }) });
    state = play(state, 'b', { type: 'accept', offerId: state.offers[0].id });
    state = play(state, 'a', { type: 'accept', offerId: state.offers[0].id });
    const inspection = inspectTradeDraft(viewTerritory(state, 'b', 3000), { ...draft, parentId: null });
    expect(inspection.shortage).toEqual(hand({ brick: 3 }));
    expect(inspection.ready).toBe(false);
    expect(draft.give.brick).toBe(4);
  });

  it('isolates seats and matches and rejects corrupt or stale storage schemas', () => {
    const keys = [tradeDraftKey('a:b', 'c'), tradeDraftKey('a', 'b:c'), tradeDraftKey('a:b', 'd'), tradeDraftKey('other', 'c')];
    expect(new Set(keys).size).toBe(keys.length);
    expect(parseTradeDraft('{broken')).toBeNull();
    const offerState = play(table(), 'a', { type: 'offer', targetId: 'b', give: hand({ wood: 1 }), receive: hand({ brick: 1 }) });
    const valid = counterDraft(viewTerritory(offerState, 'b', 2000).offers[0]);
    expect(parseTradeDraft(JSON.stringify({ ...valid, version: 2 }))).toBeNull();
    expect(parseTradeDraft(JSON.stringify({ ...valid, give: { ...valid.give, wood: -1 } }))).toBeNull();
    expect(parseTradeDraft(JSON.stringify({ ...valid, receive: { ...valid.receive, wood: 1.5 } }))).toBeNull();
    expect(parseTradeDraft(JSON.stringify({ ...valid, unrelatedHiddenData: 'not retained' }))).toEqual(valid);
  });
});

describe('Resource representations respect disclosed quantities', () => {
  it('shows all five hand stacks including zeros, signed changes and capped bank availability', () => {
    const html = renderToStaticMarkup(createElement(ResourceStock, { stock: hand({ wood: 2 }), lang: 'ru', showZero: true, appearance: 'cards', delta: { wood: 1, ore: -1 } }));
    expect(html.match(/role="listitem"/g)).toHaveLength(5);
    expect(html).toContain('Древесина: 2 (+1)');
    expect(html).toContain('Руда: 0 (-1)');
    expect(html).not.toContain('Бесплатно');
    const bank = renderToStaticMarkup(createElement(ResourceStock, { stock: hand({ wood: 2, brick: 1 }), lang: 'en', showZero: true, bank: true }));
    expect(bank).toContain('Wood: 2+');
    expect(bank).toContain('Brick: 1');
    expect(bank).toContain('Ore: 0');
  });
});
