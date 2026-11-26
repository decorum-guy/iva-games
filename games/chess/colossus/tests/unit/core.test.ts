import { describe, expect, it } from 'vitest';
import { applyAction, BASE_DECK, BOSS_CARD_LIST, CARDS, createGame, editPractice, getActiveActor, getLeader, legalActions, legalCardActions, planIntent, previewResponse, publicView, restoreGame, setControl, squareFromName, undoGame, validateDeck, validateState } from '../../src/core';
import type { Action, BossId, GameState, IntentStep } from '../../src/core';

const sq = squareFromName;
const label = { ru: 'Проверка', en: 'Probe' };
function position(boss: BossId = 'regent', units: Array<[string, string, number]> = [['king', 'h1', 20]]): GameState {
  const state = createGame({ boss, mode: 'practice', bossCards: false, seed: 'test' });
  for (const u of state.units) { u.hp = 0; u.square = null; }
  for (const [id, square, hp] of units) { const u = state.units.find(u => u.id === id)!; u.hp = hp; u.square = sq(square); }
  state.intent = { name: label, pattern: 1, rest: false, steps: [], bossCard: null, cancelledStep: null };
  return state;
}
function withSteps(state: GameState, steps: IntentStep[]): GameState { state.intent.steps = steps; return state; }
const beam = (cells: string[], damage = 2, requires?: number): IntentStep => ({ kind: 'rays', label, cells: cells.map(sq), rays: [cells.map(sq)], damage, requires });
const unit = (state: GameState, id: string) => state.units.find(u => u.id === id)!;
function nextSafeRound(state: GameState): GameState {
  let s = structuredClone(state);
  for (const u of s.units) if (u.hp > 0) u.invulnerable = 2;
  if (s.mustDiscard) s = applyAction(s, { type: 'discard', cardId: s.hand[s.hand.length - 1] });
  s = applyAction(s, { type: 'end' });
  while (s.phase === 'promotion') s = applyAction(s, { type: 'promote', unitId: s.pendingPromotions[0], promotion: 'Q' });
  return s;
}

