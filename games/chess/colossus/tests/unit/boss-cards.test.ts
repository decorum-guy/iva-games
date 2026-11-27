import { describe, expect, it } from 'vitest';
import { allLines, applyAction, BOSS_CARD_LIST, bodyDistance, bossCells, createGame, file, knightSquares, planIntent, previewResponse, rank, squareFromName, unique } from '../../src/core';
import type { HuntBossId, GameState } from '../../src/core';
const sq = squareFromName;

function prepared(boss: HuntBossId, card: string, pattern = 3): GameState {
  const s = createGame({ boss, mode: 'practice', seed: 9 });
  for (const u of s.units) if (u.id !== 'king') { u.hp = 0; u.square = null; }
  s.units[0].square = sq('h1');
  s.boss.nextPattern = pattern; s.boss.combatCount = pattern - 1;
  s.bossHand = [card]; s.secret!.bossDeck = BOSS_CARD_LIST.filter(c => c.boss === boss && c.id !== card).map(c => c.id); s.bossDeckRemaining = 2;
  s.intent = planIntent(s); return s;
}

describe('all nine boss cards use frozen, inspectable actions', () => {
  it('regent support shift has no contact and fails entirely against an occupied destination', () => {
    const s = prepared('regent', 'regent_reposition');
    expect(s.intent.bossCard).toBe('regent_reposition');
    expect(s.intent.steps[0]).toMatchObject({ kind: 'move', moveMode: 'step', damage: 0 });
    expect(s.intent.steps[1]).toMatchObject({ kind: 'area', damage: 2, requires: 0 });
    const future = { ...s.boss, anchor: s.intent.steps[0].path![0] };
    expect(s.intent.steps[1].cells.every(c => bodyDistance(future, c) === 1)).toBe(true);
    const occupied = bossCells(future).find(c => !bossCells(s.boss).includes(c))!;
    const rook = s.units.find(u => u.id === 'rook')!; rook.hp = 4; rook.square = occupied;
    const response = previewResponse(s);
    expect(response.state.boss.anchor).toBe(s.boss.anchor); expect(response.damage.rook).toBe(0);
    expect(response.blockedSteps).toEqual([0, 1]);
  });
  it('far gong hits the exact distance-two ring, not the adjacent ring or body', () => {
    const s = prepared('regent', 'regent_far_gong');
    expect(s.intent.steps).toHaveLength(1); expect(s.intent.steps[0].damage).toBe(2);
    expect(s.intent.steps[0].cells.every(c => bodyDistance(s.boss, c) === 2)).toBe(true);
    expect(s.intent.steps[0].cells.length).toBeGreaterThan(0);
  });
  it('opposing fracture is one simultaneous group of four blockable rays', () => {
    const s = prepared('regent', 'regent_crossfire');
    expect(s.intent.steps).toHaveLength(1); expect(s.intent.steps[0].kind).toBe('rays');
    expect(s.intent.steps[0].rays).toHaveLength(4); expect(s.intent.steps[0].damage).toBe(2);
  });
  it('spire retreat starts from the frozen planned endpoint and cannot adapt after a blocked dash', () => {
    const s = prepared('spire', 'spire_retreat', 1);
    const moveIndex = s.intent.steps.findIndex(step => step.kind === 'move');
    const dash = s.intent.steps[moveIndex], retreat = s.intent.steps.at(-1)!;
    expect(retreat).toMatchObject({ kind: 'move', moveMode: 'step', damage: 0, requires: moveIndex, from: dash.path!.at(-1) });
    const rook = s.units.find(u => u.id === 'rook')!; rook.hp = 4; rook.square = dash.path![0];
    const p = previewResponse(s);
    expect(p.state.boss.anchor).toBe(s.boss.anchor); expect(p.blockedSteps).toContain(s.intent.steps.length - 1);
    expect(s.intent.steps.at(-1)!.from).toBe(retreat.from);
  });
  it('knight fork replaces the last attack while retaining leap dependency', () => {
    const s = prepared('spire', 'spire_fork', 3);
    expect(s.intent.steps[0].moveMode).toBe('jump');
    const attack = s.intent.steps.at(-1)!;
    expect(attack.kind).toBe('area'); expect(attack.damage).toBe(2); expect(attack.requires).toBe(0);
    expect([...attack.cells].sort((a, b) => a - b)).toEqual(knightSquares(s.intent.steps[0].path![0]).sort((a, b) => a - b));
  });
  it('bent lunge preserves its opening ray when the bent dash and dependent closing ray are blocked', () => {
    const s = prepared('spire', 'spire_bent_dash');
    expect(s.intent.steps).toHaveLength(3);
    const opening = s.intent.steps[0], move = s.intent.steps[1], route = [move.from!, ...move.path!];
    expect(opening).toMatchObject({ kind: 'rays', damage: 1 });
    expect(opening.requires).toBeUndefined();
    expect(opening.rays).toHaveLength(1);
    expect([2, 3]).toContain(move.path!.length); expect(move.damage).toBe(1);
    const directions = route.slice(1).map((to, i) => [file(to) - file(route[i]), rank(to) - rank(route[i])]);
    expect(directions.every(([x, y]) => Math.abs(x) + Math.abs(y) === 1)).toBe(true);
    expect(directions.filter((d, i) => i > 0 && d.join(',') !== directions[i - 1].join(',')).length).toBe(1);
    expect(s.intent.steps[2]).toMatchObject({ kind: 'rays', damage: 2, requires: 1 });
    const blocker = s.units.find(u => u.id === 'rook')!; blocker.hp = 4; blocker.square = move.path![0];
    const firstRaySquare = opening.rays![0][0];
    if (firstRaySquare !== blocker.square) {
      const victim = s.units.find(u => u.id === 'pawn-c')!; victim.hp = 2; victim.square = firstRaySquare;
    }
    const response = previewResponse(s);
    expect(response.events.some(e => e.type === 'damage' && e.step === 0 && e.amount === 1)).toBe(true);
    expect(response.state.boss.anchor).toBe(s.boss.anchor);
    expect(response.blockedSteps).toEqual([1, 2]);
    expect(response.events.some(e => e.type === 'damage' && e.step === 2)).toBe(false);
  });
  it('parallel fire is a union of exactly two files or two ranks', () => {
    const s = prepared('archivist', 'archivist_parallel');
    const flame = s.intent.steps.find(step => step.kind === 'fire')!;
    expect(flame.cells).toHaveLength(16); expect(new Set(flame.cells).size).toBe(16);
    expect(new Set(flame.cells.map(file)).size === 2 || new Set(flame.cells.map(rank)).size === 2).toBe(true);
    expect(flame.requires).toBe(0); expect(s.intent.steps[0].kind).toBe('move');
  });
  it('cross fire hits its intersection once in each packet, while old fire remains separate', () => {
    const s = prepared('archivist', 'archivist_cross');
    const flame = s.intent.steps.find(step => step.kind === 'fire')!;
    expect(flame.cells).toHaveLength(15);
    const all = [...allLines('file'), ...allLines('rank')];
    const selected = all.filter(line => line.every(c => flame.cells.includes(c)));
    expect(selected).toHaveLength(2);
    const cross = selected[0].find(c => selected[1].includes(c))!;
    const rook = s.units.find(u => u.id === 'rook')!; rook.hp = 4; rook.square = cross;
    s.fire = [cross];
    // Isolate the spell's two damage packets; movement has its own independent tests.
    s.intent.steps = [{ ...flame, requires: undefined }];
    expect(previewResponse(s).damage.rook).toBe(2);
  });
  it('charred edge is one 28-square perimeter packet, including each corner once, and cannot repeat a fully active perimeter', () => {
    const s = prepared('archivist', 'archivist_border');
    s.fire = allLines('file')[0]; s.intent = planIntent(s);
    const flame = s.intent.steps.find(step => step.kind === 'fire')!;
    const perimeter = Array.from({ length: 64 }, (_, c) => c).filter(c => file(c) === 0 || file(c) === 7 || rank(c) === 0 || rank(c) === 7);
    expect(s.intent.bossCard).toBe('archivist_border');
    expect(flame.cells).toEqual(perimeter); expect(flame.cells).toHaveLength(28);
    expect(flame.requires).toBe(0); expect(s.intent.steps[0].kind).toBe('move');
    for (const [id, square] of [['rook', 'a1'], ['queen', 'a8'], ['knight', 'h8'], ['pawn-c', 'd3']] as const) {
      const unit = s.units.find(u => u.id === id)!; unit.hp = unit.maxHp; unit.square = sq(square);
    }
    s.fire = [];
    // Isolate the new cast and its following tick; movement dependencies are retained above.
    s.intent.steps = [{ ...flame, requires: undefined }];
    const first = previewResponse(s);
    for (const id of ['king', 'rook', 'queen', 'knight']) expect(first.damage[id]).toBe(1);
    expect(first.damage['pawn-c']).toBe(0); expect(first.state.fire).toEqual(perimeter);
    first.state.intent.steps = []; first.state.intent.rest = true;
    const tick = previewResponse(first.state);
    for (const id of ['king', 'rook', 'queen', 'knight']) expect(tick.damage[id]).toBe(1);
    expect(tick.state.fire).toEqual([]);
    s.fire = perimeter;
    expect(planIntent(s).bossCard).not.toBe('archivist_border');
  });
  it.each(BOSS_CARD_LIST.map(c => [c.boss, c.id] as const))('%s / %s plans only legal body cells and is frozen during army actions', (boss, card) => {
    const s = prepared(boss, card); const frozen = JSON.stringify(s.intent);
    for (const step of s.intent.steps) {
      expect(step.cells.every(c => Number.isInteger(c) && c >= 0 && c < 64)).toBe(true);
      expect(unique(step.cells)).toEqual([...step.cells].sort((a, b) => a - b));
      for (const anchor of step.path ?? []) expect(bossCells({ ...s.boss, anchor }).length).toBe(bossCells(s.boss).length);
    }
    const next = applyAction(s, { type: 'guard', unitId: 'king' }); expect(JSON.stringify(next.intent)).toBe(frozen);
  });
});
