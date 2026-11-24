import type { Copy } from '../tutorial/lessonTypes';

export interface RuleSection {
  readonly id: string;
  readonly title: Copy;
  readonly body: readonly Copy[];
}

export const sourceRules: readonly RuleSection[] = [
  {
    id: 'goal',
    title: { ru: 'Цель партии', en: 'Objective' },
    body: [{
      ru: 'Первыми ходят белые. Цель — мат: король соперника под шахом, и у него нет способа спастись. Королей не берут. Если шаха нет, но ни одна фигура не может сделать допустимый ход, это пат и ничья.',
      en: 'White moves first. The goal is checkmate: the opposing king is in check and there is no legal way to save it. Kings are never captured. If a side is not in check but has no legal move, the game ends in a draw by stalemate.',
    }, {
      ru: 'Мат и пат определяются после всего хода игрока — включая дополнительное действие, исцеление и другие эффекты. Возможный второй шаг фигуры в ярости сам по себе не считается шахом.',
      en: 'Checkmate and stalemate are decided after the whole turn, including any bonus action, healing, and other effects. A possible second action by a berserk piece does not itself count as check.',
    }],
  },
  {
    id: 'capture',
    title: { ru: 'Первое взятие и память', en: 'First capture and memory' },
    body: [{
      ru: 'При первом взятии фигура обычно бросает кубик: 1 — опустошение, 2–3 — вина, 4–5 — без изменений, 6 — ярость. Она запоминает результат. Следующие взятия вызывают ту же реакцию без нового броска, даже после исцеления; исключения перечислены ниже.',
      en: 'A piece normally rolls a die on its first capture: 1 means devastation, 2–3 guilt, 4–5 unaffected, and 6 berserk. It remembers the result. Later captures repeat that reaction without another roll, even after healing; the exceptions are explained below.',
    }, {
      ru: 'Конь пропускает бросок при первом взятии вообще. Милосердное взятие тоже расходует эту льготу. Но взятие слона и в первый раз вызывает опустошение. При следующих взятиях кубик и запомненная реакция работают так же, как у других фигур.',
      en: 'A knight skips the roll on its first capture of any kind. A mercy capture uses up this exemption too. Taking a bishop still causes devastation, even on the first capture. Later captures use the die and remembered reaction just as other pieces do.',
    }, {
      ru: 'Король всегда берёт без реакции. Слон не берёт и не даёт шах. Взятие слона вызывает опустошение; исключения — король и фигуры в ярости или с жаждой крови. Опустошение за слона не меняет запомненную реакцию на другие взятия.',
      en: 'Kings capture without a reaction. Bishops cannot capture or give check. Taking a bishop causes devastation unless the capturer is a king, berserk, or in bloodlust. The bishop penalty does not change the capturer’s remembered reaction to other captures.',
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
    id: 'aura',
    title: { ru: 'Исцеление, стыд и обращение', en: 'Healing, shame, and conversion' },
    body: [{
      ru: 'Слон помогает фигурам на всех восьми клетках вокруг себя, включая диагонали. Свой слон снимает вину и опустошение после полного цикла непрерывного соседства. Он может лечить несколько фигур сразу, пока вы ходите другими.',
      en: 'A bishop helps pieces on all eight neighboring squares, including diagonals. A friendly bishop heals guilt and devastation after a full cycle of uninterrupted contact. It can heal several pieces at once while you move others.',
    }, {
      ru: 'Вражеский слон вызывает стыд. За каждый полный цикл соседства состояние ухудшается на один этап: вина → опустошение → обращение в другую армию. Если фигура уже испытывает вину или опустошение, отсчёт начинается с её текущего состояния.',
      en: 'An enemy bishop causes shame. Each full cycle of contact advances one stage: guilt → devastation → conversion to the other side. A piece that is already guilty or devastated starts from its current state.',
    }, {
      ru: 'Свой слон сразу останавливает стыд от вражеского, но на исцеление всё равно нужен полный цикл. Слон не лечит себя. Его влияние на соседей сохраняется и при вине, и при опустошении.',
      en: 'A friendly bishop stops enemy shame immediately, but healing still takes a full cycle. A bishop cannot heal itself. Its influence on neighbors continues even when it is guilty or devastated.',
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
      ru: 'Дополнительное действие делает та же фигура: она может просто пойти или взять. За ход можно сделать не больше двух действий. Бонус можно пропустить кнопкой «Завершить ход», если король останется в безопасности после всех эффектов.',
      en: 'The same piece takes the bonus action: a quiet move or a capture. Two actions per turn is the limit. You may skip the bonus with “End turn” if your king will remain safe after all effects resolve.',
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
    id: 'timing',
    title: { ru: 'Полный цикл', en: 'Full cycles' },
    body: [{
      ru: 'Полный цикл — по одному завершённому ходу каждой стороны. Отсчёт начинается после хода, в котором фигура получила состояние или оказалась рядом со слоном. Два действия в ярости считаются одним ходом игрока, а не двумя.',
      en: 'A full cycle is one completed turn by each side. Counting starts after the turn when the piece gained its state or came into contact with a bishop. Two berserk actions count as one player turn, not two.',
    }, {
      ru: 'Если соседство прервалось, незавершённый отсчёт лечения или стыда начинается заново при следующем сближении. Это верно даже при уходе и возвращении за два действия одного хода. Уже возникшая вина или опустошение при этом остаются. Несколько слонов не ускоряют один эффект.',
      en: 'If contact breaks, any unfinished healing or shame countdown restarts when contact returns. This applies even if a piece leaves and returns within one turn’s two actions. Guilt or devastation already caused by shame remains. Several bishops do not speed up the same effect.',
    }, {
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
  digital: { ru: 'Цифровые правила', en: 'Digital rules' },
  credit: {
    ru: 'Вариант придумал Bardelo Bardalini. REMORSE — независимая цифровая адаптация. Здесь приведены также уточнения, принятые для этой версии.',
    en: 'Variant created by Bardelo Bardalini. REMORSE is an independent digital adaptation. This guide also explains the rulings used in this edition.',
  },
} satisfies Record<string, Copy>;