describe('Colossus commands and damage', () => {
  it('creates the full army and deterministic private decks without touching the input options', () => {
    const a = createGame({ seed: 'same' }), b = createGame({ seed: 'same' });
    expect(a).toEqual(b); expect(a.units.reduce((sum, u) => sum + u.hp, 0)).toBe(42);
    expect(a.hand).toEqual(['bandage', 'stone-skin', 'sharp-edge']); expect(validateState(a)).toEqual([]);
  });
  it.each(['regent', 'spire', 'archivist'] as const)('uses rounded difficulty parameters for %s', boss => {
    const normal = createGame({ boss, difficulty: 'knight' }), easy = createGame({ boss, difficulty: 'initiate' }), abyss = createGame({ boss, difficulty: 'abyss' });
    expect(easy.commands).toBe(4); expect(easy.boss.hp).toBe(Math.ceil(normal.boss.hp * 4 / 5));
    expect(abyss.boss.armor).toBe(Math.ceil(normal.boss.armor * 27 / 20));
  });
  it('resolves rook / queen / exposed bishop in order and never sacrifices attackers', () => {
    let s = position('regent', [['king', 'h1', 20], ['rook', 'd3', 4], ['queen', 'f4', 6], ['bishop', 'b4', 3]]);
    s.boss.armor = 6; s.boss.hp = 20;
    const original = structuredClone(s);
    s = applyAction(s, { type: 'attack', unitId: 'rook', target: sq('d6') });
    expect([s.boss.armor, s.boss.hp]).toEqual([2, 20]);
    s = applyAction(s, { type: 'attack', unitId: 'queen', target: sq('d6') });
    s = applyAction(s, { type: 'attack', unitId: 'bishop', target: sq('d6') });
    expect([s.boss.armor, s.boss.hp, s.commands]).toEqual([0, 16, 0]);
    expect(unit(s, 'rook').hp).toBe(4); expect(unit(s, 'bishop').hp).toBe(3);
    expect(original.boss.armor).toBe(6); expect(original.units.every(u => !u.activated)).toBe(true);
  });
  it('bishop chooses its damage before crossing the last armor point', () => {
    let s = position('regent', [['king', 'h1', 20], ['bishop', 'b4', 3]]); s.boss.armor = 1; s.boss.hp = 20;
    s = applyAction(s, { type: 'attack', unitId: 'bishop', target: sq('d6') });
    expect([s.boss.armor, s.boss.hp]).toEqual([0, 19]);
  });
  it('recovery bonus applies to one unit activation but not direct armor cards', () => {
    let s = position('regent', [['king', 'h1', 20], ['rook', 'd3', 4]]); s.intent.rest = true; s.boss.armor = 6;
    s.hand = ['wedge']; s.focus = 5;
    s = applyAction(s, { type: 'card', cardId: 'wedge' }); expect(s.boss.armor).toBe(2);
    s = applyAction(s, { type: 'attack', unitId: 'rook', target: sq('d6') });
    expect([s.boss.armor, s.boss.hp]).toEqual([0, 25]);
  });
  it('does not replan an already announced response after armor breaks', () => {
    let s = position('regent', [['king', 'h1', 20], ['rook', 'd3', 4]]); s.boss.armor = 1;
    s.intent = planIntent(s); const frozen = structuredClone(s.intent);
    s = applyAction(s, { type: 'attack', unitId: 'rook', target: sq('d6') });
    expect(s.boss.armor).toBe(0); expect(s.intent).toEqual(frozen);
  });
  it('keeps ordinary moves and attacks in the same once-per-round activation budget', () => {
    const s = createGame(); const move = legalActions(s, 'knight').find(a => a.type === 'move')!;
    const moved = applyAction(s, move); expect(legalActions(moved, 'knight')).toEqual([]);
    expect(() => applyAction(moved, { type: 'guard', unitId: 'knight' })).toThrow();
    expect(s.commands).toBe(3);
  });
  it('blocks rays with allies and preserves shorter attack ranges', () => {
    const s = position('regent', [['king', 'h1', 20], ['rook', 'd3', 4], ['pawn-c', 'd4', 2]]);
    expect(legalActions(s, 'rook').some(a => a.type === 'attack')).toBe(false);
    unit(s, 'pawn-c').square = null; unit(s, 'pawn-c').hp = 0; unit(s, 'rook').square = sq('d1');
    expect(legalActions(s, 'rook').some(a => a.type === 'attack')).toBe(false);
    expect(legalActions(s, 'rook').some(a => a.type === 'move' && a.to === sq('d5'))).toBe(true);
  });
  it('pawn lunge is one non-sacrificial activation with a required target', () => {
    let s = position('regent', [['king', 'h1', 20], ['pawn-c', 'c4', 2]]);
    s = applyAction(s, { type: 'attack', unitId: 'pawn-c', target: sq('d6'), lunge: true });
    expect(unit(s, 'pawn-c').square).toBe(sq('c5')); expect(unit(s, 'pawn-c').hp).toBe(2); expect(s.commands).toBe(2);
    const bad = position('regent', [['king', 'h1', 20], ['pawn-c', 'a2', 2]]);
    expect(() => applyAction(bad, { type: 'attack', unitId: 'pawn-c', target: sq('d6'), lunge: true })).toThrow();
    expect(unit(bad, 'pawn-c').square).toBe(sq('a2'));
  });
  it('knight must specify a legal retreat, including on a killing blow', () => {
    const s = position('regent', [['king', 'h1', 20], ['knight', 'b5', 3]]); s.boss.armor = 0; s.boss.hp = 2;
    expect(() => applyAction(s, { type: 'attack', unitId: 'knight', target: sq('d6') })).toThrow();
    const won = applyAction(s, { type: 'attack', unitId: 'knight', target: sq('d6'), retreat: sq('f5') });
    expect(won.phase).toBe('finished'); expect(won.outcome?.winner).toBe('army'); expect(unit(won, 'knight').square).toBe(sq('f5'));
    expect(unit(won, 'knight').hp).toBe(3);
  });
  it.each(['Q', 'R', 'B', 'N'] as const)('promotion to %s preserves wounded HP and activation', promotion => {
    const s = position('regent', [['king', 'h1', 20], ['pawn-c', 'a7', 1]]);
    const next = applyAction(s, { type: 'move', unitId: 'pawn-c', to: sq('a8'), promotion });
    expect(unit(next, 'pawn-c')).toMatchObject({ type: promotion, hp: 1, activated: true, owner: 'B' });
    expect(legalActions(next, 'pawn-c')).toEqual([]);
  });
});

