import { BASE_DECK, BOSS_CARD_LIST, BOSS_CARDS, BOSSES, CAMPAIGN_BOSSES, CARD_LIST, CARDS, DIFFICULTIES, STARTER_CARDS, UNIT_HP } from './data';
import { cloneGame, checkOutcome, hitBoss, resolveResponse } from './combat';
import { planIntent } from './bosses';
import { bossCells, DIAGONAL, DIRECTIONS, hashSeed, isFree, isSquare, knightSquares, ORTHOGONAL, rank, ray, shift, shuffled, unitAt } from './geometry';
import { RULES_VERSION, RuleError } from './types';
import type { Action, Actor, BossId, CardId, CreateOptions, GameState, PracticePatch, PromotionType, Seat, Unit, UnitType } from './types';

const PROMOTIONS: PromotionType[] = ['Q', 'R', 'B', 'N'];
const INITIAL: Array<[string, UnitType, number, Seat]> = [
  ['king', 'K', 4, 'A'], ['queen', 'Q', 3, 'B'], ['rook', 'R', 0, 'A'], ['bishop', 'B', 2, 'B'],
  ['knight', 'N', 6, 'A'], ['pawn-c', 'P', 10, 'B'], ['pawn-e', 'P', 12, 'A'], ['pawn-g', 'P', 14, 'B'],
];
const emptyIntent = () => ({ name: { ru: 'Выберите карту для сброса', en: 'Choose a card to discard' }, pattern: 0, rest: false, steps: [], cancelledStep: null, bossCard: null });
const otherSeat = (seat: Seat): Seat => seat === 'A' ? 'B' : 'A';
const validCardId = (id: unknown): id is CardId => typeof id === 'string' && CARD_LIST.some(c => c.id === id);
const living = (s: GameState) => s.units.filter(u => u.hp > 0 && u.square !== null);
const available = (s: GameState) => living(s).filter(u => !u.activated);
const ensure = (condition: unknown, code: string): void => { if (!condition) throw new RuleError(code); };

export function validateDeck(deck: unknown): string[] {
  if (!Array.isArray(deck) || deck.length !== 12 || !deck.every(validCardId) || new Set(deck).size !== 12) return ['invalid-deck'];
  if (STARTER_CARDS.some(c => !deck.includes(c))) return ['starter-cards-required'];
  for (const [rarity, maximum] of [['rare', 4], ['epic', 2], ['legendary', 1]] as const) if (deck.filter(id => CARDS[id].rarity === rarity).length > maximum) return ['rarity-limit'];
  return [];
}

function initialUnits(): Unit[] {
  return INITIAL.map(([id, type, square, owner]) => ({ id, type, square, startSquare: square, owner,
    hp: UNIT_HP[type], maxHp: UNIT_HP[type], activated: false, firstMove: type === 'P', shield: 0,
    invulnerable: 0, attackBonus: 0, armorTip: false }));
}

function resetBattle(state: GameState, bossId: BossId, freshArmy: boolean): void {
  ensure(state.secret, 'private-state-required');
  const seed = hashSeed(`${state.secret!.runSeed}:${state.campaignIndex}:${RULES_VERSION}`);
  const def = BOSSES[bossId], difficulty = DIFFICULTIES[state.difficulty];
  const maxHp = Math.ceil(def.hp * difficulty.numerator / difficulty.denominator);
  const maxArmor = Math.ceil(def.armor * difficulty.numerator / difficulty.denominator);
  state.boss = { id: bossId, anchor: def.anchor, hp: maxHp, maxHp, armor: maxArmor, maxArmor, nextPattern: 1, lastPattern: null, combatCount: 0 };
  if (freshArmy) state.units = initialUnits();
  else for (const unit of state.units) {
    unit.square = unit.hp > 0 ? unit.startSquare : null;
    unit.activated = false; unit.firstMove = unit.type === 'P' && unit.hp > 0;
    unit.shield = 0; unit.invulnerable = 0; unit.attackBonus = 0; unit.armorTip = false;
  }
  state.phase = 'army'; state.round = 1; state.focus = 3; state.fire = [];
  state.hand = [...STARTER_CARDS]; state.discard = []; state.pendingPromotions = [];
  state.secret!.playerDeck = shuffled(state.selectedDeck.filter(c => !STARTER_CARDS.includes(c)), seed);
  state.deckRemaining = state.secret!.playerDeck.length;
  state.bossHand = []; state.bossDiscard = [];
  state.secret!.bossDeck = state.bossCardsEnabled ? shuffled(BOSS_CARD_LIST.filter(c => c.boss === bossId).map(c => c.id), hashSeed(`${seed}:boss`)) : [];
  state.bossDeckRemaining = state.secret!.bossDeck.length;
  state.commands = difficulty.commands; state.commandIndex = 0; state.slotTransferred = false;
  state.cardPlayed = false; state.huntMark = 0; state.mustDiscard = false; state.outcome = null;
  state.consents = { end: [], surrender: [] };
  state.intent = planIntent(state);
}

