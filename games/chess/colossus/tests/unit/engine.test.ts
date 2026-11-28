import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getActiveActor, legalActions, previewResponse, publicView } from '../../src/core';
import type { GameState } from '../../src/core';
import { colossusPhaseAdapter, suggestAction } from '../../src/engine/search';

const fallbackBudget = { maxDepth: 2, maxNodes: 0, maxTimeMs: Infinity, temperature: 0 };
function dangerPosition(): GameState {
  const state = createGame({ mode: 'practice', bossCards: false });
  for (const u of state.units) if (u.id !== 'king') { u.hp = 0; u.square = null; }
  state.units.find(u => u.id === 'king')!.hp = 1;
  state.hand = [];
  state.intent = { name: { ru: 'Луч', en: 'Ray' }, pattern: 1, rest: false, cancelledStep: null, bossCard: null,
    steps: [{ kind: 'rays', label: { ru: 'Луч', en: 'Ray' }, cells: [36, 28, 20, 12, 4], rays: [[36, 28, 20, 12, 4]], damage: 2 }] };
  return state;
}

describe('public-phase search safety and tactical quality', () => {
  it('returns a safe king rescue instead of throwing when fallback scores are near defeat', () => {
    const state = dangerPosition(), before = JSON.stringify(state);
    expect(previewResponse(state).kingDies).toBe(true);
    const result = suggestAction(state, fallbackBudget);
    expect(result.action).toMatchObject({ type: 'move', unitId: 'king' });
    expect(result.diagnostics.stopReason).toBe('node-limit');
    expect(previewResponse(applyAction(state, result.action!)).kingDies).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps a legal tactical fallback when the deadline has already expired', () => {
    const state = dangerPosition();
    const result = suggestAction(state, { ...fallbackBudget, maxNodes: 100, maxTimeMs: 0 });
    expect(result.diagnostics.stopReason).toBe('deadline');
    expect(legalActions(state)).toContainEqual(result.action);
    expect(previewResponse(applyAction(state, result.action!)).kingDies).toBe(false);
  });

  it('prefers a visible immediate victory over a doomed boss response', () => {
    const state = dangerPosition(), rook = state.units.find(u => u.id === 'rook')!;
    rook.hp = 4; rook.square = 19;
    state.boss.armor = 0; state.boss.hp = 1;
    const result = suggestAction(state, fallbackBudget);
    expect(result.action).toMatchObject({ type: 'attack', unitId: 'rook' });
    expect(applyAction(state, result.action!).outcome?.winner).toBe('army');
  });

  it('treats the last round as a real deadline without reading future cards', () => {
    const state = createGame({ bossCards: false });
    state.round = 24;
    state.intent = { name: { ru: 'Пауза', en: 'Pause' }, pattern: 0, rest: true, cancelledStep: null, bossCard: null, steps: [] };
    const resolved = colossusPhaseAdapter.apply({ game: publicView(state), responseResolved: false }, { type: 'end' }, undefined);
    expect(resolved.game.secret).toBeNull();
    expect(resolved.game.outcome).toEqual({ winner: 'boss', reason: 'limit', round: 24 });
    expect(colossusPhaseAdapter.terminal(resolved)).toEqual({ winner: 'boss' });
    expect(resolved.game.outcome).toEqual(applyAction(state, { type: 'end' }).outcome);
  });

  it('finds the final winning strike on the round deadline', () => {
    const state = createGame({ mode: 'practice', bossCards: false });
    state.round = 24; state.roundLimit = 24; state.boss.armor = 0; state.boss.hp = 3;
    state.units.find(u => u.id === 'rook')!.square = 19;
    const result = suggestAction(state, { maxDepth: 2, maxNodes: 250, maxTimeMs: Infinity, temperature: 0 });
    const next = applyAction(state, result.action!, getActiveActor(state));
    expect(next.outcome?.winner).toBe('army');
    expect(result.diagnostics.nodes).toBeGreaterThan(0);
  });

  it('reports no move for a finished game and preserves the saved result', () => {
    const state = applyAction(createGame(), { type: 'surrender' });
    const result = suggestAction(state);
    expect(result.action).toBeNull();
    expect(result.diagnostics.stopReason).toBe('no-legal-move');
    expect(state.outcome?.reason).toBe('surrender');
  });
});
