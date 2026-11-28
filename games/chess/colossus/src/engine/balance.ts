import { applyAction, createGame, getActiveActor, legalActions, restoreGame, validateState } from '../core';
import type { Action, Difficulty, GameState, HuntBossId } from '../core';
import { suggestAction } from './search';

export interface BalanceOptions { boss: HuntBossId; difficulty: Difficulty; seed: number; bossCards: boolean; nodeCap?: number; maxActions?: number; mode?: 'hunt' | 'campaign' }
export function playBalanceGame(options: BalanceOptions) {
  const initial = createGame({ ...options, mode: options.mode ?? 'hunt' });
  let state = initial;
  const log: Array<{ action: Action; revision: number; round: number; bossHp: number; bossArmor: number; depth: number; nodes: number }> = [];
  const fail = (errors: string[], s: GameState) => { if (errors.length) throw new Error(`Invalid state at revision ${s.revision}: ${errors.join(',')}`); };
  for (let i = 0; i < (options.maxActions ?? 240) && state.phase !== 'finished'; i++) {
    fail(validateState(state), state);
    const result = suggestAction(state, { maxDepth: 2, maxNodes: options.nodeCap ?? 300, maxTimeMs: Infinity, temperature: 0 });
    const action = result.action ?? legalActions(state).find(a => a.type === 'end');
    if (!action) break;
    state = applyAction(state, action, getActiveActor(state));
    fail(validateState(state), state);
    log.push({ action, revision: state.revision, round: state.round, bossHp: state.boss.hp, bossArmor: state.boss.armor, depth: result.diagnostics.depth, nodes: result.diagnostics.nodes });
  }
  let replay = restoreGame(JSON.parse(JSON.stringify(initial)));
  for (const entry of log) replay = applyAction(replay, entry.action, getActiveActor(replay));
  if (JSON.stringify(replay) !== JSON.stringify(state)) throw new Error('Replay mismatch');
  return {
    options, finished: state.phase === 'finished', outcome: state.outcome, rounds: state.round, actions: log.length,
    bossHp: state.boss.hp, bossArmor: state.boss.armor, kingHp: state.units.find(u => u.type === 'K')!.hp,
    survivors: state.units.filter(u => u.hp > 0).length, bossCardsPlayed: state.bossDiscard.length,
    depths: log.reduce<Record<string, number>>((r, e) => { r[e.depth] = (r[e.depth] ?? 0) + 1; return r; }, {}),
    replayVerified: true, log, finalState: state,
  };
}