describe('Colossus announced response and atomic contacts', () => {
  it('a dying blocker fully protects the king from one ray but not a later ray', () => {
    const s = withSteps(position('regent', [['king', 'd1', 20], ['pawn-c', 'd3', 2]]), [beam(['d5', 'd4', 'd3', 'd2', 'd1'])]);
    const first = previewResponse(s); expect(first.damage['pawn-c']).toBe(2); expect(first.damage.king).toBe(0);
    s.intent.steps.push(beam(['d5', 'd4', 'd3', 'd2', 'd1'], 3));
    const two = previewResponse(s); expect(two.damage.king).toBe(3); expect(two.deaths).toContain('pawn-c');
  });
  it('spends a shield once across multiple packets, not once per hit', () => {
    const s = withSteps(position('regent', [['king', 'h1', 20], ['pawn-c', 'd3', 2]]), [beam(['d5', 'd4', 'd3'], 1), beam(['d5', 'd4', 'd3'], 1)]);
    unit(s, 'pawn-c').shield = 1;
    const result = previewResponse(s); expect(result.damage['pawn-c']).toBe(1); expect(unit(result.state, 'pawn-c').shield).toBe(0);
  });
  it('invulnerability blocks packets, preserves shield until expiry and consumes a response on rest', () => {
    const s = withSteps(position('regent', [['king', 'd1', 20]]), [beam(['d5', 'd4', 'd3', 'd2', 'd1'], 3)]);
    unit(s, 'king').invulnerable = 2; unit(s, 'king').shield = 2;
    const result = previewResponse(s); expect(result.damage.king).toBe(0); expect(unit(result.state, 'king').invulnerable).toBe(1);
    expect(result.events.find(e => e.type === 'damage')?.absorbed).toBe(0);
    s.intent.rest = true; s.intent.steps = []; expect(unit(previewResponse(s).state, 'king').invulnerable).toBe(1);
  });
  it('blocked heavy push keeps contact damage but cancels movement and dependent rays', () => {
    const s = position('regent', [['king', 'h1', 20], ['pawn-c', 'd5', 2], ['rook', 'd4', 4]]);
    unit(s, 'pawn-c').shield = 1;
    withSteps(s, [{ kind: 'move', moveMode: 'ram', from: sq('d6'), path: [sq('d5')], cells: [sq('d5'), sq('e5')], damage: 2, label }, beam(['d4', 'd3', 'd2', 'd1'], 2, 0)]);
    const p = previewResponse(s); expect(p.state.boss.anchor).toBe(sq('d6'));
    expect(unit(p.state, 'pawn-c')).toMatchObject({ square: sq('d5'), hp: 1 }); expect(unit(p.state, 'rook').hp).toBe(4);
    expect(p.blockedSteps).toEqual([0, 1]);
  });
  it('a successful ram can hit the pushed figure again with its dependent ray', () => {
    const s = position('regent', [['king', 'h1', 20], ['rook', 'd5', 4]]);
    withSteps(s, [{ kind: 'move', moveMode: 'ram', from: sq('d6'), path: [sq('d5')], cells: [sq('d5'), sq('e5')], damage: 2, label }, beam(['d4', 'd3', 'd2', 'd1'], 2, 0)]);
    const p = previewResponse(s); expect(p.state.boss.anchor).toBe(sq('d5')); expect(unit(p.state, 'rook').hp).toBe(0);
    expect(p.events.filter(e => e.type === 'damage' && e.unitId === 'rook').map(e => e.amount)).toEqual([2, 2]);
  });
  it('bounds reject a boss step before any contact can happen', () => {
    const s = position(); s.boss.anchor = sq('a1'); unit(s, 'king').square = sq('h8');
    withSteps(s, [{ kind: 'move', moveMode: 'ram', from: sq('a1'), path: [-1], cells: [], damage: 2, label }]);
    const p = previewResponse(s); expect(p.state.boss.anchor).toBe(sq('a1')); expect(p.events.some(e => e.type === 'damage')).toBe(false);
  });
  it('a fast dash stops at a survivor and never performs its endpoint attack', () => {
    const s = position('spire', [['king', 'h1', 20], ['pawn-c', 'e5', 2]]);
    withSteps(s, [{ kind: 'move', moveMode: 'dash', from: sq('e6'), path: [sq('e5'), sq('e4')], cells: [sq('e5'), sq('e4')], damage: 1, label }, beam(['f4', 'g4', 'h4'], 2, 0)]);
    const p = previewResponse(s); expect(p.state.boss.anchor).toBe(sq('e6')); expect(unit(p.state, 'pawn-c').hp).toBe(1); expect(p.blockedSteps).toEqual([0, 1]);
  });
  it('two-cell jump fails atomically if one landing blocker survives', () => {
    const s = position('archivist', [['king', 'h1', 20], ['rook', 'f6', 4]]);
    withSteps(s, [{ kind: 'move', moveMode: 'jump', from: sq('d6'), path: [sq('f6')], cells: [sq('f6'), sq('f7')], damage: 2, label }]);
    const p = previewResponse(s); expect(p.state.boss.anchor).toBe(sq('d6')); expect(unit(p.state, 'rook').hp).toBe(2);
  });
  it('pushed pawn promotes only after the entire response and before a new draw', () => {
    const s = position('regent', [['king', 'h1', 20], ['pawn-c', 'd7', 2]]); s.boss.anchor = sq('d5'); unit(s, 'pawn-c').shield = 2;
    withSteps(s, [{ kind: 'move', moveMode: 'ram', from: sq('d5'), path: [sq('d6')], cells: [sq('d7'), sq('e7')], damage: 2, label }]);
    const pending = applyAction(s, { type: 'end' }); expect(pending.phase).toBe('promotion'); expect(pending.round).toBe(1);
    expect(unit(pending, 'pawn-c')).toMatchObject({ type: 'P', square: sq('d8'), hp: 2 });
    const next = applyAction(pending, { type: 'promote', unitId: 'pawn-c', promotion: 'N' });
    expect(next.round).toBe(2); expect(next.hand).toHaveLength(4); expect(unit(next, 'pawn-c')).toMatchObject({ type: 'N', hp: 2, activated: false });
  });
  it('old and new fire are distinct packets while a multiline cast hits an intersection once', () => {
    const s = position('archivist', [['king', 'h1', 20], ['rook', 'c3', 4]]); s.fire = [sq('c3')];
    withSteps(s, [{ kind: 'fire', label, cells: [sq('c3'), sq('c3'), sq('c4')], damage: 1 }]);
    const p = previewResponse(s); expect(p.damage.rook).toBe(2); expect(p.state.fire).toEqual([sq('c3'), sq('c4')]);
  });
  it('killing the boss stops later old-fire damage and never creates a second result', () => {
    const s = position('regent', [['king', 'h1', 1], ['rook', 'd3', 4]]); s.boss.hp = 1; s.boss.armor = 0; s.fire = [sq('h1')];
    const won = applyAction(s, { type: 'attack', unitId: 'rook', target: sq('d6') });
    expect(won.outcome?.winner).toBe('army'); expect(unit(won, 'king').hp).toBe(1);
    expect(() => applyAction(won, { type: 'end' })).toThrow('finished');
    expect(won.events.filter(e => e.type === 'victory')).toHaveLength(1);
  });
  it('limit resolves after the full final response and a killing blow within it is allowed', () => {
    const s = position(); s.mode = 'hunt'; s.round = 24;
    expect(applyAction(s, { type: 'end' }).outcome?.reason).toBe('limit');
  });
});

