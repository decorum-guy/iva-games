import { applyAction, createTutorialGame, legalActions, planIntent, previewResponse, validateState } from '../core';
import type { Action, GameState, Localized } from '../core';

export interface Lesson { title: Localized; text: Localized; done: Localized }
export interface LessonGuidance { text: Localized; focusSquares: number[]; actions: Action[] }
const text = (ru: string, en: string): Localized => ({ ru, en });

/** Short, isolated exercises. Every move, attack, shield and promotion uses the real rules. */
export const LESSONS: Lesson[] = [
  {
    title: text('Прочитай замысел', 'Read the intention'),
    text: text('Смотритель уже нацелил луч на e1. Выбери короля и уйди на подсвеченную клетку.', 'The Warden has aimed a ray at e1. Choose your king and move to a highlighted square.'),
    done: text('Луч прошёл мимо. Босс не меняет цель после твоего хода. У короля есть здоровье: шаха и мата здесь нет.', 'The ray missed. The boss never changes its target after your move. Your king has health; there is no check or checkmate.'),
  },
  {
    title: text('Сначала броня', 'Break the armor'),
    text: text('Новая позиция. Выбери ладью на a6 и ударь Смотрителя: ладья снимает дополнительную броню.', 'A new position. Choose the rook on a6 and strike the Warden: rooks remove extra armor.'),
    done: text('Ладья сняла броню, ферзь — здоровье. Атакующие фигуры остаются на своих клетках.', 'The rook removed armor; the queen removed health. Attacking pieces stay on their squares.'),
  },
  {
    title: text('Удар и отход', 'Strike and retreat'),
    text: text('Выбери коня на f5, затем клетку Смотрителя. После удара выбери подсвеченную клетку отхода.', 'Choose the knight on f5, then a Warden square. After the strike, choose a highlighted retreat square.'),
    done: text('Удар и отход стоили одну команду. Каждая фигура действует один раз за раунд; отход не даёт неуязвимость.', 'The strike and retreat cost one command. Each piece acts once per round; retreat does not grant invulnerability.'),
  },
  {
    title: text('Луч или огонь', 'Ray or fire'),
    text: text('Пешка на e2 прикрывает короля от луча на 2 урона. Нажми «Ответ босса».', 'The pawn on e2 covers the king from a 2-damage ray. Press Boss response.'),
    done: text('Луч остановился на пешке. Огонь прошёл через обе фигуры: против него нужно уйти с линии или защититься.', 'The ray stopped at the pawn. Fire hit both pieces: leave its line or use protection.'),
  },
  {
    title: text('Щит расходуется', 'A shield is consumed'),
    text: text('Смотритель готовит два удара по 1. Выбери пешку на e2 и нажми «Оборона».', 'The Warden is preparing two hits of 1. Choose the pawn on e2 and press Guard.'),
    done: text('Щит поглотил первый удар. Второй снял 1 HP — пешка выжила. Щит расходуется, а не уменьшает каждый удар.', 'The shield absorbed the first hit. The second dealt 1 HP; the pawn survived. A shield is consumed, rather than reducing every hit.'),
  },
  {
    title: text('Карта защиты', 'A protective card'),
    text: text('Открой «Мраморный обет» и выбери короля. Карта стоит 5 фокуса и защищает на два ответа босса.', 'Open Marble Vow and choose the king. It costs 5 focus and protects through two boss responses.'),
    done: text('Король не получил урона. Остался ещё один ответ под защитой. Карты тратят фокус, команды армии сохраняются.', 'The king took no damage. Protection remains for one more response. Cards spend focus, leaving army commands available.'),
  },
  {
    title: text('Превращение и победа', 'Promotion and victory'),
    text: text('Последняя позиция. Проведи пешку с c7 на c8 и выбери ферзя.', 'The final position. Move the pawn from c7 to c8 and choose the queen.'),
    done: text('Победа! На восстановлении атаки сильнее на 1. Разрушай броню, береги короля и используй такие окна для удара.', 'Victory! Attacks gain +1 during recovery. Break armor, protect your king and use these openings to strike.'),
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
      else { message = text('Король вне луча. Нажми «Ответ босса» и проверь результат.', 'Your king is outside the ray. Press Boss response to see the result.'); keep = action => action.type === 'end'; }
    } else if (index === 1) {
      const attacker = state.boss.armor > 0 ? 'rook' : 'queen';
      if (attacker === 'queen') message = text('Брони больше нет. Выбери ферзя на c5 и ударь по здоровью Смотрителя.', 'The armor is gone. Choose the queen on c5 and strike the Warden’s health.');
      keep = action => action.type === 'attack' && action.unitId === attacker;
    } else if (index === 2) keep = action => action.type === 'attack' && action.unitId === 'knight' && action.retreat !== 37;
    else if (index === 3) {
      if (fireComparison) message = text('Та же позиция, но теперь огонь проходит через обе фигуры. Нажми «Ответ босса».', 'The same position, but fire now reaches both pieces. Press Boss response.');
      keep = action => action.type === 'end';
    } else if (index === 4) {
      if (!unit(state, 'pawn-e').activated) keep = action => action.type === 'guard' && action.unitId === 'pawn-e';
      else { message = text('У пешки щит 1. Нажми «Ответ босса»: он выполнит два отдельных удара.', 'The pawn has a shield of 1. Press Boss response: it will make two separate hits.'); keep = action => action.type === 'end'; }
    } else if (index === 5) {
      if (!state.cardPlayed) keep = action => action.type === 'card' && action.cardId === 'marble-vow' && action.targets?.[0] === 'king';
      else { message = text('Защита на два ответа уже действует. Нажми «Ответ босса».', 'Protection is active for two responses. Press Boss response.'); keep = action => action.type === 'end'; }
    } else if (index === 6) {
      if (unit(state, 'pawn-c').type === 'P') keep = action => action.type === 'move' && action.unitId === 'pawn-c' && action.to === 58 && action.promotion === 'Q';
      else if (!state.intent.rest) { message = text('Пешка стала ферзём, сохранив свои 2 HP. Нажми «Ответ босса»: после третьего ответа он откроется.', 'The pawn became a queen and kept its 2 HP. Press Boss response: after the third response the Warden will open up.'); keep = action => action.type === 'end'; }
      else { message = text('Смотритель восстанавливается. Выбери нового ферзя на c8 и нанеси последний удар: 3 + 1 урона.', 'The Warden is recovering. Choose your new queen on c8 and land the final strike: 3 + 1 damage.'); keep = action => action.type === 'attack' && action.unitId === 'pawn-c'; }
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
