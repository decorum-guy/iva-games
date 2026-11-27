import { CAMPAIGN_BOSSES } from './data';
import { bossCells, file, rank, shift, unitAt } from './geometry';
import type { GameState, Intent, IntentStep, Unit } from './types';

export function cloneGame(state: GameState): GameState {
  return {
    ...state, units: state.units.map(u => ({ ...u })), boss: { ...state.boss },
    intent: { ...state.intent, steps: state.intent.steps.map(s => ({ ...s, cells: [...s.cells], rays: s.rays?.map(r => [...r]), path: s.path && [...s.path] })) },
    fire: [...state.fire], hand: [...state.hand], discard: [...state.discard], selectedDeck: [...state.selectedDeck],
    pendingPromotions: [...state.pendingPromotions], bossHand: [...state.bossHand], bossDiscard: [...state.bossDiscard],
    secret: state.secret ? { ...state.secret, playerDeck: [...state.secret.playerDeck], bossDeck: [...state.secret.bossDeck] } : null,
    consents: { end: [...state.consents.end], surrender: [...state.consents.surrender] }, events: [...state.events],
  };
}

export function checkOutcome(state: GameState): boolean {
  if (state.phase === 'finished' || state.phase === 'camp') return true;
  const king = state.units.find(u => u.type === 'K');
  if (!king || king.hp <= 0) {
    state.phase = 'finished';
    state.outcome = { winner: 'boss', reason: 'king-dead', round: state.round };
    state.events.push({ type: 'defeat', key: 'king-dead' });
    return true;
  }
  if (state.boss.hp <= 0) {
    state.phase = state.mode === 'campaign' && state.campaignIndex < CAMPAIGN_BOSSES.length - 1 ? 'camp' : 'finished';
    state.outcome = state.phase === 'finished' ? { winner: 'army', reason: 'boss-defeated', round: state.round } : null;
    state.events.push({ type: 'victory', key: 'boss-defeated' });
    return true;
  }
  return false;
}

/** One simultaneous packet; targets are resolved before any death removes a blocker. */
export function hitUnits(state: GameState, targets: Unit[], damage: number, step?: number): void {
  for (const id of new Set(targets.map(u => u.id))) {
    const unit = state.units.find(u => u.id === id)!;
    if (unit.hp <= 0) continue;
    const before = unit.hp, square = unit.square!;
    const absorbed = unit.invulnerable > 0 ? 0 : Math.min(unit.shield, damage);
    if (!unit.invulnerable) {
      unit.shield -= absorbed;
      unit.hp = Math.max(0, unit.hp - damage + absorbed);
    }
    state.events.push({ type: 'damage', unitId: unit.id, amount: before - unit.hp, absorbed, to: square, step, key: unit.invulnerable > 0 ? 'invulnerable' : undefined });
  }
  for (const unit of state.units) if (unit.hp <= 0 && unit.square !== null) {
    state.events.push({ type: 'death', unitId: unit.id, from: unit.square, step });
    unit.square = null;
    unit.shield = 0;
    unit.invulnerable = 0;
  }
}

export function hitBoss(state: GameState, damage: number, armorRemoval = 0, unitId?: string): void {
  const oldArmor = state.boss.armor, oldHp = state.boss.hp;
  state.boss.armor -= Math.min(state.boss.armor, armorRemoval);
  const absorbed = Math.min(state.boss.armor, damage);
  state.boss.armor -= absorbed;
  state.boss.hp = Math.max(0, state.boss.hp - damage + absorbed);
  state.events.push({ type: 'attack', unitId, armor: oldArmor - state.boss.armor, hp: oldHp - state.boss.hp, amount: oldArmor - state.boss.armor + oldHp - state.boss.hp });
}

function resolveMove(state: GameState, step: IntentStep, index: number): boolean {
  if (!step.path?.length || step.from !== state.boss.anchor) return false;
  for (const anchor of step.path) {
    const before = state.boss.anchor;
    const oldBody = bossCells(state.boss), newBody = bossCells({ ...state.boss, anchor });
    if (!newBody.length) return false;
    const newCells = newBody.filter(s => !oldBody.includes(s));
    let occupants = state.units.filter(u => u.hp > 0 && u.square !== null && newCells.includes(u.square));
    if (step.moveMode === 'step') {
      if (occupants.length) return false;
    } else {
      hitUnits(state, occupants, step.damage, index);
      occupants = occupants.filter(u => u.hp > 0);
      if (step.moveMode === 'ram' && occupants.length) {
        const dx = file(anchor) - file(before), dy = rank(anchor) - rank(before);
        const destinations = occupants.map(u => shift(u.square!, dx, dy));
        if (destinations.some(s => s === null || !!unitAt(state, s) || newBody.includes(s))) {
          checkOutcome(state);
          return false;
        }
        for (let i = 0; i < occupants.length; i++) {
          const u = occupants[i];
          state.events.push({ type: 'move', unitId: u.id, from: u.square!, to: destinations[i]!, step: index, key: 'pushed' });
          u.square = destinations[i]!;
          u.firstMove = false;
        }
      } else if (occupants.length) {
        checkOutcome(state);
        return false;
      }
    }
    state.boss.anchor = anchor;
    state.events.push({ type: 'move', unitId: 'boss', from: before, to: anchor, step: index });
    if (checkOutcome(state)) return true;
  }
  return true;
}

/** Mutates a private copy. Does not draw, replan or enter a future army phase. */
export function resolveResponse(state: GameState, intent: Intent = state.intent): void {
  if (checkOutcome(state)) return;
  if (state.fire.length) {
    const cells = [...state.fire];
    state.fire = [];
    hitUnits(state, state.units.filter(u => u.square !== null && cells.includes(u.square)), 1, -1);
    state.events.push({ type: 'fire', cells, key: 'old-fire' });
    if (checkOutcome(state)) return;
  }
  const successfulMoves = new Set<number>();
  for (let index = 0; index < intent.steps.length; index++) {
    const step = intent.steps[index];
    if (intent.cancelledStep === index) continue;
    if (step.requires !== undefined && !successfulMoves.has(step.requires)) {
      state.events.push({ type: 'blocked', step: index, key: 'dependent-attack' });
      continue;
    }
    if (step.kind === 'move') {
      if (resolveMove(state, step, index)) successfulMoves.add(index);
      else state.events.push({ type: 'blocked', step: index, key: 'movement-blocked' });
    } else if (step.kind === 'rays') {
      const targets = (step.rays ?? []).map(r => r.map(s => unitAt(state, s)).find(Boolean)).filter((u): u is Unit => !!u);
      hitUnits(state, targets, step.damage, index);
    } else {
      hitUnits(state, state.units.filter(u => u.hp > 0 && u.square !== null && step.cells.includes(u.square)), step.damage, index);
      if (step.kind === 'fire') {
        state.fire = [...new Set(step.cells)].sort((a, b) => a - b);
        state.events.push({ type: 'fire', cells: [...state.fire], step: index, key: 'new-fire' });
      }
    }
    if (checkOutcome(state)) return;
  }
  for (const unit of state.units) {
    unit.shield = 0;
    unit.invulnerable = Math.max(0, unit.invulnerable - 1);
    unit.attackBonus = 0;
    unit.armorTip = false;
  }
  state.huntMark = 0;
  if (intent.rest) {
    state.boss.combatCount = 0;
    state.boss.lastPattern = null;
  } else {
    state.boss.combatCount++;
    state.boss.lastPattern = intent.pattern;
    state.boss.nextPattern = intent.pattern % 3 + 1;
  }
}