describe('cards and finite economy', () => {
  it('has sixteen player cards and exactly three different boss cards per boss', () => {
    expect(Object.keys(CARDS)).toHaveLength(16);
    for (const boss of ['regent', 'spire', 'archivist']) expect(BOSS_CARD_LIST.filter(c => c.boss === boss)).toHaveLength(3);
    expect(validateDeck(BASE_DECK)).toEqual([]);
    expect(validateDeck([...BASE_DECK.slice(0, 11), 'bandage'])).not.toEqual([]);
  });
  it('card play costs focus but no command and cannot be repeated in a phase', () => {
    const s = createGame(); const next = applyAction(s, { type: 'card', cardId: 'stone-skin', targets: ['king'] });
    expect(next.commands).toBe(3); expect(next.focus).toBe(2); expect(next.hand).not.toContain('stone-skin');
    expect(legalCardActions(next, 'sharp-edge')).toEqual([]);
  });
  it('healing is finite, never revives and never heals the king', () => {
    const s = createGame(); unit(s, 'queen').hp = 5;
    expect(legalCardActions(s, 'bandage')).toEqual([{ type: 'card', cardId: 'bandage', targets: ['queen'] }]);
    const next = applyAction(s, { type: 'card', cardId: 'bandage', targets: ['queen'] }); expect(unit(next, 'queen').hp).toBe(6);
    expect(() => applyAction(s, { type: 'card', cardId: 'bandage', targets: ['king'] })).toThrow();
  });
  it('reposition and swap spend activations, not commands', () => {
    const s = createGame({ mode: 'practice' }); s.hand = ['swap']; s.focus = 5;
    const next = applyAction(s, { type: 'card', cardId: 'swap', targets: ['king', 'queen'] });
    expect(next.commands).toBe(3); expect(unit(next, 'king').activated).toBe(true); expect(unit(next, 'queen').activated).toBe(true);
    expect(unit(next, 'king').square).toBe(sq('d1')); expect(legalActions(next, 'queen')).toEqual([]);
  });
  it('extra command never reactivates a unit, including on four-command initiation', () => {
    let s = createGame({ difficulty: 'initiate', mode: 'practice' }); s.hand = ['counterorder']; s.focus = 5;
    s = applyAction(s, { type: 'guard', unitId: 'king' });
    s = applyAction(s, { type: 'card', cardId: 'counterorder' });
    expect(s.commands).toBe(4); expect(s.commandIndex).toBe(1); expect(legalActions(s, 'king')).toEqual([]);
  });
  it('disrupt can cancel an attack but cannot cancel contact movement or old fire', () => {
    const s = position('regent', [['king', 'h1', 20], ['rook', 'd5', 4]]); s.hand = ['disrupt']; s.focus = 5; s.fire = [sq('d5')];
    withSteps(s, [{ kind: 'move', moveMode: 'ram', from: sq('d6'), path: [sq('d5')], cells: [sq('d5'), sq('e5')], damage: 2, label }, beam(['d4', 'd3', 'd2', 'd1'], 2, 0)]);
    expect(legalCardActions(s, 'disrupt')).toEqual([{ type: 'card', cardId: 'disrupt', step: 1 }]);
    const next = applyAction(s, { type: 'card', cardId: 'disrupt', step: 1 });
    expect(previewResponse(next).damage.rook).toBe(3);
  });
  it('cannot renew invulnerability or stack shields', () => {
    const s = createGame({ mode: 'practice' }); s.hand = ['minor-vow', 'stone-skin']; s.focus = 5;
    unit(s, 'king').invulnerable = 1; unit(s, 'queen').shield = 2;
    expect(legalCardActions(s, 'minor-vow').some(a => a.type === 'card' && a.targets?.includes('king'))).toBe(false);
    expect(legalCardActions(s, 'stone-skin').some(a => a.type === 'card' && a.targets?.includes('queen'))).toBe(false);
  });
  it.each(['regent', 'spire', 'archivist'] as const)('draws %s cards on rounds 3/8/13 and preserves round-eight recovery', boss => {
    let s = createGame({ boss, mode: 'practice', seed: 4 });
    for (let target = 2; target <= 14; target++) {
      s = nextSafeRound(s);
      if (s.mustDiscard) s = applyAction(s, { type: 'discard', cardId: s.hand[0] });
      expect(s.round).toBe(target);
      expect(s.bossDeckRemaining).toBe(target < 3 ? 3 : target < 8 ? 2 : target < 13 ? 1 : 0);
      if (target === 8) { expect(s.intent.rest).toBe(true); expect(s.intent.bossCard).toBeNull(); expect(s.bossHand.length).toBeGreaterThan(0); }
      expect(new Set([...s.bossHand, ...s.bossDiscard, ...s.secret!.bossDeck]).size).toBe(3);
    }
    expect(s.deckRemaining).toBe(0); expect(s.hand.length + s.discard.length).toBe(12);
  });
  it('public preview does not consume or reveal a future draw', () => {
    const s = createGame({ seed: 'private-seed' }), visible = publicView(s);
    expect(visible.secret).toBeNull(); expect(JSON.stringify(visible)).not.toContain('runSeed');
    const p = previewResponse(visible); expect(p.state.secret).toBeNull(); expect(p.state.round).toBe(s.round);
    expect(p.state.hand).toEqual(s.hand); expect(p.state.deckRemaining).toBe(9);
    expect(() => applyAction(visible, { type: 'end' })).toThrow('private-state-required');
  });
  it('boss planning cannot see player hand or secret draw order', () => {
    const s = createGame({ boss: 'spire' }), other = structuredClone(s);
    other.hand = ['marble-vow']; other.secret = null;
    expect(planIntent(s)).toEqual(planIntent(other));
  });
});