export function createGame(options: CreateOptions = {}): GameState {
  const boss = options.boss ?? 'regent', difficulty = options.difficulty ?? 'knight', mode = options.mode ?? 'hunt';
  ensure(Object.keys(BOSSES).includes(boss), 'invalid-boss');
  ensure(Object.keys(DIFFICULTIES).includes(difficulty), 'invalid-difficulty');
  ensure(['hunt', 'campaign', 'practice'].includes(mode), 'invalid-mode');
  const deck = options.deck ?? BASE_DECK;
  ensure(validateDeck(deck).length === 0, 'invalid-deck');
  ensure(options.coop === undefined || typeof options.coop === 'boolean', 'invalid-coop');
  ensure(options.bossCards === undefined || typeof options.bossCards === 'boolean', 'invalid-boss-cards');
  const roundLimit = mode === 'practice' ? options.roundLimit === undefined ? 24 : options.roundLimit : 24;
  ensure(roundLimit === null || (Number.isInteger(roundLimit) && roundLimit > 0 && roundLimit <= 1000), 'invalid-limit');
  const seed = options.seed ?? 1;
  ensure(typeof seed === 'string' || (typeof seed === 'number' && Number.isFinite(seed)), 'invalid-seed');
  const state: GameState = {
    version: RULES_VERSION, revision: 0, mode, coop: options.coop ?? false, difficulty, phase: 'army', round: 1, roundLimit,
    campaignIndex: 0, units: [], boss: { id: boss, anchor: 0, hp: 1, maxHp: 1, armor: 0, maxArmor: 0, nextPattern: 1, lastPattern: null, combatCount: 0 },
    intent: emptyIntent(), fire: [], commands: 3, commandIndex: 0, slotTransferred: false, focus: 3, hand: [], discard: [], selectedDeck: [...deck],
    deckRemaining: 0, cardPlayed: false, huntMark: 0, mustDiscard: false, pendingPromotions: [], bossCardsEnabled: options.bossCards ?? true,
    bossHand: [], bossDiscard: [], bossDeckRemaining: 0, secret: { runSeed: hashSeed(seed), playerDeck: [], bossDeck: [] }, control: 'shared',
    assisted: mode === 'practice', consents: { end: [], surrender: [] }, outcome: null, events: [],
  };
  resetBattle(state, mode === 'campaign' ? 'regent' : boss, true);
  return state;
}

export function getLeader(state: GameState): Actor {
  if (!state.coop) return 'solo';
  if (state.control !== 'shared') return state.control;
  return state.round % 2 ? 'A' : 'B';
}

export function getActiveActor(state: GameState): Actor {
  if (!state.coop) return 'solo';
  if (state.control !== 'shared') return state.control;
  if (state.phase === 'camp') return state.campaignIndex === 0 ? 'A' : 'B';
  if (state.phase === 'promotion') return state.units.find(u => u.id === state.pendingPromotions[0])?.owner ?? getLeader(state);
  const leader = getLeader(state) as Seat;
  if (state.mustDiscard || state.commands <= 0) return leader;
  let seat = state.commandIndex % 2 ? otherSeat(leader) : leader;
  if (state.slotTransferred) seat = otherSeat(seat);
  if (!available(state).some(u => u.owner === seat) && available(state).some(u => u.owner === otherSeat(seat))) seat = otherSeat(seat);
  return seat;
}

function normalizeCommands(state: GameState): void {
  if (!available(state).length) { state.commands = 0; return; }
  if (!state.coop || state.control !== 'shared' || state.commands <= 0) return;
  const leader = getLeader(state) as Seat;
  const natural = state.commandIndex % 2 ? otherSeat(leader) : leader;
  const current = state.slotTransferred ? otherSeat(natural) : natural;
  if (!available(state).some(u => u.owner === current)) state.slotTransferred = !state.slotTransferred;
}

function actorExists(state: GameState, actor: Actor): boolean {
  return state.coop ? actor === 'A' || actor === 'B' : actor === 'solo';
}
function canActUnit(state: GameState, unit: Unit, actor: Actor): boolean {
  return actorExists(state, actor) && actor === getActiveActor(state) && (!state.coop || state.control !== 'shared' || unit.owner === actor);
}

