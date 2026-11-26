import { BOSS_CARDS, BOSSES } from './data';
import { cloneGame, resolveResponse } from './combat';
import { allLines, bodyDistance, bodyRing, bossCells, DIRECTIONS, file, frontRays, knightSquares, ORTHOGONAL, rank, ray, shift, unique } from './geometry';
import type { Boss, GameState, Intent, IntentStep, Localized, MoveMode, ResponsePreview } from './types';

const names = (ru: string, en: string): Localized => ({ ru, en });
const intent = (pattern: number, name: Localized, steps: IntentStep[], bossCard: string | null = null): Intent =>
  ({ pattern, name, steps, rest: false, cancelledStep: null, bossCard });
const area = (cells: number[], damage: number, label: Localized, requires?: number): IntentStep =>
  ({ kind: 'area', cells, damage, label, requires });
const rays = (lines: number[][], damage: number, label: Localized, requires?: number): IntentStep =>
  ({ kind: 'rays', cells: unique(lines.flat()), rays: lines, damage, label, requires });
const fire = (cells: number[], requires?: number): IntentStep =>
  ({ kind: 'fire', cells: unique(cells), damage: 1, label: names('Огонь', 'Fire'), requires });
function movement(boss: Boss, path: number[], moveMode: MoveMode, damage: number, label: Localized, requires?: number): IntentStep {
  let previous = bossCells(boss);
  const contacts: number[] = [];
  for (const anchor of path) {
    const next = bossCells({ ...boss, anchor });
    contacts.push(...next.filter(c => !previous.includes(c)));
    previous = next;
  }
  return { kind: 'move', from: boss.anchor, path, moveMode, damage, cells: unique(contacts), label, requires };
}
function validAnchor(boss: Boss, anchor: number | null): anchor is number {
  return anchor !== null && bossCells({ ...boss, anchor }).length > 0;
}
const activeLine = (state: GameState, line: number[]) => line.every(s => state.fire.includes(s));

function approach(state: GameState, pattern: number): Intent[] {
  const b = state.boss, directions = b.id === 'spire' ? DIRECTIONS : ORTHOGONAL;
  const label = names('Приближение', 'Approach');
  const result: Intent[] = [];
  for (const [dx, dy] of directions) {
    const to = shift(b.anchor, dx, dy);
    if (validAnchor(b, to)) result.push(intent(pattern, label, [movement(b, [to], b.id === 'regent' ? 'ram' : 'contact', b.id === 'spire' ? 1 : 2, label)]));
  }
  return result.length ? result : [intent(pattern, names('Ожидание', 'Hold'), [])];
}

function regentPlans(state: GameState, pattern: number): Intent[] {
  const b = state.boss, armored = b.armor > 0;
  const result: Intent[] = [];
  if (pattern === 3 && armored) return [intent(pattern, names('Гонг', 'Gong'), [area(bodyRing(b), 2, names('Гонг', 'Gong'))])];
  const moving = pattern === 1 || (pattern === 2 && !armored);
  for (const d of ORTHOGONAL) {
    if (moving) {
      const to = shift(b.anchor, d[0], d[1]);
      if (!validAnchor(b, to)) continue;
      const destination = { ...b, anchor: to };
      const label = pattern === 1 ? names('Походный клин', 'Marching Wedge') : names('Шаг тяжести', 'Weight of Stone');
      result.push(intent(pattern, label, [movement(b, [to], 'ram', 2, names('Таран', 'Ram')),
        pattern === 1 ? rays(frontRays(destination, d), 2, names('Залп', 'Volley'), 0) : area(bodyRing(destination), 1, names('Гонг', 'Gong'), 0)]));
    } else {
      result.push(intent(pattern, names('Раскол', 'Fracture'), [rays(frontRays(b, d), armored ? 2 : 3, names('Раскол', 'Fracture'))]));
    }
  }
  return result;
}

