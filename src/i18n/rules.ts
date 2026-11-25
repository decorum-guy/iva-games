import type { CaptureReaction, DieFace } from '../core';
import type { Copy } from '../tutorial/lessonTypes';

export interface RuleSection {
  readonly id: string;
  readonly title: Copy;
  readonly body: readonly Copy[];
}

/** The always-visible introduction; exact exceptions remain in the sections below. */
export const quickRules = {
  title: { ru: 'Главное перед партией', en: 'Before you play' },
  intro: {
    ru: 'Цель — поставить мат. Фигуры ходят как в шахматах, но взятия меняют их состояние, а слоны не берут и не дают шах.',
    en: 'The goal is checkmate. Pieces move as in chess, but captures change their state, and bishops cannot capture or give check.',
  },
  die: { ru: 'Первое обычное взятие — бросок кубика', en: 'The first ordinary capture rolls a die' },
  cycle: {
    ru: 'Цикл — по одному следующему ходу каждой стороны. Ход, создавший эффект, не считается.',
    en: 'A cycle is one subsequent turn by each side. The turn that caused the effect does not count.',
  },
  bloodlust: {
    ru: 'Ярость при трёх взятиях становится жаждой крови: только ходы со взятием, можно брать своих, кроме короля.',
    en: 'At three captures, berserk becomes bloodlust: captures only, including allies other than the king.',
  },
  memory: {
    ru: 'Результат кубика запоминается: обычные взятия повторяют его даже после исцеления. У коня первое взятие без реакции; король всегда невосприимчив.',
    en: 'The die result is remembered: ordinary captures repeat it even after healing. A knight gets one free capture; a king is always immune.',
  },
  support: {
    ru: 'Свой слон лечит за цикл; чужой каждый цикл вызывает следующий этап: вина → опустошение → смена стороны. Король лечит своих сразу. Соседство включает диагонали.',
    en: 'A friendly bishop heals after a cycle. An enemy bishop advances one stage each cycle: guilt → devastation → changing sides. A king heals allies immediately. Diagonal neighbors count.',
  },
  inspection: {
    ru: 'Нажмите на фигуру: её карточка покажет состояние и точный срок до лечения, ухудшения или исчезновения.',
    en: 'Select a piece to see its state and the exact number of turns until healing, shame, or removal.',
  },
} satisfies Record<string, Copy>;

export const reactionRules: readonly {
  readonly faces: readonly DieFace[];
  readonly reaction: Exclude<CaptureReaction, 'unassigned'>;
  readonly description: Copy;
}[] = [
  { faces: [1], reaction: 'devastated', description: {
    ru: 'Не ходит. Без помощи исчезнет через 3 цикла.',
    en: 'Cannot move. Disappears after 3 cycles unless rescued.',
  } },
  { faces: [2, 3], reaction: 'guilt', description: {
    ru: 'Ходит, но не берёт и не даёт шах.',
    en: 'Can move, but cannot capture or give check.',
  } },
  { faces: [4, 5], reaction: 'unaffected', description: {
    ru: 'Взятия не меняют состояние.',
    en: 'Captures leave its state unchanged.',
  } },
  { faces: [6], reaction: 'berserk', description: {
    ru: 'Взятие первым действием даёт второе той же фигурой. Максимум два за ход.',
    en: 'A first-action capture earns a second action with the same piece. Two per turn at most.',
  } },
];