function moveActions(state: GameState, unit: Unit): Action[] {
  const from = unit.square!;
  const moves: number[] = [];
  if (unit.type === 'N') moves.push(...knightSquares(from).filter(s => isFree(state, s)));
  else if (unit.type === 'K') moves.push(...DIRECTIONS.map(([dx, dy]) => shift(from, dx, dy)).filter((s): s is number => s !== null && isFree(state, s)));
  else if (unit.type === 'P') {
    const one = shift(from, 0, 1);
    if (one !== null && isFree(state, one)) {
      moves.push(one);
      const two = shift(from, 0, 2);
      if (unit.firstMove && from === unit.startSquare && rank(from) === 1 && two !== null && isFree(state, two)) moves.push(two);
    }
  } else {
    const directions = unit.type === 'B' ? DIAGONAL : unit.type === 'R' ? ORTHOGONAL : DIRECTIONS;
    for (const d of directions) for (const to of ray(from, d)) { if (!isFree(state, to)) break; moves.push(to); }
  }
  return moves.flatMap(to => unit.type === 'P' && rank(to) === 7 ? PROMOTIONS.map(promotion => ({ type: 'move' as const, unitId: unit.id, to, promotion })) : [{ type: 'move' as const, unitId: unit.id, to }]);
}

function attackActions(state: GameState, unit: Unit): Action[] {
  const from = unit.square!, body = bossCells(state.boss), result: Action[] = [];
  if (unit.type === 'N') {
    for (const target of knightSquares(from).filter(s => body.includes(s))) for (const retreat of knightSquares(target).filter(s => isFree(state, s, unit.id))) result.push({ type: 'attack', unitId: unit.id, target, retreat });
  } else if (unit.type === 'P') {
    for (const lunge of [false, true]) {
      const origin = lunge ? shift(from, 0, 1) : from;
      if (origin === null || (lunge && !isFree(state, origin))) continue;
      for (const dx of [-1, 1]) {
        const target = shift(origin, dx, 1);
        if (target !== null && body.includes(target)) result.push({ type: 'attack', unitId: unit.id, target, ...(lunge ? { lunge: true } : {}) });
      }
    }
  } else {
    const directions = unit.type === 'B' ? DIAGONAL : unit.type === 'R' ? ORTHOGONAL : DIRECTIONS;
    const range = unit.type === 'K' ? 1 : unit.type === 'B' ? 4 : 3;
    for (const d of directions) for (const target of ray(from, d, range)) {
      if (body.includes(target)) { result.push({ type: 'attack', unitId: unit.id, target }); break; }
      if (unitAt(state, target)) break;
    }
  }
  return result;
}

function unitActions(state: GameState, unit: Unit, actor: Actor): Action[] {
  if (state.phase !== 'army' || state.mustDiscard || state.commands <= 0 || unit.hp <= 0 || unit.activated || !canActUnit(state, unit, actor)) return [];
  return [...moveActions(state, unit), ...attackActions(state, unit), { type: 'guard', unitId: unit.id }];
}

function combinations<T>(items: T[], maximum: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, prefix: T[]) => {
    if (prefix.length) result.push(prefix);
    if (prefix.length === maximum) return;
    for (let i = start; i < items.length; i++) visit(i + 1, [...prefix, items[i]]);
  };
  visit(0, []); return result;
}

function withCardPromotions(state: GameState, action: Extract<Action, { type: 'card' }>): Action[] {
  const targets = (action.targets ?? []).map(id => state.units.find(u => u.id === id)!);
  const needs = targets.filter((u, i) => u.type === 'P' && rank(action.cardId === 'swap' ? targets[1 - i].square! : action.to!) === 7);
  if (!needs.length) return [action];
  let choices: Array<Record<string, PromotionType>> = [{}];
  for (const u of needs) choices = choices.flatMap(choice => PROMOTIONS.map(p => ({ ...choice, [u.id]: p })));
  return choices.map(promotions => ({ ...action, promotions }));
}

export function legalCardActions(state: GameState, cardId: CardId, actor: Actor = getLeader(state)): Action[] {
  if (!validCardId(cardId) || state.phase !== 'army' || state.mustDiscard || state.cardPlayed || !state.hand.includes(cardId)
    || CARDS[cardId].cost > state.focus || !actorExists(state, actor) || actor !== getLeader(state)) return [];
  const alive = living(state), nonKings = alive.filter(u => u.type !== 'K'), unused = available(state);
  const make = (targets?: string[], extra?: Partial<Extract<Action, { type: 'card' }>>): Extract<Action, { type: 'card' }> => ({ type: 'card', cardId, ...(targets ? { targets } : {}), ...extra });
  if (cardId === 'bandage') return nonKings.filter(u => u.hp < u.maxHp).map(u => make([u.id]));
  if (cardId === 'stone-skin') return alive.filter(u => u.shield < 2).map(u => make([u.id]));
  if (cardId === 'sharp-edge' || cardId === 'armor-tip') return state.commands > 0 && (cardId !== 'armor-tip' || state.boss.armor > 0) ? unused.map(u => make([u.id])) : [];
  if (cardId === 'focus') return state.focus < 5 ? [make()] : [];
  if (cardId === 'minor-vow' || cardId === 'marble-vow') return alive.filter(u => u.invulnerable === 0).map(u => make([u.id]));
  if (cardId === 'hospital') return combinations(nonKings, 2).filter(group => group.some(u => u.hp < u.maxHp)).map(group => make(group.map(u => u.id)));
  if (cardId === 'formation') return combinations(nonKings, 3).filter(group => group.some(u => u.shield < 3)).map(group => make(group.map(u => u.id)));
  if (cardId === 'wedge') return state.boss.armor > 0 ? [make()] : [];
  if (cardId === 'shell-break') return [make()];
  if (cardId === 'hunt-mark') return state.commands > 0 && unused.length ? [make()] : [];
  if (cardId === 'counterorder') return unused.length ? [make()] : [];
  if (cardId === 'disrupt') return state.intent.steps.flatMap((step, index) => step.kind !== 'move' && index !== state.intent.cancelledStep ? [make(undefined, { step: index })] : []);
  if (cardId === 'reposition') return unused.filter(u => u.type !== 'K').flatMap(u => ORTHOGONAL.flatMap(([dx, dy]) => {
    const to = shift(u.square!, dx, dy);
    return to !== null && isFree(state, to) ? withCardPromotions(state, make([u.id], { to })) : [];
  }));
  if (cardId === 'swap') return combinations(unused, 2).filter(group => group.length === 2 && ORTHOGONAL.some(([dx, dy]) => shift(group[0].square!, dx, dy) === group[1].square)).flatMap(group => withCardPromotions(state, make(group.map(u => u.id))));
  return [];
}

