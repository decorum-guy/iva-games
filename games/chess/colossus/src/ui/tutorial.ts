import { applyAction, createTutorialGame, legalActions, planIntent, previewResponse, validateState } from '../core';
import type { Action, GameState, Localized } from '../core';

export interface Lesson { title: Localized; text: Localized; done: Localized }
export interface LessonGuidance { text: Localized; focusSquares: number[]; actions: Action[] }
const text = (ru: string, en: string): Localized => ({ ru, en });

/** Short, isolated exercises. Every move, attack, shield and promotion uses the real rules. */
export const LESSONS: Lesson[] = [
  {
    title: text('Прочитай замысел', 'Read the intention'),
    text: text('Луч Смотрителя нацелен на e1. Уведи короля на подсвеченную клетку.', 'The Warden’s ray targets e1. Move your king to a highlighted square.'),
    done: text('Луч прошёл мимо. Босс следует показанному плану. Король жив, пока у него есть HP.', 'The ray missed. The boss follows its announced plan. Your king survives while it has HP.'),
  },
  {
    title: text('Сначала броня', 'Break the armor'),
    text: text('Новая позиция. Ударь ладьёй с a6: она снимает 1 броню перед уроном.', 'New position. Strike with the rook on a6: it removes 1 armor before dealing damage.'),
    done: text('Ладья разрушила броню, ферзь снял HP. Обе фигуры остались на месте.', 'The rook broke the armor; the queen dealt HP damage. Both pieces stayed in place.'),
  },
  {
    title: text('Удар и отход', 'Strike and retreat'),
    text: text('Выбери коня на f5, цель на Смотрителе и подсвеченную клетку отхода.', 'Choose the knight on f5, a Warden square, then a highlighted retreat square.'),
    done: text('Удар и отход — одна команда. Конь будет снова готов в следующем раунде.', 'Strike and retreat used one command. The knight will be ready next round.'),
  },
  {
    title: text('Луч или огонь', 'Ray or fire'),
    text: text('Пешка на e2 прикрывает короля от луча на 2 урона. Нажми «Ответ босса».', 'The pawn on e2 covers the king from a 2-damage ray. Press Boss response.'),
    done: text('Пешка остановила луч. Огонь задел обе фигуры. Уходи с горящих клеток или готовь защиту.', 'The pawn stopped the ray. Fire hit both pieces. Move off burning squares or prepare protection.'),
  },
  {
    title: text('Щит расходуется', 'A shield is consumed'),
    text: text('Два удара по 1. Выбери пешку на e2 и нажми «Оборона».', 'Two hits of 1. Choose the pawn on e2 and press Guard.'),
    done: text('Щит поглотил 1 урон и закончился. Второй удар снял 1 HP. Пешка выжила.', 'The shield absorbed 1 damage and ran out. The second hit cost 1 HP. The pawn survived.'),
  },
  {
    title: text('Карта защиты', 'A protective card'),
    text: text('«Мраморный обет»: 5 фокуса, неуязвимость на два ответа босса. Примени карту к королю.', 'Marble Vow: 5 focus, invulnerable for two boss responses. Play it on the king.'),
    done: text('Король сохранил HP. Защиты хватит ещё на один ответ. Карта стоила 0 команд.', 'The king kept all its HP. Protection lasts one more response. The card cost 0 commands.'),
  },
  {
    title: text('Превращение и победа', 'Promotion and victory'),
    text: text('Последняя позиция. Проведи пешку c7 → c8 и выбери ферзя.', 'Final position. Move the pawn c7 → c8 and choose the queen.'),
    done: text('Победа! Ферзь нанёс 4 урона: 3 за удар и 1 за восстановление босса.', 'Victory! The queen dealt 4 damage: 3 for the strike and +1 during boss recovery.'),
  },
];

const unit = (state: GameState, id: string) => state.units.find(u => u.id === id)!;
const teachingIntent = () => ({ name: text('Учебная стойка', 'Training stance'), pattern: 1, rest: false, steps: [], cancelledStep: null, bossCard: null });