export const sourceRules: readonly RuleSection[] = [
  {
    id: 'goal',
    title: { ru: 'Цель партии', en: 'Objective' },
    body: [{
      ru: 'Первыми ходят белые. Мат — король под шахом, и спасти его нельзя. Королей не берут. Если шаха нет, но допустимых ходов тоже нет, это пат: ничья.',
      en: 'White moves first. Checkmate means a king is in check with no legal escape. Kings are never captured. No legal moves without check is stalemate: a draw.',
    }, {
      ru: 'Мат и пат определяются после всего хода игрока — включая дополнительное действие, исцеление и другие эффекты. Возможный второй шаг фигуры в ярости сам по себе не считается шахом.',
      en: 'Checkmate and stalemate are decided after the whole turn, including any bonus action, healing, and other effects. A possible second action by a berserk piece does not itself count as check.',
    }],
  },
  {
    id: 'capture',
    title: { ru: 'Первое взятие и память', en: 'First capture and memory' },
    body: [{
      ru: 'Кубик бросают один раз для каждой фигуры, при её первом обычном взятии. Реакция запоминается: исцеление убирает текущее состояние, но следующее обычное взятие возвращает его без броска.',
      en: 'Each piece rolls once, on its first ordinary capture. Healing clears its current state but leaves the reaction remembered: the next ordinary capture brings it back without another roll.',
    }, {
      ru: 'Конь получает одно взятие без реакции, затем подчиняется общему правилу. Милосердное взятие расходует эту льготу. Взятие слона вызывает опустошение даже в первый раз.',
      en: 'A knight gets one capture without a reaction, then follows the normal rules. A mercy capture uses up that exemption. Taking a bishop causes devastation even on its first capture.',
    }, {
      ru: 'Король берёт без реакции. За взятие слона — опустошение без броска, кроме короля, ярости и жажды крови. Прежняя запомненная реакция при этом сохраняется; если её ещё нет, она не назначается.',
      en: 'Kings capture without a reaction. Taking a bishop causes devastation without a roll, except for kings, berserk, and bloodlust. The capturer keeps its remembered reaction; if none was assigned, it remains unassigned.',
    }, {
      ru: 'Результат 4–5 означает, что собственные взятия не меняют состояние фигуры. От стыда рядом с вражеским слоном он не защищает.',
      en: 'A roll of 4–5 means that the piece’s own captures leave its state unchanged. It is still vulnerable to shame from an enemy bishop.',
    }],
  },
  {
    id: 'afflictions',
    title: { ru: 'Вина, опустошение и милосердие', en: 'Guilt, devastation, and mercy' },
    body: [{
      ru: 'Фигура с виной может ходить, но не берёт и не даёт шах. Опустошённая фигура не ходит, не берёт и не даёт шах. Обе остаются на своих клетках и перекрывают линии других фигур.',
      en: 'A guilty piece can move, but cannot capture or give check. A devastated piece cannot move, capture, or give check. Both still occupy their squares and block other pieces’ lines.',
    }, {
      ru: 'Без помощи опустошённая фигура исчезнет через три полных цикла. Это не взятие: никто не получит за неё ни значок взятой фигуры, ни реакцию, ни дополнительное действие.',
      en: 'A devastated piece disappears after three full cycles unless rescued. This is not a capture: nobody gains a captured-piece icon, a reaction, or a bonus action.',
    }, {
      ru: 'При милосердном взятии опустошённой фигуры кубик не бросают и запомненную реакцию не повторяют. Опустошённый слон — исключение: действует правило взятия слона. Уже яростная фигура сохраняет ярость, а при достижении трёх взятий получает жажду крови.',
      en: 'A mercy capture of a devastated piece uses no die and does not repeat a remembered reaction. A devastated bishop is the exception: the bishop-capture rule still applies. An already berserk piece keeps berserk, or enters bloodlust if this brings its capture total to three.',
    }],
  },
  {
    id: 'timing',
    title: { ru: 'Полный цикл', en: 'Full cycles' },
    body: [{
      ru: 'Цикл — по одному завершённому ходу каждой стороны. Ход, создавший эффект или соседство, в отсчёт не входит. Пример: белые подвели слона; затем ходят чёрные и снова белые — только теперь прошёл цикл. Два действия в ярости составляют один ход.',
      en: 'A cycle is one completed turn by each side. The turn that creates the effect or contact does not count. Example: White brings a bishop alongside a piece; Black moves, then White moves again. Only now has a cycle passed. Two berserk actions make one turn.',
    }, {
      ru: 'Уход из-под влияния слонов сбрасывает незавершённый отсчёт, даже если вернуться вторым действием. Уже полученные вина и опустошение остаются. Несколько слонов не ускоряют эффект; смена слона без разрыва соседства не сбрасывает отсчёт.',
      en: 'Losing bishop contact resets unfinished progress, even if the piece returns on its bonus action. Guilt and devastation already received remain. Multiple bishops do not speed things up; replacing one bishop with another without a break preserves progress.',
    }],
  },
  {
    id: 'aura',
    title: { ru: 'Исцеление, стыд и обращение', en: 'Healing, shame, and conversion' },
    body: [{
      ru: 'Слон ходит по диагоналям, но не берёт и не даёт шах. Он влияет на все восемь соседних клеток. Свой слон снимает вину и опустошение через цикл непрерывного соседства — у нескольких фигур сразу.',
      en: 'Bishops move diagonally but cannot capture or give check. Their influence covers all eight neighboring squares. A friendly bishop clears guilt and devastation after one cycle of continuous contact, healing several pieces at once.',
    }, {
      ru: 'Вражеский слон вызывает стыд. За каждый полный цикл соседства состояние ухудшается на один этап: вина → опустошение → обращение в другую армию. Если фигура уже испытывает вину или опустошение, отсчёт начинается с её текущего состояния. Стыд не меняет запомненную реакцию на взятия.',
      en: 'An enemy bishop causes shame. Each full cycle of contact advances one stage: guilt → devastation → conversion to the other side. A piece that is already guilty or devastated starts from its current state. Shame does not change its remembered capture reaction.',
    }, {
      ru: 'Свой слон сразу блокирует стыд от чужого; само исцеление занимает цикл. Слон не лечит себя. Вина и опустошение не отключают его влияние на соседей.',
      en: 'A friendly bishop blocks enemy shame immediately; healing still takes a cycle. It cannot heal itself. Guilt and devastation do not switch off its influence on neighbors.',
    }, {
      ru: 'При обращении фигура остаётся на клетке и переходит на сторону слона. Она теряет прежнее состояние, запомненную реакцию и счётчик взятий. Для следующих взятий снова действуют правила первого взятия; конь снова пропускает первый бросок.',
      en: 'Conversion leaves the piece on its square and changes it to the bishop’s side. Its old state, remembered reaction, and capture count are cleared. The first-capture rules apply again, so a knight skips its first roll again.',
    }, {
      ru: 'Король сразу снимает вину и опустошение с соседних союзников и защищает их от стыда, пока они рядом. Запомненные реакции сохраняются. Сам король невосприимчив к этим эффектам и не может перейти в другую армию.',
      en: 'A king immediately clears guilt and devastation from adjacent allies and protects them from shame while they stay nearby. Their remembered reactions remain. The king itself is immune to these effects and cannot be converted.',
    }],
  },
  {
    id: 'bonus',
    title: { ru: 'Ярость и жажда крови', en: 'Berserk and bloodlust' },
    body: [{
      ru: 'Если фигура в ярости первым действием берёт другую фигуру, она получает ещё одно действие в тот же ход. Бонус даёт и то взятие, при котором выпала шестёрка. Ход без взятия бонуса не даёт.',
      en: 'If a berserk piece captures on the first action of your turn, it earns one extra action that turn. This includes the capture that first rolls 6. A quiet move earns no bonus.',
    }, {
      ru: 'Дополнительное действие делает та же фигура: она может просто пойти или взять. За ход можно сделать не больше двух действий. Если допустимого дополнительного действия нет, ход завершается автоматически. Бонус можно пропустить кнопкой «Завершить ход», если король останется в безопасности после всех эффектов.',
      en: 'The same piece takes the bonus action: a quiet move or a capture. Two actions per turn is the limit. If no legal bonus action is available, the turn ends automatically. You may skip the bonus with “End turn” if your king will remain safe after all effects resolve.',
    }, {
      ru: 'При трёх и более взятиях фигура в ярости получает жажду крови. Учитываются все её взятия, даже до шестёрки, милосердные и свои. Обращение в другую армию и превращение в слона обнуляют этот счётчик.',
      en: 'A berserk piece with three or more captures enters bloodlust. All its captures count, including those before the 6, mercy captures, and friendly captures. Conversion and promotion to a bishop reset this count.',
    }, {
      ru: 'При жажде крови фигура ходит только со взятием; дополнительное действие тоже должно быть взятием. Можно брать своих, кроме короля, но это не обязанность. В начале своего хода вы можете выбрать другую фигуру, а от бонуса — отказаться, если это безопасно для короля.',
      en: 'A piece in bloodlust moves only by capturing, including on its bonus action. It may capture allies other than the king, but it does not have to. At the start of your turn you may choose another piece, and you may decline a bonus if your king will stay safe.',
    }, {
      ru: 'Ни слоны, ни короли не снимают ярость и жажду крови. Стыд на такие фигуры тоже не действует.',
      en: 'Neither bishops nor kings can clear berserk or bloodlust. Shame does not affect these pieces either.',
    }],
  },
  {
    id: 'basics',
    title: { ru: 'Ходы, рокировка и превращение', en: 'Movement, castling, and promotion' },
    body: [{
      ru: 'Ладья ходит по вертикали и горизонтали, слон — по диагоналям, ферзь — обоими способами. Конь ходит буквой Г и перепрыгивает фигуры. Король ходит на соседнюю клетку, не попадая под шах. Пешка ходит вперёд и берёт по диагонали; первым ходом с исходной клетки она может пройти две свободные клетки.',
      en: 'Rooks move along ranks and files, bishops along diagonals, and queens along both. Knights jump over pieces in an L shape. A king moves to a neighboring square without entering check. Pawns advance forward and capture diagonally; an original pawn can move through two empty squares on its first move from its starting square.',
    }, {
      ru: 'В рокировке участвуют король и ладья из начальной расстановки: например, e1–g1 и h1–f1. Они ещё не ходили, ладья не меняла сторону, а путь между ними свободен. Король не может стоять под шахом, проходить через атакованную клетку или попасть под шах после рокировки. Ладья с виной может рокироваться; опустошённая или с жаждой крови — нет.',
      en: 'Castling uses the king and rook from the starting position, for example e1–g1 and h1–f1. Neither may have moved, the rook must not have changed sides, and the path between them must be clear. The king cannot start in check, cross an attacked square, or end in check. A guilty rook can castle; a devastated or bloodlust rook cannot.',
    }, {
      ru: 'После d7–d5 белая пешка с e5 может взять на проходе: пойти на d6 и снять пешку с d5. Это возможно только в ближайший ход белых, включая дополнительное действие, если пешка с d5 ещё не ушла, не была взята и не сменила сторону.',
      en: 'After d7–d5, a white pawn on e5 may capture en passant: move to d6 and remove the pawn from d5. This is available only during White’s next turn, including a bonus action, provided the pawn on d5 has not moved, been captured, or changed sides.',
    }, {
      ru: 'На последней горизонтали пешка превращается в ферзя, ладью, слона или коня. Выбор нужно сделать до броска. Если пешка при этом берёт, сначала определяется её реакция на взятие, затем происходит превращение. Ферзь, ладья и конь сохраняют состояние, реакцию и число взятий; слон теряет их, становится пацифистом и не получает бонусного действия.',
      en: 'On the far rank, a pawn promotes to a queen, rook, bishop, or knight. Choose before any die roll. On a capture, the pawn’s reaction is resolved before it changes into the chosen piece. A queen, rook, or knight keeps its state, reaction, and capture count; a bishop clears them, becomes a pacifist, and earns no bonus action.',
    }],
  },
];