export function legalActions(state: GameState, unitId?: string, actor: Actor = getActiveActor(state)): Action[] {
  if (state.phase === 'finished' || !actorExists(state, actor) || (state.control !== 'shared' && state.coop && actor !== state.control)) return [];
  if (state.phase === 'promotion') return actor === getActiveActor(state) ? PROMOTIONS.map(promotion => ({ type: 'promote', unitId: state.pendingPromotions[0], promotion })) : [];
  if (state.phase === 'camp') {
    if (actor !== getActiveActor(state)) return [];
    const choices: Action[] = state.units.filter(u => u.type !== 'K' && u.hp <= 0).map(u => ({ type: 'camp', reviveId: u.id }));
    choices.push(...state.units.filter(u => u.type !== 'K' && u.hp > 0 && Math.min(u.maxHp, u.hp + 2) < u.maxHp).map(u => ({ type: 'camp' as const, healId: u.id })));
    return choices.length ? choices : [{ type: 'camp' }];
  }
  if (state.mustDiscard) return actor === getLeader(state) ? state.hand.map(cardId => ({ type: 'discard', cardId })) : [];
  if (unitId) { const unit = state.units.find(u => u.id === unitId); return unit ? unitActions(state, unit, actor) : []; }
  const result = state.units.flatMap(u => unitActions(state, u, actor));
  result.push(...state.hand.flatMap(c => legalCardActions(state, c, actor)));
  const shared = state.coop && state.control === 'shared';
  if ((state.commands > 0 || actor === getLeader(state)) && !(shared && state.commands > 0 && state.consents.end.includes(actor as Seat))) result.push({ type: 'end' });
  if (shared && state.commands > 0 && actor === getActiveActor(state) && !state.slotTransferred
    && available(state).some(u => u.owner === otherSeat(actor as Seat))) result.push({ type: 'transfer' });
  if (!(shared && state.consents.surrender.includes(actor as Seat))) result.push({ type: 'surrender' });
  return result;
}

function equivalentAction(a: Action, b: Action): boolean {
  // Target sets are unordered; all other supplied parameters must match the legal command.
  const normalize = (value: Action) => {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y));
    return JSON.stringify(entries.map(([k, v]) => [k, k === 'targets' && Array.isArray(v) ? [...v].sort() : k === 'promotions' && v && typeof v === 'object' ? Object.entries(v).sort(([x], [y]) => x.localeCompare(y)) : v]));
  };
  return normalize(a) === normalize(b);
}

function promote(state: GameState, unit: Unit, promotion: PromotionType): void {
  unit.type = promotion; unit.maxHp = UNIT_HP[promotion]; unit.firstMove = false;
  state.events.push({ type: 'promote', unitId: unit.id, to: unit.square!, key: promotion });
}
function moveUnit(state: GameState, unit: Unit, to: number, promotion?: PromotionType): void {
  state.events.push({ type: 'move', unitId: unit.id, from: unit.square!, to });
  unit.square = to; unit.firstMove = false;
  if (unit.type === 'P' && rank(to) === 7 && promotion) promote(state, unit, promotion);
}