describe('cooperative ownership, transfers and consent', () => {
  it('alternates commands and swaps round leadership', () => {
    let s = createGame({ coop: true, bossCards: false });
    expect(getActiveActor(s)).toBe('A');
    s = applyAction(s, { type: 'guard', unitId: 'rook' }, 'A'); expect(getActiveActor(s)).toBe('B');
    expect(() => applyAction(s, { type: 'guard', unitId: 'knight' }, 'A')).toThrow();
    expect(() => applyAction(s, { type: 'guard', unitId: 'knight' }, 'B')).toThrow();
    s = applyAction(s, { type: 'guard', unitId: 'queen' }, 'B'); s = applyAction(s, { type: 'guard', unitId: 'knight' }, 'A');
    expect(() => applyAction(s, { type: 'end' }, 'B')).toThrow();
    s = applyAction(s, { type: 'end' }, 'A'); expect(getLeader(s)).toBe('B');
  });
  it('allows only the leader to play the shared card, even during the other seat command', () => {
    let s = createGame({ coop: true }); s = applyAction(s, { type: 'guard', unitId: 'rook' }, 'A');
    expect(() => applyAction(s, { type: 'card', cardId: 'stone-skin', targets: ['king'] }, 'B')).toThrow();
    s = applyAction(s, { type: 'card', cardId: 'stone-skin', targets: ['king'] }, 'A');
    expect(s.commands).toBe(2); expect(getActiveActor(s)).toBe('B');
  });
  it('requires both early-end consents and stops advertising duplicate consent actions', () => {
    let s = createGame({ coop: true }); s = applyAction(s, { type: 'end' }, 'A');
    expect(s.round).toBe(1); expect(legalActions(s, undefined, 'A').some(a => a.type === 'end')).toBe(false);
    expect(legalActions(s, undefined, 'B').some(a => a.type === 'end')).toBe(true);
    s = applyAction(s, { type: 'end' }, 'B'); expect(s.round).toBe(2);
    s = applyAction(s, { type: 'surrender' }, 'B');
    expect(legalActions(s, undefined, 'B').some(a => a.type === 'surrender')).toBe(false);
    s = applyAction(s, { type: 'surrender' }, 'A'); expect(s.outcome?.reason).toBe('surrender');
  });
  it('transfers exactly the current slot without changing later slots', () => {
    let s = createGame({ coop: true }); s = applyAction(s, { type: 'transfer' }, 'A');
    expect(getActiveActor(s)).toBe('B'); expect(legalActions(s, undefined, 'B').some(a => a.type === 'transfer')).toBe(false);
    s = applyAction(s, { type: 'guard', unitId: 'queen' }, 'B');
    expect(getActiveActor(s)).toBe('B');
  });
  it('rejects a useless transfer to a partner without an unactivated living figure', () => {
    const s = createGame({ coop: true }); for (const u of s.units) if (u.owner === 'B') u.activated = true;
    expect(legalActions(s, undefined, 'A').some(a => a.type === 'transfer')).toBe(false);
    expect(() => applyAction(s, { type: 'transfer' }, 'A')).toThrow();
  });
  it('takeover grants every piece and card/end rights, with permanent assistance marking', () => {
    let s = setControl(createGame({ coop: true }), 'B');
    expect(getLeader(s)).toBe('B'); expect(getActiveActor(s)).toBe('B'); expect(s.assisted).toBe(true);
    s = applyAction(s, { type: 'guard', unitId: 'rook' }, 'B');
    s = applyAction(s, { type: 'card', cardId: 'stone-skin', targets: ['king'] }, 'B');
    s = applyAction(s, { type: 'end' }, 'B'); expect(s.round).toBe(2);
    expect(setControl(s, 'shared').assisted).toBe(true);
  });
});

