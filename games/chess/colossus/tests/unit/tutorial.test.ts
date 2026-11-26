import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, validateState } from '../../src/core';
import type { Action, GameState } from '../../src/core';
import { lessonComplete, lessonState } from '../../src/ui/tutorial';

function step(state: GameState, action: Action): GameState {
  const result = applyAction(state, action);
  expect(validateState(result)).toEqual([]);
  return result;
}

describe('playable tutorial lessons', () => {
  it('teaches armor removal followed by an HP strike', () => {
    let state = lessonState(0);
    state = step(state, { type: 'attack', unitId: 'rook', target: 43 });
    expect([state.boss.armor, state.boss.hp]).toEqual([0, 28]);
    const action: Action = { type: 'attack', unitId: 'queen', target: 43 };
    const after = step(state, action);
    expect(lessonComplete(0, state, after, action)).toBe(true);
  });

  it('allows a knight strike with a different retreat square', () => {
    const state = lessonState(1);
    const action = legalActions(state, 'knight').find(a => a.type === 'attack' && a.retreat !== 37)!;
    expect(action).toBeDefined();
    const after = step(state, action);
    expect(after.units.find(u => u.id === 'knight')!.square).not.toBe(37);
    expect(lessonComplete(1, state, after, action)).toBe(true);
  });

  it.each([false, true])('shows actual ray/fire protection (fire=%s)', fire => {
    const state = lessonState(2, fire), action: Action = { type: 'end' };
    const after = step(state, action);
    expect(lessonComplete(2, state, after, action, fire)).toBe(true);
  });

  it('consumes the shield before the second separate packet', () => {
    const guarded = step(lessonState(3), { type: 'guard', unitId: 'pawn-e' });
    const action: Action = { type: 'end' }, after = step(guarded, action);
    expect(lessonComplete(3, guarded, after, action)).toBe(true);
  });

  it('pays focus for two-response invulnerability', () => {
    const protectedState = step(lessonState(4), { type: 'card', cardId: 'marble-vow', targets: ['king'] });
    expect(protectedState.focus).toBe(0);
    const action: Action = { type: 'end' }, after = step(protectedState, action);
    expect(after.units.find(u => u.id === 'king')!.hp).toBe(20);
    expect(lessonComplete(4, protectedState, after, action)).toBe(true);
  });

  it('uses three commands, resolves combat, then attacks the frozen Rest intent', () => {
    let state = lessonState(5);
    for (const unitId of ['rook', 'queen', 'knight']) state = step(state, { type: 'guard', unitId });
    expect(state.commands).toBe(0);
    state = step(state, { type: 'end' });
    expect(state.intent.rest).toBe(true);
    const action: Action = { type: 'attack', unitId: 'rook', target: 43 };
    const after = step(state, action);
    expect(state.boss.hp - after.boss.hp).toBe(4);
    expect(lessonComplete(5, state, after, action)).toBe(true);
  });
});