function executeCard(state: GameState, action: Extract<Action, { type: 'card' }>): void {
  const id = action.cardId, targets = (action.targets ?? []).map(key => state.units.find(u => u.id === key)!);
  state.focus -= CARDS[id].cost; state.cardPlayed = true;
  state.hand = state.hand.filter(c => c !== id); state.discard.push(id);
  state.events.push({ type: 'card', cardId: id });
  if (id === 'bandage' || id === 'hospital') for (const u of targets) {
    const amount = Math.min(2, u.maxHp - u.hp); u.hp += amount;
    state.events.push({ type: 'heal', unitId: u.id, amount });
  } else if (id === 'stone-skin' || id === 'formation') for (const u of targets) {
    const shield = id === 'stone-skin' ? 2 : 3;
    u.shield = Math.max(u.shield, shield); state.events.push({ type: 'shield', unitId: u.id, amount: shield });
  } else if (id === 'sharp-edge') targets[0].attackBonus = 1;
  else if (id === 'armor-tip') targets[0].armorTip = true;
  else if (id === 'focus') state.focus = Math.min(5, state.focus + 2);
  else if (id === 'minor-vow' || id === 'marble-vow') { targets[0].invulnerable = id === 'minor-vow' ? 1 : 2; state.events.push({ type: 'shield', unitId: targets[0].id, key: 'invulnerable' }); }
  else if (id === 'hunt-mark') state.huntMark = 3;
  else if (id === 'wedge') hitBoss(state, 0, 4);
  else if (id === 'shell-break') hitBoss(state, state.boss.armor > 0 ? 0 : 4, state.boss.armor > 0 ? 8 : 0);
  else if (id === 'counterorder') state.commands++;
  else if (id === 'disrupt') state.intent.cancelledStep = action.step!;
  else if (id === 'reposition') { moveUnit(state, targets[0], action.to!, action.promotions?.[targets[0].id]); targets[0].activated = true; }
  else if (id === 'swap') {
    const [first, second] = targets, firstSquare = first.square!, secondSquare = second.square!;
    moveUnit(state, first, secondSquare, action.promotions?.[first.id]);
    moveUnit(state, second, firstSquare, action.promotions?.[second.id]);
    first.activated = true; second.activated = true;
  }
}

function freezeIntent(state: GameState): void {
  state.intent = planIntent(state);
  const card = state.intent.bossCard;
  if (card) {
    state.bossHand = state.bossHand.filter(c => c !== card); state.bossDiscard.push(card);
    state.events.push({ type: 'boss-card', cardId: card });
  }
}

function nextRound(state: GameState): void {
  ensure(state.secret, 'private-state-required');
  state.round++; state.phase = 'army'; state.commands = DIFFICULTIES[state.difficulty].commands;
  state.commandIndex = 0; state.slotTransferred = false; state.cardPlayed = false; state.huntMark = 0;
  state.focus = Math.min(5, state.focus + 1); state.consents = { end: [], surrender: [] };
  for (const unit of state.units) unit.activated = false;
  const card = state.secret!.playerDeck.shift(); if (card) state.hand.push(card);
  state.deckRemaining = state.secret!.playerDeck.length;
  if (state.bossCardsEnabled && [3, 8, 13].includes(state.round)) {
    const bossCard = state.secret!.bossDeck.shift(); if (bossCard) state.bossHand.push(bossCard);
    state.bossDeckRemaining = state.secret!.bossDeck.length;
  }
  state.mustDiscard = state.hand.length > 5;
  state.events.push({ type: 'round', amount: state.round });
  state.intent = emptyIntent();
  if (!state.mustDiscard) freezeIntent(state);
  normalizeCommands(state);
}

function endPhase(state: GameState): void {
  ensure(state.secret, 'private-state-required');
  resolveResponse(state);
  if (state.phase === 'finished' || state.phase === 'camp') return;
  if (state.roundLimit !== null && state.round >= state.roundLimit) {
    state.phase = 'finished'; state.outcome = { winner: 'boss', reason: 'limit', round: state.round };
    state.events.push({ type: 'defeat', key: 'limit' }); return;
  }
  state.pendingPromotions = living(state).filter(u => u.type === 'P' && rank(u.square!) === 7).map(u => u.id);
  if (state.pendingPromotions.length) state.phase = 'promotion';
  else nextRound(state);
}

function consent(state: GameState, kind: 'end' | 'surrender', actor: Actor): boolean {
  if (!state.coop || state.control !== 'shared' || (kind === 'end' && state.commands <= 0)) return true;
  ensure(actor !== 'solo', 'wrong-actor');
  ensure(!state.consents[kind].includes(actor as Seat), 'already-consented');
  state.consents[kind].push(actor as Seat);
  state.events.push({ type: 'consent', key: kind });
  return state.consents[kind].length === 2;
}