export const digitalRules: readonly RuleSection[] = [
  {
    id: 'settlement',
    title: { ru: 'Эффекты в конце хода', en: 'End-of-turn effects' },
    body: [{
      ru: 'Король помогает соседям сразу. В конце хода все фигуры, дождавшиеся исцеления или следующего этапа стыда, меняют состояния одновременно. Исцеление и обращение спасают фигуру, даже если она должна исчезнуть в тот же момент. Новое влияние начинает свой отсчёт и не срабатывает повторно в этом ходе.',
      en: 'A king helps its neighbors immediately. At the end of a turn, all pieces that have reached their healing or shame deadline change state together. Healing or conversion saves a piece even if it was due to disappear at that moment. Any new influence starts its own countdown and cannot trigger another stage that turn.',
    }],
  },
  {
    id: 'order',
    title: { ru: 'Порядок исключений', en: 'Order of capture exceptions' },
    body: [{
      ru: 'Если при взятии совпали несколько правил, порядок такой: король; ярость или жажда крови; взятие слона; милосердное взятие; первое взятие коня; запомненная реакция. Кубик бросают, только если ни одно из этих правил не определило результат. Любое взятие увеличивает счётчик, включая милосердное и взятие своей фигуры.',
      en: 'When capture rules overlap, use this order: king; berserk or bloodlust; bishop capture; mercy capture; a knight’s first capture; remembered reaction. Roll the die only if none of these determines the result. Every capture increases the count, including mercy and friendly captures.',
    }, {
      ru: 'После обращения ладья навсегда теряет право на рокировку, а пешка — на первый ход в две клетки. Пешка теперь ходит в ту же сторону, что и остальные пешки её нового цвета. Возвращение на исходную сторону или клетку не восстанавливает эти права.',
      en: 'After conversion, a rook permanently loses castling rights and a pawn loses its opening two-square move. The pawn now advances in its new side’s direction. Returning to its original side or square does not restore those rights.',
    }, {
      ru: 'Превращённый конь получает первое взятие без кубика, только если пешка ещё ничего не брала и не получила реакцию. Само превращение счётчик не обнуляет.',
      en: 'A promoted knight gets a first capture without a roll only if the pawn had never captured and had no remembered reaction. Promotion to a knight does not reset the count.',
    }],
  },
  {
    id: 'safety',
    title: { ru: 'Безопасность короля', en: 'King safety' },
    body: [{
      ru: 'После каждого действия свой король должен оставаться в безопасности. Если предстоит бросок, это должно быть верно при любом из шести результатов. Нельзя рассчитывать, что только удачный бросок спасёт короля.',
      en: 'Your king must be safe after every action. If a roll is needed, this must hold for all six results. You cannot rely on a favorable roll to keep your king safe.',
    }, {
      ru: 'При каждом результате также должен оставаться хотя бы один безопасный способ закончить весь ход: сразу или дополнительным действием. Учитываются исцеление, стыд, обращение и исчезновение фигур в конце хода. Если закончить сразу опасно, но второе действие спасает короля, оно обязательно.',
      en: 'Each result must also leave at least one safe way to finish the whole turn: immediately or with a bonus action. This includes healing, shame, conversion, and removal at the end of the turn. If ending now is unsafe but a second action can save the king, that action is required.',
    }, {
      ru: 'Связанная фигура всё равно контролирует клетки, которые бьёт по своим правилам. Вина, опустошение и пацифизм слона учитываются: такие фигуры шаха не дают. Короли никогда не могут оказаться на соседних клетках.',
      en: 'A pinned piece still attacks squares according to its capture rules. Guilt, devastation, and bishop pacifism still apply: those pieces give no check. Opposing kings can never occupy adjacent squares.',
    }],
  },
  {
    id: 'draws',
    title: { ru: 'Ничья и история', en: 'Draws and history' },
    body: [{
      ru: 'Если на доске остались только два короля, партия заканчивается вничью. Другие сочетания малого количества фигур не дают автоматической ничьей за недостаток материала: в Remorse слоны и ярость меняют возможности фигур.',
      en: 'If only the two kings remain, the game is drawn. Other small combinations of pieces do not automatically draw for insufficient material: bishops and berserk change what pieces can do in Remorse.',
    }, {
      ru: 'Если одна и та же позиция повторилась трижды после завершённых ходов, в начале своего хода можно заявить ничью. Совпасть должны не только клетки и очередь хода, но и состояния, реакции, значимые счётчики взятий, права пешек и ладей и оставшиеся сроки эффектов.',
      en: 'If the same position occurs three times after completed turns, you may claim a draw at the start of your turn. The squares and side to move must match, as must states, reactions, relevant capture counts, pawn and rook rights, and the time left on effects.',
    }, {
      ru: 'В игре вдвоём можно согласиться на ничью. Правила 50 и 75 ходов здесь не применяются.',
      en: 'Two players may agree to a draw. The 50- and 75-move rules do not apply here.',
    }],
  },
];

export const rulesMeta = {
  digital: { ru: 'Точные правила этой версии', en: 'Detailed rules for this edition' },
  detail: { ru: 'Правила по темам', en: 'Rules by topic' },
  face: { ru: 'Кубик', en: 'Die' },
  effect: { ru: 'Реакция', en: 'Reaction' },
  credit: {
    ru: 'Вариант придумал Bardelo Bardalini. REMORSE — независимая цифровая адаптация. Здесь приведены также уточнения, принятые для этой версии.',
    en: 'Variant created by Bardelo Bardalini. REMORSE is an independent digital adaptation. This guide also explains the rulings used in this edition.',
  },
} satisfies Record<string, Copy>;