function spirePlans(state: GameState, pattern: number): Intent[] {
  const b = state.boss, result: Intent[] = [];
  if (pattern === 1) {
    for (const d of DIRECTIONS) {
      const path: number[] = [];
      for (let length = 1; length <= 3; length++) {
        const to = shift(b.anchor, d[0] * length, d[1] * length);
        if (to === null) break;
        path.push(to);
        for (const startDirection of DIRECTIONS) for (const endDirection of DIRECTIONS) {
          result.push(intent(pattern, names('Косой наскок', 'Oblique Rush'), [
            rays([ray(b.anchor, startDirection)], 1, names('Начальная насечка', 'Opening Slash')),
            movement(b, [...path], 'dash', 1, names('Рывок', 'Dash')),
            rays([ray(to, endDirection)], 2, names('Конечная насечка', 'Closing Slash'), 1),
          ]));
        }
      }
    }
  } else if (pattern === 2) {
    for (let a = 0; a < DIRECTIONS.length; a++) for (let z = a + 1; z < DIRECTIONS.length; z++) {
      result.push(intent(pattern, names('Двойная насечка', 'Twin Slash'), [rays([ray(b.anchor, DIRECTIONS[a]), ray(b.anchor, DIRECTIONS[z])], b.armor > 0 ? 1 : 2, names('Двойная насечка', 'Twin Slash'))]));
    }
  } else {
    for (const to of knightSquares(b.anchor)) for (const d of DIRECTIONS) {
      const target = shift(to, d[0], d[1]);
      if (target === null) continue;
      result.push(intent(pattern, names('Обратный прыжок', 'Reverse Leap'), [
        movement(b, [to], 'jump', 1, names('Прыжок', 'Leap')),
        area([target], 2, names('Укол', 'Thrust'), 0),
      ]));
    }
  }
  return result;
}

function archivistPlans(state: GameState, pattern: number): Intent[] {
  const b = state.boss;
  if (pattern < 3) return allLines(pattern === 1 ? 'file' : 'diagonal')
    .filter(line => !activeLine(state, line)).map(line => intent(pattern, pattern === 1 ? names('Красная строка', 'Red Line') : names('Косая правка', 'Oblique Revision'), [fire(line)]));
  const result: Intent[] = [];
  const shifts = b.armor > 0 ? ORTHOGONAL : Array.from({ length: 25 }, (_, i) => [i % 5 - 2, Math.floor(i / 5) - 2]).filter(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) === 2);
  for (const [dx, dy] of shifts) {
    const to = shift(b.anchor, dx, dy);
    if (!validAnchor(b, to)) continue;
    for (const line of allLines('rank').filter(l => !activeLine(state, l))) result.push(intent(pattern,
      b.armor > 0 ? names('Переплёт', 'Binding') : names('Разрыв переплёта', 'Broken Binding'),
      [movement(b, [to], b.armor > 0 ? 'contact' : 'jump', 2, names('Сдвиг', 'Shift')), fire(line, 0)]));
  }
  return result;
}

function basePlans(state: GameState, pattern: number): Intent[] {
  const plans = state.boss.id === 'regent' ? regentPlans(state, pattern) : state.boss.id === 'spire' ? spirePlans(state, pattern) : archivistPlans(state, pattern);
  const stationary = plans.every(p => p.steps.every(s => s.kind !== 'move'));
  const geometricHit = plans.some(p => p.steps.some(s => s.cells.some(c => state.units.some(u => u.hp > 0 && u.square === c))));
  return !plans.length || (stationary && !geometricHit) ? approach(state, pattern) : plans;
}