export function applyAction(state: GameState, action: Action, actor: Actor = 'solo'): GameState {
  ensure(state.version === RULES_VERSION, 'unsupported-version');
  ensure(state.phase !== 'finished', 'finished');
  ensure(action && typeof action === 'object' && typeof action.type === 'string', 'invalid-action');
  ensure(actorExists(state, actor) && (!state.coop || state.control === 'shared' || state.control === actor), 'wrong-actor');
  const legal = action.type === 'surrender' ? [{ type: 'surrender' } as Action]
    : action.type === 'card' ? legalCardActions(state, action.cardId, actor)
    : legalActions(state, 'unitId' in action && (action.type === 'move' || action.type === 'attack' || action.type === 'guard') ? action.unitId : undefined, actor);
  ensure(legal.some(a => equivalentAction(a, action)), 'illegal-action');
  const next = cloneGame(state); next.events = []; next.revision++;
  if (action.type !== 'end' && action.type !== 'surrender') next.consents = { end: [], surrender: [] };
  if (action.type === 'surrender') {
    if (consent(next, 'surrender', actor)) { next.phase = 'finished'; next.outcome = { winner: 'boss', reason: 'surrender', round: next.round }; next.events.push({ type: 'defeat', key: 'surrender' }); }
    return next;
  }
  if (action.type === 'end') {
    if (consent(next, 'end', actor)) endPhase(next);
    return next;
  }
  if (action.type === 'discard') {
    next.hand = next.hand.filter(c => c !== action.cardId); next.discard.push(action.cardId);
    next.mustDiscard = next.hand.length > 5;
    if (!next.mustDiscard) freezeIntent(next);
    return next;
  }
  if (action.type === 'promote') {
    promote(next, next.units.find(u => u.id === action.unitId)!, action.promotion);
    next.pendingPromotions = next.pendingPromotions.filter(id => id !== action.unitId);
    if (!next.pendingPromotions.length) nextRound(next);
    return next;
  }
  if (action.type === 'camp') {
    for (const u of living(next)) u.hp = Math.min(u.maxHp, u.hp + (u.type === 'K' ? 4 : 2));
    if (action.reviveId) { const u = next.units.find(v => v.id === action.reviveId)!; u.hp = 1; }
    if (action.healId) { const u = next.units.find(v => v.id === action.healId)!; u.hp = Math.min(u.maxHp, u.hp + 3); }
    next.events.push({ type: 'camp' }); next.campaignIndex++;
    resetBattle(next, CAMPAIGN_BOSSES[next.campaignIndex], false);
    return next;
  }
  if (action.type === 'transfer') { next.slotTransferred = true; next.events.push({ type: 'transfer' }); normalizeCommands(next); return next; }
  if (action.type === 'card') executeCard(next, action);
  else {
    const unit = next.units.find(u => u.id === action.unitId)!;
    unit.activated = true; next.commands--; next.commandIndex++; next.slotTransferred = false;
    if (action.type === 'move') moveUnit(next, unit, action.to, action.promotion);
    else if (action.type === 'guard') { unit.shield = Math.max(unit.shield, 1); next.events.push({ type: 'shield', unitId: unit.id, amount: 1 }); }
    else {
      const damage = (unit.type === 'K' ? 1 : unit.type === 'Q' || unit.type === 'R' ? 3 : unit.type === 'B' && next.boss.armor === 0 ? 3 : 2)
        + unit.attackBonus + Number(next.huntMark > 0) + Number(next.intent.rest);
      if (action.lunge) moveUnit(next, unit, shift(unit.square!, 0, 1)!);
      hitBoss(next, damage, unit.type === 'R' ? 1 : 0, unit.id);
      if (unit.armorTip && next.boss.armor > 0) hitBoss(next, 0, 2, unit.id);
      unit.attackBonus = 0; unit.armorTip = false; next.huntMark = Math.max(0, next.huntMark - 1);
      if (unit.type === 'N') moveUnit(next, unit, action.retreat!);
    }
  }
  checkOutcome(next);
  if (next.phase === 'army') normalizeCommands(next);
  return next;
}

export function publicView(state: GameState): GameState {
  const result = cloneGame(state); result.secret = null; return result;
}

/** This is deliberately not a client Action. Only an authenticated room service calls it. */
export function setControl(state: GameState, control: 'shared' | Seat): GameState {
  ensure(state.coop && state.phase !== 'finished' && ['shared', 'A', 'B'].includes(control), 'invalid-control');
  const next = cloneGame(state); next.control = control; next.revision++;
  if (control !== 'shared') next.assisted = true;
  next.consents = { end: [], surrender: [] }; next.events = [{ type: 'transfer', key: control }];
  return next;
}

