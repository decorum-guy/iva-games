import { describe, expect, it } from 'vitest';
import { applyAction, BOSSES, BOSS_BEHAVIORS, CAMPAIGN_BOSSES, createGame, createTutorialGame, HUNT_BOSSES, legalActions, planIntent, publicView, restoreGame, validateState } from '../../src/core';
import type { Action, CreateOptions, GameState } from '../../src/core';
import { isLessonActionAllowed, LESSONS, lessonComplete, lessonGuidance, lessonState, tutorialProbe } from '../../src/ui/tutorial';

function step(state: GameState, action: Action): GameState {
  const result = applyAction(state, action);
  expect(validateState(result)).toEqual([]);
  return result;
}

describe('tutorial-only Warden', () => {
  it('has its own opponent, mode and deterministic public policy', () => {
    const state = createTutorialGame();
    expect(state).toMatchObject({ mode: 'tutorial', boss: { id: 'sentinel' }, coop: false, assisted: true, bossCardsEnabled: false, roundLimit: null });
    expect(validateState(state)).toEqual([]);
    expect(planIntent(state)).toEqual(planIntent(publicView(state)));
    expect(restoreGame(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(HUNT_BOSSES).toEqual(['regent', 'spire', 'archivist']);
    expect(CAMPAIGN_BOSSES).not.toContain('sentinel');
    expect(Object.keys(BOSS_BEHAVIORS).sort()).toEqual(Object.keys(BOSSES).sort());
    expect(Object.values(BOSSES).filter(b => !b.tutorialOnly).map(b => b.id)).toEqual(HUNT_BOSSES);
  });

  it.each(['hunt', 'campaign', 'practice'])('rejects Warden through ordinary %s creation at runtime', mode => {
    expect(() => createGame({ mode, boss: 'sentinel' } as unknown as CreateOptions)).toThrow('invalid-boss');
    expect(() => createGame({ mode: 'tutorial' } as unknown as CreateOptions)).toThrow('invalid-mode');
    const imported = createTutorialGame();
    imported.mode = mode as GameState['mode'];
    imported.roundLimit = mode === 'practice' ? null : 24;
    expect(validateState(imported)).toContain('tutorial-only');
  });

  it('rejects production opponents or shared control in tutorial saves', () => {
    const ordinary = createGame();
    ordinary.mode = 'tutorial'; ordinary.roundLimit = null; ordinary.assisted = true; ordinary.bossCardsEnabled = false;
    expect(validateState(ordinary)).toContain('tutorial-only');
    const tutorial = createTutorialGame(); tutorial.coop = true;
    expect(validateState(tutorial)).toContain('tutorial-only');
  });
});

describe('short playable tutorial', () => {
  it('all seven lessons validate and teach with legal engine actions', () => {
    expect(LESSONS).toHaveLength(7);
    expect(tutorialProbe()).toBe(true);
    for (let index = 0; index < LESSONS.length; index++) {
      const state = lessonState(index), guidance = lessonGuidance(index, state);
      expect(guidance.actions.length).toBeGreaterThan(0);
      for (const action of guidance.actions) {
        expect(legalActions(state)).toContainEqual(action);
        expect(isLessonActionAllowed(index, state, action)).toBe(true);
        expect(() => step(state, action)).not.toThrow();
      }
    }
  });

  it('guided actions complete every scene and the final scene genuinely wins', () => {
    for (let index = 0; index < LESSONS.length; index++) for (const fire of index === 3 ? [false, true] : [false]) {
      let state = lessonState(index, fire), completed = false;
      for (let count = 0; count < 6 && !completed; count++) {
        const guidance = lessonGuidance(index, state, fire), action = guidance.actions[0];
        expect(action, 'guided action at lesson ' + index).toBeDefined();
        const after = step(state, action);
        completed = lessonComplete(index, state, after, action, fire);
        state = after;
      }
      expect(completed, 'completed lesson ' + index).toBe(true);
      if (index === LESSONS.length - 1) {
        expect(state.outcome).toMatchObject({ winner: 'army', reason: 'boss-defeated' });
        expect(state.units.find(u => u.id === 'pawn-c')).toMatchObject({ type: 'Q', hp: 2, maxHp: 6, activated: true });
        expect(state.events.map(e => e.type)).toContain('victory');
      }
    }
  });

  it('the first lesson prevents ending into the ray, then teaches a real safe response', () => {
    let state = lessonState(0);
    expect(isLessonActionAllowed(0, state, { type: 'end' })).toBe(false);
    expect(isLessonActionAllowed(0, state, { type: 'move', unitId: 'king', to: 12 })).toBe(false);
    state = step(state, { type: 'move', unitId: 'king', to: 3 });
    expect(lessonGuidance(0, state).actions).toEqual([{ type: 'end' }]);
    const after = step(state, { type: 'end' });
    expect(after.units.find(u => u.id === 'king')!.hp).toBe(20);
  });

  it('breaks armor before exposing HP without changing the announced intent', () => {
    let state = lessonState(1); const intent = structuredClone(state.intent);
    state = step(state, { type: 'attack', unitId: 'rook', target: 43 });
    expect([state.boss.armor, state.boss.hp]).toEqual([0, 12]);
    expect(state.intent).toEqual(intent);
    expect(lessonGuidance(1, state).actions.every(a => a.type === 'attack' && a.unitId === 'queen')).toBe(true);
    state = step(state, { type: 'attack', unitId: 'queen', target: 43 });
    expect(state.boss.hp).toBe(9);
  });

  it('retreat completes atomically and a pointless return is omitted from the exercise', () => {
    const state = lessonState(2), action = lessonGuidance(2, state).actions[0];
    expect(action.type).toBe('attack');
    if (action.type !== 'attack') throw new Error('Expected a knight attack');
    expect(action.retreat).not.toBe(37);
    const after = step(state, action);
    expect(after.units.find(u => u.id === 'knight')!.square).toBe(action.retreat);
    expect(after.commands).toBe(2);
  });

  it.each([false, true])('shows ray/fire protection from real damage (fire=%s)', fire => {
    const state = lessonState(3, fire), action: Action = { type: 'end' };
    expect(lessonComplete(3, state, step(state, action), action, fire)).toBe(true);
  });

  it('consumes shield before the second packet', () => {
    const guarded = step(lessonState(4), { type: 'guard', unitId: 'pawn-e' });
    const after = step(guarded, { type: 'end' });
    expect(after.events.filter(e => e.type === 'damage').map(e => [e.amount, e.absorbed])).toEqual([[0, 1], [1, 0]]);
  });

  it('pays focus but no army command for a two-response ward', () => {
    const state = step(lessonState(5), { type: 'card', cardId: 'marble-vow', targets: ['king'] });
    expect([state.focus, state.commands]).toEqual([0, 3]);
    const after = step(state, { type: 'end' });
    expect(after.units.find(u => u.id === 'king')).toMatchObject({ hp: 20, invulnerable: 1 });
  });

  it('asks for queen explicitly, then shows recovery before the winning strike', () => {
    let state = lessonState(6);
    expect(lessonGuidance(6, state).actions).toEqual([{ type: 'move', unitId: 'pawn-c', to: 58, promotion: 'Q' }]);
    state = step(state, { promotion: 'Q', to: 58, unitId: 'pawn-c', type: 'move' });
    expect(state.events.map(e => e.type)).toEqual(['move', 'promote']);
    expect(state.units.find(u => u.id === 'pawn-c')!.hp).toBe(2);
    state = step(state, { type: 'end' });
    expect(state.round).toBe(4); expect(state.intent.rest).toBe(true);
    const action = lessonGuidance(6, state).actions[0], won = step(state, action);
    expect(lessonComplete(6, state, won, action)).toBe(true);
    expect(lessonGuidance(6, won).actions).toEqual([]);
  });

  it('tutorial gating compares action meaning, not object field order', () => {
    expect(isLessonActionAllowed(6, lessonState(6), { promotion: 'Q', to: 58, type: 'move', unitId: 'pawn-c' })).toBe(true);
    expect(() => lessonState(-1)).toThrow();
    expect(() => lessonState(7)).toThrow();
  });
});