function cardPlans(state: GameState, base: Intent[], cardId: string, pattern: number): Intent[] {
  const b = state.boss, label = BOSS_CARDS[cardId]?.name;
  if (!label) return [];
  const result: Intent[] = [];
  const add = (steps: IntentStep[]) => result.push(intent(pattern, label, steps, cardId));
  if (cardId === 'regent_reposition') {
    for (const [dx, dy] of ORTHOGONAL) {
      const to = shift(b.anchor, dx, dy);
      if (validAnchor(b, to)) add([movement(b, [to], 'step', 0, label), area(bodyRing({ ...b, anchor: to }), 2, label, 0)]);
    }
  } else if (cardId === 'regent_far_gong') add([area(bodyRing(b, 2), 2, label)]);
  else if (cardId === 'regent_crossfire') {
    for (const [a, z] of [[0, 2], [1, 3]]) add([rays([...frontRays(b, ORTHOGONAL[a]), ...frontRays(b, ORTHOGONAL[z])], 2, label)]);
  } else if (cardId === 'spire_retreat' || cardId === 'spire_fork') {
    for (const original of base) {
      let finalAnchor = b.anchor, lastMove: number | undefined;
      original.steps.forEach((s, i) => { if (s.kind === 'move' && s.path?.length) { finalAnchor = s.path[s.path.length - 1]; lastMove = i; } });
      if (cardId === 'spire_retreat') for (const [dx, dy] of DIRECTIONS) {
        const to = shift(finalAnchor, dx, dy);
        if (to !== null) add([...original.steps, movement({ ...b, anchor: finalAnchor }, [to], 'step', 0, label, lastMove)]);
      } else {
        const index = original.steps.findLastIndex(s => s.kind !== 'move');
        if (index < 0) continue;
        const steps = [...original.steps];
        steps[index] = area(knightSquares(finalAnchor), 2, label, steps[index].requires);
        add(steps);
      }
    }
  } else if (cardId === 'spire_bent_dash') {
    for (const [dx, dy] of ORTHOGONAL) for (const turn of [-1, 1]) for (const [first, second] of [[1, 1], [1, 2], [2, 1]]) {
      const path: number[] = [];
      let cursor = b.anchor;
      for (let i = 0; i < first + second; i++) {
        const to = shift(cursor, i < first ? dx : -dy * turn, i < first ? dy : dx * turn);
        if (to === null) break;
        path.push(to); cursor = to;
      }
      if (path.length !== first + second) continue;
      for (const startDirection of DIRECTIONS) for (const endDirection of DIRECTIONS) add([
        rays([ray(b.anchor, startDirection)], 1, names('Начальная насечка', 'Opening Slash')),
        movement(b, path, 'dash', 1, label),
        rays([ray(cursor, endDirection)], 2, names('Конечная насечка', 'Closing Slash'), 1),
      ]);
    }
  } else if (cardId.startsWith('archivist_')) {
    const lines: number[][] = [];
    const files = allLines('file'), ranks = allLines('rank');
    if (cardId === 'archivist_border') lines.push(unique([...files[0], ...files[7], ...ranks[0], ...ranks[7]]));
    else if (cardId === 'archivist_parallel') {
      for (const parallel of [files, ranks]) for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        if (!activeLine(state, parallel[i]) && !activeLine(state, parallel[j])) lines.push(unique([...parallel[i], ...parallel[j]]));
      }
    } else for (const f of files) for (const r of ranks) if (!activeLine(state, f) && !activeLine(state, r)) lines.push(unique([...f, ...r]));
    for (const original of base) {
      const index = original.steps.findIndex(s => s.kind === 'fire');
      if (index < 0) continue;
      for (const line of lines) {
        if (cardId === 'archivist_border' && activeLine(state, line)) continue;
        const steps = [...original.steps];
        steps[index] = fire(line, steps[index].requires);
        add(steps);
      }
    }
  }
  const seen = new Set<string>();
  return result.filter(p => { const key = JSON.stringify(p.steps); if (seen.has(key)) return false; seen.add(key); return true; });
}