describe('campaign, practice and saved state', () => {
  it('camp applies free healing once then revives with one HP and restores the next deck', () => {
    let s = createGame({ mode: 'campaign', seed: 'run' });
    s.phase = 'camp'; s.boss.hp = 0; unit(s, 'king').hp = 10; unit(s, 'rook').hp = 1; unit(s, 'pawn-c').hp = 0; unit(s, 'pawn-c').square = null;
    s = applyAction(s, { type: 'camp', reviveId: 'pawn-c' });
    expect(s.boss.id).toBe('spire'); expect(s.campaignIndex).toBe(1); expect(unit(s, 'king').hp).toBe(14); expect(unit(s, 'rook').hp).toBe(3);
    expect(unit(s, 'pawn-c')).toMatchObject({ hp: 1, square: sq('c2'), firstMove: true, owner: 'B' });
    expect(s.hand).toHaveLength(3); expect(s.focus).toBe(3); expect(() => applyAction(s, { type: 'camp', reviveId: 'pawn-c' })).toThrow();
    const restored = restoreGame(JSON.parse(JSON.stringify(s))); expect(restored).toEqual(s);
  });
  it('campaign ends on surrender or round limit, not only king death', () => {
    const s = createGame({ mode: 'campaign' }); expect(applyAction(s, { type: 'surrender' }).phase).toBe('finished');
    s.round = 24; s.intent.steps = [];
    expect(applyAction(s, { type: 'end' }).outcome?.reason).toBe('limit');
  });
  it('rejects invalid practice overlaps and preserves the original on failure', () => {
    const s = createGame({ mode: 'practice' }); const original = JSON.stringify(s);
    expect(() => editPractice(s, { units: [{ id: 'queen', square: unit(s, 'king').square }] })).toThrow();
    expect(JSON.stringify(s)).toBe(original);
  });
  it('undo stays within an army phase and marks the attempt assisted', () => {
    const original = createGame(), moved = applyAction(original, { type: 'guard', unitId: 'king' });
    const undo = undoGame(moved, original); expect(undo.assisted).toBe(true); expect(undo.commands).toBe(3); expect(undo.revision).toBe(2);
    const nextRound = applyAction(moved, { type: 'end' }); expect(() => undoGame(nextRound, original)).toThrow();
  });
  it.each([null, {}, { units: [null] }, { version: 'old' }])('rejects malformed saves safely: %j', value => {
    expect(validateState(value).length).toBeGreaterThan(0); expect(() => restoreGame(value)).toThrow();
  });
  it('validates legal action results and previews through a deterministic positional sequence', () => {
    let s = createGame({ seed: 'property', bossCards: true });
    for (let step = 0; step < 80 && s.phase !== 'finished'; step++) {
      expect(validateState(s)).toEqual([]);
      const preview = previewResponse(publicView(s)); expect(preview.state.secret).toBeNull();
      const candidates = legalActions(s).filter(a => a.type !== 'surrender' && a.type !== 'transfer');
      const actions = candidates.filter(a => a.type === 'attack');
      const choice: Action = s.mustDiscard ? candidates[0] : actions[0] ?? candidates.find(a => a.type === 'move') ?? candidates.find(a => a.type === 'end')!;
      expect(choice).toBeDefined();
      const before = JSON.stringify(s); const next = applyAction(s, choice);
      expect(JSON.stringify(s)).toBe(before); expect(next.revision).toBe(s.revision + 1); s = next;
    }
    expect(validateState(s)).toEqual([]);
  });
});