export function editPractice(state: GameState, patch: PracticePatch): GameState {
  ensure(state.mode === 'practice' && !state.coop && state.secret, 'practice-only');
  const next = cloneGame(state);
  for (const change of patch.units ?? []) {
    const unit = next.units.find(u => u.id === change.id); ensure(unit, 'invalid-unit');
    if (change.type !== undefined) { ensure(Object.keys(UNIT_HP).includes(change.type) && (change.type === 'K') === (unit!.id === 'king'), 'invalid-type'); unit!.type = change.type; unit!.maxHp = UNIT_HP[change.type]; unit!.hp = Math.min(unit!.hp, unit!.maxHp); }
    if (change.hp !== undefined) unit!.hp = change.hp;
    if (change.square !== undefined) unit!.square = change.square;
    if (unit!.hp <= 0) unit!.square = null;
    else if (unit!.square === null) unit!.square = unit!.startSquare;
    unit!.activated = false; unit!.firstMove = false; unit!.shield = 0; unit!.invulnerable = 0; unit!.attackBonus = 0; unit!.armorTip = false;
  }
  if (patch.boss) Object.assign(next.boss, patch.boss);
  if (patch.focus !== undefined) next.focus = patch.focus;
  if (patch.roundLimit !== undefined) next.roundLimit = patch.roundLimit;
  if (patch.hand) {
    ensure(patch.hand.length <= 5 && patch.hand.every(validCardId) && new Set(patch.hand).size === patch.hand.length, 'invalid-hand');
    next.hand = [...patch.hand]; next.discard = []; next.secret!.playerDeck = []; next.deckRemaining = 0;
  }
  next.phase = 'army'; next.outcome = null; next.commands = DIFFICULTIES[next.difficulty].commands;
  next.commandIndex = 0; next.slotTransferred = false; next.cardPlayed = false; next.mustDiscard = false; next.pendingPromotions = [];
  next.fire = []; next.events = []; next.consents = { end: [], surrender: [] }; next.assisted = true; next.revision++;
  ensure(validateState(next).length === 0, 'invalid-position');
  next.intent = planIntent(next); checkOutcome(next);
  return next;
}

export function undoGame(current: GameState, previous: GameState): GameState {
  ensure(!current.coop && current.phase === 'army' && previous.phase === 'army' && current.round === previous.round
    && current.campaignIndex === previous.campaignIndex && current.mode === previous.mode && current.boss.id === previous.boss.id
    && current.secret && previous.secret && current.secret.runSeed === previous.secret.runSeed && previous.revision < current.revision, 'cannot-undo');
  ensure(validateState(previous).length === 0, 'invalid-save');
  const next = cloneGame(previous); next.assisted = true; next.revision = current.revision + 1; next.events = [];
  return next;
}

