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
      ru: 'Первыми ходят белые. Поставьте мат королю соперника: он под шахом, и ни один легальный ход его не спасает. Королей не берут. Если шаха нет, но ходов тоже нет, это пат.',
      en: 'White moves first. Checkmate the opposing king by giving check and leaving it no legal escape. Kings are never taken. A side with no legal move and no check is stalemated.',
    }],
  },
  {
    id: 'capture',
    title: { ru: 'Первое взятие и память', en: 'First capture and memory' },
    body: [{
      ru: 'Первое подходящее взятие определяет реакцию. 1 — опустошение, 2–3 — вина, 4–5 — без изменений, 6 — ярость. Фигура запоминает реакцию и повторяет её при следующих подходящих взятиях, даже после лечения.',
      en: 'The first qualifying capture assigns a reaction. 1 means devastation, 2–3 guilt, 4–5 unaffected, and 6 berserk. The piece remembers its reaction and repeats it on later qualifying captures, even after healing.',
    }, {
      ru: 'Конь получает одно бесплатное взятие. Король всегда берёт без реакции. Слон не берёт и не даёт шах. Взятие слона вызывает опустошение, кроме случаев, когда его берёт король или фигура в ярости либо с жаждой крови.',
      en: 'A knight gets one free capture. A king captures without a reaction. Bishops cannot capture or give check. Taking a bishop devastates the capturer unless it is a king, berserk or in bloodlust.',
    }],
  },
  {
    id: 'afflictions',
    title: { ru: 'Вина, опустошение и милосердие', en: 'Guilt, devastation, and mercy' },
    body: [{
      ru: 'Фигура с виной может ходить, но не берёт и не даёт шах. Опустошённая фигура не двигается и не даёт шах. Обе перекрывают линии. Без помощи опустошённая фигура исчезает через три полных цикла.',
      en: 'A guilt-ridden piece can move but cannot capture or give check. A devastated piece cannot move or give check. Both still block lines. A devastated piece disappears after three full cycles unless rescued.',
    }, {
      ru: 'Милосердное взятие опустошённой фигуры не вызывает реакции. Для опустошённого слона действует правило взятия слона.',
      en: 'A mercy capture of a devastated piece does not trigger a reaction. A devastated bishop still follows the bishop-capture rule.',
    }],
  },
  {
    id: 'aura',
    title: { ru: 'Отпущение вины, стыд и обращение', en: 'Absolution, shame, and conversion' },
    body: [{
      ru: 'Слон воздействует на все восемь соседних клеток. Свой слон снимает вину и опустошение через полный цикл. Вражеский слон вызывает стыд: по одному этапу за цикл — вина, опустошение, затем обращение.',
      en: 'A bishop affects each of the eight adjacent squares. A friendly bishop heals guilt or devastation after a full cycle. An enemy bishop applies shame, one stage per cycle: guilt, devastation, then conversion.',
    }, {
      ru: 'Свой слон сразу блокирует стыд. Слон не лечит себя, но влияет на соседей даже в опустошении. При обращении фигура становится союзником повлиявшего слона и заново определяет реакцию при взятии.',
      en: 'A friendly bishop blocks shame immediately. A bishop cannot heal itself, but its aura works even while devastated. Conversion moves a piece to the influencing bishop’s side and resets its capture reaction.',
    }, {
      ru: 'Сбор войск снимает вину и опустошение у соседних союзников короля сразу. Пока они рядом с королём, стыд не накапливается. Лечение сохраняет память взятия.',
      en: 'Rally the Troops clears guilt and devastation from adjacent allies immediately. They remain protected from shame while next to their king. Healing preserves capture memory.',
    }],
  },
  {
    id: 'bonus',
    title: { ru: 'Ярость и жажда крови', en: 'Berserk and bloodlust' },
    body: [{
      ru: 'Первое взятие в ход даёт фигуре в ярости одно дополнительное действие, включая взятие с броском 6. Действует та же фигура. Завершить ход можно сразу, если итоговая позиция безопасна для короля. Третьего действия нет.',
      en: 'A primary capture gives a berserk piece one extra action, including a capture that rolls 6. The same piece acts again. You can end the turn if the settled position keeps your king safe. There is no third action.',
    }, {
      ru: 'После трёх взятий с последнего обновления фигура в ярости получает жажду крови. Она ходит только со взятием, в том числе своей фигуры, кроме своего короля. Слоны и короли не меняют оба состояния.',
      en: 'A berserk piece reaches bloodlust at three captures since rebirth. It can only move by capturing, including friendly pieces other than its king. Bishops and kings do not alter either state.',
    }],
  },
  {
    id: 'basics',
    title: { ru: 'Ходы, рокировка и превращение', en: 'Movement, castling, and promotion' },
    body: [{
      ru: 'Ладья ходит по прямым, слон по диагоналям, ферзь обоими способами. Конь перепрыгивает фигуры буквой Г. Король ходит на соседнюю клетку, не входя под шах. Пешка ходит вперёд, берёт по диагонали и может начать с двух клеток при свободном пути.',
      en: 'Rooks move along ranks and files, bishops along diagonals, and queens along both. Knights jump in an L shape. A king moves one square without entering check. Pawns advance forward and capture diagonally. An original pawn may open by advancing two empty squares.',
    }, {
      ru: 'При рокировке, например e1–g1 и h1–f1, король и ладья ещё не ходили, между ними нет фигур и король не стоит, не проходит и не заканчивает под шахом. Ладья с виной может участвовать, опустошённая или с жаждой крови — нет.',
      en: 'For castling, for example e1–g1 and h1–f1, the king and rook must retain their original rights, the path must be empty, and the king must avoid check before, during and after the move. A guilt-ridden rook can castle. A devastated or bloodlust rook cannot.',
    }, {
      ru: 'После d7–d5 белая пешка с e5 может взять на проходе на d6, сняв пешку с d5. Право длится следующий ход соперника и исчезает, если уязвимая пешка уходит, теряется или обращается.',
      en: 'After d7–d5, a white pawn on e5 may take en passant on d6, removing the pawn on d5. The right lasts for the opponent’s next turn and ends if the vulnerable pawn moves, is taken, or changes sides.',
    }, {
      ru: 'На последней горизонтали выберите ферзя, ладью, слона или коня до броска. Реакцию на взятие определяет пешка. Все варианты, кроме слона, сохраняют состояние, реакцию и счётчик взятий. Слон рождается заново без них.',
      en: 'On the far rank, choose a queen, rook, bishop or knight before the roll. The pawn resolves the capture first. Every choice except bishop inherits its state, memory and capture count. A bishop is reborn without them.',
    }],
  },
];