function scorePlan(state: GameState, candidate: Intent): number[] {
  // Deliberately provide no hand, seed or future-deck information to this policy.
  const simulated = cloneGame(state);
  simulated.secret = null;
  simulated.hand = [];
  simulated.events = [];
  simulated.intent = candidate;
  resolveResponse(simulated, candidate);
  let weightedLoss = 0;
  for (const u of state.units) {
    const after = simulated.units.find(v => v.id === u.id)!;
    weightedLoss += (u.hp - after.hp) * ({ K: 4, Q: 4, R: 4, B: 3, N: 3, P: 2 }[u.type]);
  }
  const king = state.units.find(u => u.type === 'K' && u.hp > 0);
  return [simulated.outcome?.reason === 'king-dead' ? 1 : 0, weightedLoss,
    king?.square !== null && king?.square !== undefined ? -bodyDistance(simulated.boss, king.square) : 0, -simulated.boss.anchor];
}
function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function stablePlanKey(candidate: Intent): string {
  const parts: number[] = [];
  for (const s of candidate.steps) {
    if (s.kind === 'move' && s.from !== undefined && s.path?.length) {
      const dx = Math.sign(file(s.path[0]) - file(s.from)), dy = Math.sign(rank(s.path[0]) - rank(s.from));
      parts.push(DIRECTIONS.findIndex(d => d[0] === dx && d[1] === dy), s.path.length, ...s.path);
    } else if (s.rays) for (const line of s.rays) parts.push(...line, 64);
    else parts.push(...s.cells, 64);
  }
  parts.push(candidate.pattern);
  return parts.map(n => String(n).padStart(2, '0')).join(',');
}

/** Freeze the complete boss intent before the army phase, never after a player action. */
export function planIntent(state: GameState): Intent {
  if (state.boss.combatCount >= 3) return {
    pattern: 0, name: names(state.boss.id === 'regent' ? 'Пролом' : state.boss.id === 'spire' ? 'Сломанный ритм' : 'Пустая страница', 'Recovery'),
    rest: true, steps: [], cancelledStep: null, bossCard: null,
  };
  const pointer = state.boss.nextPattern;
  let patterns = state.difficulty === 'abyss' ? [1, 2, 3] : state.difficulty === 'veteran' ? [pointer, pointer % 3 + 1] : [pointer];
  if (state.difficulty === 'veteran' || state.difficulty === 'abyss') patterns = patterns.filter(p => p !== state.boss.lastPattern);
  if (!patterns.length) patterns = [pointer];
  let candidates: Intent[] = patterns.flatMap(p => basePlans(state, p));
  if (state.bossCardsEnabled) for (const card of state.bossHand) {
    const modified = patterns.flatMap(p => cardPlans(state, basePlans(state, p), card, p));
    if (modified.length) { candidates = modified; break; }
  }
  let best = candidates[0] ?? intent(pointer, BOSSES[state.boss.id].name, []);
  let score = scorePlan(state, best), key = stablePlanKey(best);
  for (let i = 1; i < candidates.length; i++) {
    const next = scorePlan(state, candidates[i]), nextKey = stablePlanKey(candidates[i]);
    const comparison = compareScore(next, score);
    if (comparison > 0 || (comparison === 0 && nextKey < key)) { best = candidates[i]; score = next; key = nextKey; }
  }
  return best;
}

export function previewResponse(state: GameState): ResponsePreview {
  const predicted = cloneGame(state);
  predicted.events = [];
  if (state.phase === 'army') resolveResponse(predicted);
  const damage: Record<string, number> = {};
  for (const unit of state.units) damage[unit.id] = unit.hp - predicted.units.find(u => u.id === unit.id)!.hp;
  return {
    state: predicted, events: predicted.events, damage,
    deaths: predicted.units.filter(u => u.hp <= 0 && state.units.find(old => old.id === u.id)!.hp > 0).map(u => u.id),
    kingDies: predicted.units.some(u => u.type === 'K' && u.hp <= 0),
    threatenedCells: unique([...state.fire, ...state.intent.steps.filter((s, i) => i !== state.intent.cancelledStep && s.damage > 0).flatMap(s => s.cells)]),
    blockedSteps: predicted.events.filter(e => e.type === 'blocked' && e.step !== undefined).map(e => e.step!),
  };
}
