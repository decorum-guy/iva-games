import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getActiveActor, legalActions, legalCardActions, publicView, restoreGame, setControl, squareFromName, validateState } from '../../src/core';
import { suggestAction } from '../../src/engine/search';
import type { CardId, GameState } from '../../src/core';
const sq = squareFromName;
const unit = (s: GameState, id: string) => s.units.find(u => u.id === id)!;
function cardState(card: CardId): GameState {
  const s = createGame({ mode: 'practice', bossCards: false }); s.hand = [card]; s.focus = 5;
  unit(s, 'rook').square = sq('d3'); unit(s, 'queen').square = sq('f4'); unit(s, 'bishop').square = sq('b4');
  return s;
}

describe('remaining player-card interactions', () => {
  it('sharp edge strengthens exactly one strike and cannot double-activate', () => {
    let s = cardState('sharp-edge'); s.boss.armor = 0;
    s = applyAction(s, { type: 'card', cardId: 'sharp-edge', targets: ['rook'] });
    s = applyAction(s, { type: 'attack', unitId: 'rook', target: sq('d6') });
    expect(s.boss.hp).toBe(24); expect(unit(s, 'rook').attackBonus).toBe(0); expect(legalActions(s, 'rook')).toEqual([]);
  });
  it('armor tip removes armor only after the ordinary attack and has no HP overflow', () => {
    let s = cardState('armor-tip'); s.boss.armor = 4;
    s = applyAction(s, { type: 'card', cardId: 'armor-tip', targets: ['queen'] });
    s = applyAction(s, { type: 'attack', unitId: 'queen', target: sq('d6') });
    expect(s.boss.armor).toBe(0); expect(s.boss.hp).toBe(28);
  });
  it('focus respects its cap and uses the single card slot', () => {
    let s = cardState('focus'); expect(legalCardActions(s, 'focus')).toEqual([]); s.focus = 4;
    s = applyAction(s, { type: 'card', cardId: 'focus' }); expect(s.focus).toBe(5); expect(s.cardPlayed).toBe(true);
  });
  it('hospital needs distinct living non-king targets and clamps each separately', () => {
    let s = cardState('hospital'); unit(s, 'queen').hp = 5; unit(s, 'rook').hp = 1;
    expect(() => applyAction(s, { type: 'card', cardId: 'hospital', targets: ['rook', 'rook'] })).toThrow();
    s = applyAction(s, { type: 'card', cardId: 'hospital', targets: ['queen', 'rook'] });
    expect(unit(s, 'queen').hp).toBe(6); expect(unit(s, 'rook').hp).toBe(3);
  });
  it('hunt mark counts distinct activations and leaves no persistent bonus', () => {
    let s = cardState('hunt-mark'); s.boss.armor = 0;
    s = applyAction(s, { type: 'card', cardId: 'hunt-mark' });
    for (const id of ['rook', 'queen', 'bishop']) s = applyAction(s, { type: 'attack', unitId: id, target: sq('d6') });
    expect(s.boss.hp).toBe(16); expect(s.huntMark).toBe(0);
  });
  it('formation gives three independent shields without including the king', () => {
    let s = cardState('formation');
    expect(() => applyAction(s, { type: 'card', cardId: 'formation', targets: ['king'] })).toThrow();
    s = applyAction(s, { type: 'card', cardId: 'formation', targets: ['rook', 'queen', 'bishop'] });
    expect(['rook', 'queen', 'bishop'].map(id => unit(s, id).shield)).toEqual([3, 3, 3]);
  });
  it('marble vow survives one response and expires after the second', () => {
    let s = cardState('marble-vow'); s = applyAction(s, { type: 'card', cardId: 'marble-vow', targets: ['king'] });
    s = applyAction(s, { type: 'end' }); expect(unit(s, 'king').invulnerable).toBe(1);
    s = applyAction(s, { type: 'end' }); expect(unit(s, 'king').invulnerable).toBe(0);
  });
  it('shell break uses its pre-card armor condition instead of overflowing', () => {
    let s = cardState('shell-break'); s.boss.armor = 1;
    s = applyAction(s, { type: 'card', cardId: 'shell-break' }); expect([s.boss.armor, s.boss.hp]).toEqual([0, 28]);
    s = cardState('shell-break'); s.boss.armor = 0;
    s = applyAction(s, { type: 'card', cardId: 'shell-break' }); expect(s.boss.hp).toBe(24);
  });
});