function validateStateUnchecked(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['invalid-save'];
  const s = value as GameState, errors: string[] = [];
  const integer = (x: unknown, min: number, max: number) => Number.isInteger(x) && Number(x) >= min && Number(x) <= max;
  if (s.version !== RULES_VERSION) errors.push('unsupported-version');
  if (!['hunt', 'campaign', 'practice'].includes(s.mode) || !Object.keys(DIFFICULTIES).includes(s.difficulty) || typeof s.coop !== 'boolean') errors.push('invalid-settings');
  if (!['army', 'promotion', 'camp', 'finished'].includes(s.phase) || !integer(s.revision, 0, Number.MAX_SAFE_INTEGER) || !integer(s.round, 1, 100000) || !integer(s.campaignIndex, 0, 2)) errors.push('invalid-progress');
  if (s.roundLimit !== null && !integer(s.roundLimit, 1, 1000)) errors.push('invalid-limit');
  if (s.mode !== 'practice' && s.roundLimit !== 24) errors.push('invalid-limit');
  if (!s.boss || !Object.keys(BOSSES).includes(s.boss.id)) return [...errors, 'invalid-boss'];
  if (!bossCells(s.boss).length || !integer(s.boss.hp, 0, s.boss.maxHp) || !integer(s.boss.armor, 0, s.boss.maxArmor)
    || !integer(s.boss.maxHp, 1, 100) || !integer(s.boss.maxArmor, 0, 100) || !integer(s.boss.nextPattern, 1, 3) || !integer(s.boss.combatCount, 0, 3)) errors.push('invalid-boss');
  if (!Array.isArray(s.units) || s.units.length !== 8 || new Set(s.units.map(u => u.id)).size !== 8) return [...errors, 'invalid-units'];
  const occupied = new Set<number>();
  for (const u of s.units) {
    const initial = INITIAL.find(row => row[0] === u.id);
    if (!initial || !Object.keys(UNIT_HP).includes(u.type) || u.maxHp !== UNIT_HP[u.type] || !integer(u.hp, 0, u.maxHp) || u.owner !== initial[3] || u.startSquare !== initial[2]) { errors.push('invalid-unit'); continue; }
    if ((u.type === 'K') !== (u.id === 'king') || !integer(u.shield, 0, 3) || !integer(u.invulnerable, 0, 2) || !integer(u.attackBonus, 0, 1) || typeof u.activated !== 'boolean' || typeof u.firstMove !== 'boolean' || typeof u.armorTip !== 'boolean') errors.push('invalid-unit');
    if (u.hp > 0) {
      if (!isSquare(u.square) || occupied.has(u.square) || bossCells(s.boss).includes(u.square)) errors.push('overlapping-position');
      else occupied.add(u.square);
      if (u.type === 'P' && rank(u.square!) === 7 && s.phase !== 'promotion' && s.phase !== 'finished') errors.push('missing-promotion');
    } else if (u.square !== null) errors.push('dead-unit-position');
  }
  for (const list of [s.hand, s.discard, s.selectedDeck]) if (!Array.isArray(list) || !list.every(validCardId) || new Set(list).size !== list.length) errors.push('invalid-cards');
  if (errors.includes('invalid-cards')) return errors;
  if (validateDeck(s.selectedDeck).length || s.hand.length > 6 || !integer(s.deckRemaining, 0, 9) || !integer(s.focus, 0, 5) || !integer(s.commands, 0, 5) || !integer(s.commandIndex, 0, 5)) errors.push('invalid-economy');
  if (new Set([...s.hand, ...s.discard]).size !== s.hand.length + s.discard.length) errors.push('duplicate-card');
  if (s.mode !== 'practice' && (s.hand.length + s.discard.length + s.deckRemaining !== 12 || [...s.hand, ...s.discard].some(c => !s.selectedDeck.includes(c)))) errors.push('card-conservation');
  if (typeof s.cardPlayed !== 'boolean' || typeof s.mustDiscard !== 'boolean' || typeof s.bossCardsEnabled !== 'boolean' || typeof s.assisted !== 'boolean' || typeof s.slotTransferred !== 'boolean' || !integer(s.huntMark, 0, 3)) errors.push('invalid-flags');
  if (s.mustDiscard !== (s.hand.length > 5)) errors.push('invalid-discard-phase');
  if (!Array.isArray(s.fire) || !s.fire.every(isSquare) || new Set(s.fire).size !== s.fire.length) errors.push('invalid-fire');
  if (!Array.isArray(s.pendingPromotions) || s.pendingPromotions.some(id => !s.units.some(u => u.id === id && u.type === 'P' && u.hp > 0 && rank(u.square!) === 7))) errors.push('invalid-promotion');
  if (!Array.isArray(s.bossHand) || !Array.isArray(s.bossDiscard) || !integer(s.bossDeckRemaining, 0, 3)) return [...errors, 'invalid-boss-cards'];
  const bossCards = [...s.bossHand, ...s.bossDiscard];
  if (bossCards.some(id => !Object.hasOwn(BOSS_CARDS, id) || BOSS_CARDS[id].boss !== s.boss.id) || new Set(bossCards).size !== bossCards.length
    || bossCards.length + s.bossDeckRemaining !== (s.bossCardsEnabled ? 3 : 0)) errors.push('invalid-boss-cards');
  if (!['shared', 'A', 'B'].includes(s.control) || !s.consents || !Array.isArray(s.consents.end) || !Array.isArray(s.consents.surrender)
    || [...s.consents.end, ...s.consents.surrender].some(v => v !== 'A' && v !== 'B')) errors.push('invalid-control');
  if (!s.intent || !Array.isArray(s.intent.steps) || s.intent.steps.length > 8 || typeof s.intent.rest !== 'boolean'
    || !s.intent.name || typeof s.intent.name.ru !== 'string' || typeof s.intent.name.en !== 'string') errors.push('invalid-intent');
  else for (const step of s.intent.steps) if (!['move', 'rays', 'area', 'fire'].includes(step.kind) || !Array.isArray(step.cells) || !step.cells.every(isSquare)
    || !integer(step.damage, 0, 3) || (step.path && (!step.path.every(isSquare) || step.path.some(anchor => !bossCells({ ...s.boss, anchor }).length)))
    || (step.rays && !step.rays.every(r => Array.isArray(r) && r.every(isSquare)))) errors.push('invalid-intent');
  if (s.secret !== null) {
    if (!s.secret || !integer(s.secret.runSeed, 0, 0xffffffff) || !Array.isArray(s.secret.playerDeck) || !s.secret.playerDeck.every(validCardId)
      || s.secret.playerDeck.length !== s.deckRemaining || !Array.isArray(s.secret.bossDeck) || s.secret.bossDeck.length !== s.bossDeckRemaining) errors.push('invalid-secret');
    else {
      if (new Set([...s.hand, ...s.discard, ...s.secret.playerDeck]).size !== s.hand.length + s.discard.length + s.deckRemaining) errors.push('duplicate-card');
      if (s.secret.bossDeck.some(c => !Object.hasOwn(BOSS_CARDS, c) || BOSS_CARDS[c].boss !== s.boss.id)
        || new Set([...bossCards, ...s.secret.bossDeck]).size !== bossCards.length + s.bossDeckRemaining) errors.push('invalid-boss-cards');
    }
  }
  if (!Array.isArray(s.events) || s.events.length > 256) errors.push('invalid-events');
  if ((s.phase === 'finished') !== (s.outcome !== null)) errors.push('invalid-outcome');
  return [...new Set(errors)];
}

export function restoreGame(value: unknown): GameState {
  const errors = validateState(value); if (errors.length) throw new RuleError(errors[0]);
  return cloneGame(value as GameState);
}

export function validateState(value: unknown): string[] {
  try { return validateStateUnchecked(value); }
  catch { return ['invalid-save']; }
}