export function lessonState(index: number, fireComparison = false): GameState {
  if (!Number.isInteger(index) || index < 0 || index >= LESSONS.length) throw new RangeError('Invalid tutorial lesson');
  const state = createTutorialGame('warden-lesson-' + index);
  const positions: Record<string, number> = index === 0 ? { king: 4 }
    : index === 1 ? { king: 4, rook: 40, queen: 34 }
      : index === 2 ? { king: 4, knight: 37 }
        : index === 6 ? { king: 4, 'pawn-c': 50 }
          : { king: 4, 'pawn-e': 12 };
  for (const u of state.units) {
    u.square = positions[u.id] ?? null;
    u.hp = u.square === null ? 0 : u.maxHp;
    u.firstMove = false;
  }
  state.boss.armor = index === 1 ? 4 : 0;
  state.intent = teachingIntent();
  if (index === 0) state.intent = {
    ...teachingIntent(), name: text('Луч по вертикали e', 'Ray down the e-file'),
    steps: [{ kind: 'rays', label: text('Луч на 2', 'Ray of 2'), cells: [36, 28, 20, 12, 4], rays: [[36, 28, 20, 12, 4]], damage: 2 }],
  };
  if (index === 3) state.intent = {
    ...teachingIntent(), name: fireComparison ? text('Огонь по вертикали e', 'Fire down the e-file') : text('Луч по вертикали e', 'Ray down the e-file'),
    steps: fireComparison
      ? [{ kind: 'fire', label: text('Огонь на 1', 'Fire of 1'), cells: [4, 12, 20, 28, 36, 44, 52, 60], damage: 1 }]
      : [{ kind: 'rays', label: text('Луч на 2', 'Ray of 2'), cells: [36, 28, 20, 12, 4], rays: [[36, 28, 20, 12, 4]], damage: 2 }],
  };
  if (index === 4) state.intent = {
    ...teachingIntent(), name: text('Два удара', 'Two strikes'),
    steps: [0, 1].map(() => ({ kind: 'rays', label: text('Удар на 1', 'Hit of 1'), cells: [12], rays: [[12]], damage: 1 })),
  };
  if (index === 5) {
    state.hand = ['marble-vow']; state.focus = 5;
    state.intent = { ...teachingIntent(), name: text('Удар по королю', 'Strike at the king'), steps: [{ kind: 'rays', label: text('Луч на 2', 'Ray of 2'), cells: [4], rays: [[4]], damage: 2 }] };
  }
  if (index === 6) {
    state.boss.hp = 4; state.round = 3; state.boss.combatCount = 2; state.boss.nextPattern = 3;
    state.intent = planIntent(state);
  }
  return state;
}