describe('continuation and assistance contracts', () => {
  it('two camps preserve promotions, owner, losses and wounds through all three bosses', () => {
    let s = createGame({ mode: 'campaign', bossCards: false });
    const promoted = unit(s, 'pawn-c'); promoted.type = 'R'; promoted.maxHp = 4; promoted.hp = 1; promoted.firstMove = false;
    unit(s, 'bishop').hp = 0; unit(s, 'bishop').square = null; unit(s, 'king').hp = 12;
    s.phase = 'camp'; s.boss.hp = 0;
    s = applyAction(s, { type: 'camp', healId: 'pawn-c' });
    expect(s.boss.id).toBe('spire'); expect(unit(s, 'pawn-c')).toMatchObject({ type: 'R', hp: 4, square: sq('c2'), owner: 'B' });
    expect(unit(s, 'bishop').hp).toBe(0); expect(unit(s, 'king').hp).toBe(16);
    unit(s, 'pawn-c').hp = 0; unit(s, 'pawn-c').square = null; s.phase = 'camp'; s.boss.hp = 0;
    s = applyAction(s, { type: 'camp', reviveId: 'pawn-c' });
    expect(s.boss.id).toBe('archivist'); expect(unit(s, 'pawn-c')).toMatchObject({ type: 'R', hp: 1, square: sq('c2'), owner: 'B' });
    expect(unit(s, 'bishop').hp).toBe(0); expect(unit(s, 'king').hp).toBe(20);
    expect(validateState(s)).toEqual([]);
    s.boss.hp = 1; s.boss.armor = 0; unit(s, 'rook').square = sq('d3');
    s = applyAction(s, { type: 'attack', unitId: 'rook', target: sq('d6') });
    expect(s.phase).toBe('finished'); expect(s.campaignIndex).toBe(2); expect(s.outcome?.winner).toBe('army');
    expect(() => applyAction(s, { type: 'camp', reviveId: 'bishop' })).toThrow();
  });
  it('mandatory sixth-card discard freezes no boss intent until the discard and survives reload', () => {
    let s = createGame({ bossCards: false });
    for (let i = 0; i < 3; i++) s = applyAction(s, { type: 'end' });
    expect(s.round).toBe(4); expect(s.mustDiscard).toBe(true); expect(s.hand).toHaveLength(6); expect(s.intent.steps).toEqual([]);
    const loaded = restoreGame(JSON.parse(JSON.stringify(s)));
    expect(() => applyAction(loaded, { type: 'guard', unitId: 'king' })).toThrow();
    const cardId = s.hand[0]; s = applyAction(loaded, { type: 'discard', cardId });
    expect(s.hand).toHaveLength(5); expect(s.discard).toContain(cardId); expect(s.mustDiscard).toBe(false); expect(s.intent.rest).toBe(true);
  });
  it.each(['A', 'B'] as const)('all advertised commands remain legal under %s takeover', seat => {
    const s = setControl(createGame({ coop: true }), seat); expect(getActiveActor(s)).toBe(seat);
    const commands = legalActions(s, undefined, seat); expect(commands.some(a => 'unitId' in a && a.unitId === 'queen')).toBe(true);
    expect(commands.some(a => 'unitId' in a && a.unitId === 'rook')).toBe(true);
    for (const action of commands) expect(() => applyAction(s, action, seat)).not.toThrow();
    expect(legalActions(s, undefined, seat === 'A' ? 'B' : 'A')).toEqual([]);
  });
  it('SDK helper searches only the visible phase, independent of future shuffle and seed', () => {
    const s = createGame(), other = structuredClone(s); other.secret!.runSeed = 123; other.secret!.playerDeck.reverse(); other.secret!.bossDeck.reverse();
    const budget = { maxDepth: 2, maxNodes: 100, maxTimeMs: Infinity, temperature: 0 };
    const first = suggestAction(s, budget), second = suggestAction(other, budget), visible = suggestAction(publicView(s), budget);
    expect(first.action).toEqual(second.action); expect(first.action).toEqual(visible.action); expect(first.diagnostics.nodes).toBeGreaterThan(0);
    expect(() => applyAction(s, first.action!)).not.toThrow(); expect(s.assisted).toBe(false);
  });
});
