import { searchGame } from '@chess-2/engine-sdk';
import type { GameAdapter, SearchBudget, SearchResult } from '@chess-2/engine-sdk';
import { applyAction, bodyDistance, getActiveActor, legalActions, previewResponse, publicView, rank } from '../core';
import type { Action, GameState } from '../core';

interface AnalysisState { game: GameState; responseResolved: boolean }
type Side = 'army' | 'boss';
export const HINT_BUDGET: SearchBudget = { maxDepth: 3, maxNodes: 2400, maxTimeMs: 350, temperature: 0 };

/** Evaluate only the currently announced response. No unknown future card or intent is searched. */
export function evaluatePosition(state: GameState, responseResolved = false): number {
  const s = responseResolved || state.phase !== 'army' || state.mustDiscard ? state : previewResponse(state).state;
  if (s.outcome?.winner === 'boss' || !s.units.some(u => u.type === 'K' && u.hp > 0)) return -400000;
  if (s.boss.hp <= 0) return 400000;
  let value = -(s.boss.hp * 8 + s.boss.armor * 6) + s.focus * 0.6 + s.hand.length * 0.5;
  const nextPhase: GameState = { ...s, coop: false, control: 'shared', phase: 'army', commands: 3, mustDiscard: false,
    units: s.units.map(u => ({ ...u, activated: false })) };
  for (const u of s.units) {
    if (u.hp <= 0 || u.square === null) continue;
    if (u.type === 'K') { value += u.hp * 9; continue; }
    value += ({ Q: 24, R: 20, B: 16, N: 16, P: 9 }[u.type]) + u.hp * 2.5;
    value -= bodyDistance(s.boss, u.square) * 1.1;
    if (u.type === 'P') value += rank(u.square) * 0.65;
    if (legalActions(nextPhase, u.id, 'solo').some(a => a.type === 'attack')) value += 4;
  }
  return value;
}

export const colossusPhaseAdapter: GameAdapter<AnalysisState, Action, Side> = {
  id: 'colossus-announced-phase', version: '1', information: 'perfect',
  player: () => 'army',
  legalActions: s => s.responseResolved ? [] : legalActions(s.game, undefined, getActiveActor(s.game)).filter(a => a.type !== 'surrender' && a.type !== 'transfer'),
  outcomes: () => [{ chance: undefined, weight: 1 }],
  apply: (s, action) => action.type === 'end'
    ? { game: previewResponse(s.game).state, responseResolved: true }
    : { game: applyAction(s.game, action, getActiveActor(s.game)), responseResolved: false },
  terminal: s => s.game.boss.hp <= 0 ? { winner: 'army' } : s.game.outcome ? { winner: s.game.outcome.winner } : null,
  evaluate: (s, side) => evaluatePosition(s.game, s.responseResolved) * (side === 'army' ? 1 : -1),
  actionKey: a => JSON.stringify(a),
  orderActions: (s, actions) => actions.map(action => {
    const next = action.type === 'end' ? previewResponse(s.game).state : applyAction(s.game, action, getActiveActor(s.game));
    return { action, priority: evaluatePosition(next, action.type === 'end') };
  }),
  // This adapter counts individual decisions in the visible phase, not entire matches.
  turnsElapsed: () => 1,
  canEvaluate: () => true,
  cacheIdentity: s => ({ position: JSON.stringify({ ...s.game, revision: 0, events: [], secret: null, responseResolved: s.responseResolved }), history: 'visible-phase-v1' }),
};

export function suggestAction(state: GameState, budget: SearchBudget = HINT_BUDGET): SearchResult<Action> {
  const visible = publicView(state);
  // Promotions, camp and mandatory discard have legal deterministic choices and require no hidden draw search.
  if (visible.phase !== 'army' || visible.mustDiscard) {
    const action = legalActions(visible, undefined, getActiveActor(visible)).find(a => a.type !== 'surrender') ?? null;
    return { action, diagnostics: { depth: 0, nodes: 0, elapsedMs: 0, stopReason: 'max-depth', score: null }, principalVariation: [] };
  }
  return searchGame(colossusPhaseAdapter, { game: visible, responseResolved: false }, budget);
}