/** Action suggestions are a subset of the engine's legal actions, never a parallel ruleset. */
export function lessonGuidance(index: number, state: GameState, fireComparison = false): LessonGuidance {
  const legal = legalActions(state);
  let message = LESSONS[index]?.text ?? text('', '');
  let keep: (action: Action) => boolean = () => false;
  if (state.phase !== 'finished' && state.mode === 'tutorial') {
    if (index === 0) {
      if (!unit(state, 'king').activated) keep = action => action.type === 'move' && action.unitId === 'king' && !previewResponse(applyAction(state, action)).damage.king;
      else { message = text('Король вне луча. Нажми «Ответ босса».', 'Your king is outside the ray. Press Boss response.'); keep = action => action.type === 'end'; }
    } else if (index === 1) {
      const attacker = state.boss.armor > 0 ? 'rook' : 'queen';
      if (attacker === 'queen') message = text('Броня разрушена. Ударь ферзём с c5 по HP Смотрителя.', 'Armor broken. Strike the Warden’s HP with the queen on c5.');
      keep = action => action.type === 'attack' && action.unitId === attacker;
    } else if (index === 2) keep = action => action.type === 'attack' && action.unitId === 'knight' && action.retreat !== 37;
    else if (index === 3) {
      if (fireComparison) message = text('Та же позиция с огнём на вертикали e. Нажми «Ответ босса».', 'The same position with fire on the e-file. Press Boss response.');
      keep = action => action.type === 'end';
    } else if (index === 4) {
      if (!unit(state, 'pawn-e').activated) keep = action => action.type === 'guard' && action.unitId === 'pawn-e';
      else { message = text('Щит пешки поглотит 1 урон. Нажми «Ответ босса».', 'The pawn’s shield will absorb 1 damage. Press Boss response.'); keep = action => action.type === 'end'; }
    } else if (index === 5) {
      if (!state.cardPlayed) keep = action => action.type === 'card' && action.cardId === 'marble-vow' && action.targets?.[0] === 'king';
      else { message = text('Король неуязвим на два ответа. Нажми «Ответ босса».', 'The king is invulnerable for two responses. Press Boss response.'); keep = action => action.type === 'end'; }
    } else if (index === 6) {
      if (unit(state, 'pawn-c').type === 'P') keep = action => action.type === 'move' && action.unitId === 'pawn-c' && action.to === 58 && action.promotion === 'Q';
      else if (!state.intent.rest) { message = text('Ферзь сохранил 2 HP пешки. Нажми «Ответ босса»: после третьего боевого ответа начнётся восстановление.', 'The queen kept the pawn’s 2 HP. Press Boss response: the Warden recovers after this third combat response.'); keep = action => action.type === 'end'; }
      else { message = text('Смотритель восстанавливается. Ударь ферзём с c8: 3 + 1 урона.', 'The Warden is recovering. Strike with the queen on c8 for 3 + 1 damage.'); keep = action => action.type === 'attack' && action.unitId === 'pawn-c'; }
    }
  }
  const actions = legal.filter(keep);
  const focusSquares = [...new Set(actions.flatMap(action => {
    const origin = 'unitId' in action ? unit(state, action.unitId).square : null;
    if (action.type === 'move') return [origin, action.to].filter((sq): sq is number => sq !== null);
    if (action.type === 'attack') return [origin, action.target].filter((sq): sq is number => sq !== null);
    if (action.type === 'guard') return origin === null ? [] : [origin];
    if (action.type === 'card') return (action.targets ?? []).map(id => unit(state, id).square).filter((sq): sq is number => sq !== null);
    return [];
  }))];
  return { text: message, focusSquares, actions };
}

export function isLessonActionAllowed(index: number, state: GameState, action: Action, fireComparison = false): boolean {
  const normalize = (value: Action) => JSON.stringify(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  return lessonGuidance(index, state, fireComparison).actions.some(candidate => normalize(candidate) === normalize(action));
}

export function lessonComplete(index: number, before: GameState, after: GameState, action: Action, fireComparison = false): boolean {
  if (after.mode !== 'tutorial' || after.boss.id !== 'sentinel') return false;
  if (index === 0) return action.type === 'end' && unit(after, 'king').hp === 20 && unit(before, 'king').square !== 4;
  if (index === 1) return after.boss.armor === 0 && after.boss.hp < 12;
  if (index === 2) return action.type === 'attack' && action.unitId === 'knight';
  if (index === 3) return action.type === 'end' && (fireComparison ? unit(after, 'king').hp === 19 && unit(after, 'pawn-e').hp === 1 : unit(after, 'king').hp === 20 && unit(after, 'pawn-e').hp === 0);
  if (index === 4) return action.type === 'end' && unit(after, 'pawn-e').hp === 1 && unit(before, 'pawn-e').shield === 1;
  if (index === 5) return action.type === 'end' && unit(after, 'king').invulnerable === 1 && unit(after, 'king').hp === 20;
  return index === 6 && before.intent.rest && action.type === 'attack' && after.outcome?.winner === 'army';
}

export function tutorialProbe(): boolean {
  return LESSONS.every((_, index) => {
    const state = lessonState(index);
    return state.mode === 'tutorial' && state.boss.id === 'sentinel' && validateState(state).length === 0;
  });
}
export const applyLessonAction = applyAction;