export const digitalRules: readonly RuleSection[] = [
  {
    id: 'timing',
    title: { ru: 'Полный цикл', en: 'Full cycles' },
    body: [{
      ru: 'Полный цикл — два завершённых хода игроков. Счёт начинается после хода, на котором возникло состояние или установился контакт. Дополнительное действие не двигает таймер. Контакт прерывается сразу при разрыве соседства, в том числе посреди хода. Несколько слонов не ускоряют один и тот же эффект.',
      en: 'A full cycle is two completed player turns. Timing starts after the turn that created the state or contact. A bonus action does not tick a timer. Breaking adjacency resets progress immediately, even mid-turn. Multiple bishops do not speed up the same effect.',
    }, {
      ru: 'На границе хода сначала срабатывает сбор войск, затем одновременно созревают лечение и стыд. Лечение и обращение спасают фигуру, которая должна исчезнуть в этот момент. Новое влияние начинает отсчёт заново.',
      en: 'At the turn boundary, rally resolves first. Due cures and shame then resolve simultaneously. Healing and conversion rescue a piece due to disappear at that boundary. New aura contact starts a fresh timer.',
    }],
  },
  {
    id: 'order',
    title: { ru: 'Порядок исключений', en: 'Order of capture exceptions' },
    body: [{
      ru: 'При взятии сначала проверяются исключения короля и ярости, затем опустошение за взятие слона, милосердие, первое взятие коня и память. Бросок происходит только если ни одно из них не действует. Все взятия пополняют счётчик, даже милосердные и свои.',
      en: 'Captures check king and berserk exceptions first, then bishop devastation, mercy, the knight’s first capture, and remembered reactions. The die is rolled only if none applies. Every capture increases the count, including mercy and friendly captures.',
    }, {
      ru: 'Обращение навсегда снимает право исходной рокировки и двойного шага. Пешка меняет направление. После превращения конь получает бесплатное взятие только при нулевом счётчике и без запомненной реакции.',
      en: 'Conversion permanently removes original castling and double-step rights. Pawns switch direction. A promoted knight only gets a free capture if it has no remembered reaction and its capture count is zero.',
    }],
  },
  {
    id: 'safety',
    title: { ru: 'Безопасность короля', en: 'King safety' },
    body: [{
      ru: 'Для каждого возможного броска король должен оставаться в безопасности после действия, а у игрока должен быть безопасный способ завершить ход с учётом эффектов. Иногда поэтому второй ход обязателен. Связанные фигуры по-прежнему угрожают по своим линиям. Будущий второй ход ярости сам по себе шахом не считается.',
      en: 'Under every possible roll, the king must be safe after the action and there must be a safe way to finish the turn after passive effects. This can make a bonus mandatory. Pinned pieces still threaten along their movement lines. A possible future berserk action itself does not count as check.',
    }],
  },
  {
    id: 'draws',
    title: { ru: 'Ничья и история', en: 'Draws and history' },
    body: [{
      ru: 'Два короля без других фигур дают ничью. Три одинаковые завершённые позиции дают право заявить ничью перед ходом. При сравнении важны состояния, память, права пешек и ладей, очередь хода и остаток таймеров. Правила 50 и 75 ходов отключены.',
      en: 'Bare kings draw automatically. Three occurrences of the same settled position allow a draw claim before moving. The comparison includes states, memory, pawn and rook rights, side to move, and remaining timers. The 50- and 75-move rules are disabled.',
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
