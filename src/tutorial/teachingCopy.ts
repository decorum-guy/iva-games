import type { Copy, TeachingBeat } from './lessonTypes'

const copy = (ru: string, en: string): Copy => ({ ru, en })

/**
 * Required explanations belong to the action that caused them. Keeping these
 * beats outside the step list preserves the indices in existing learning saves.
 * Each beat is held until the learner chooses its next action.
 */
export const TEACHING_BEATS: Readonly<Record<string, readonly TeachingBeat[]>> = {
  'capture-and-roll': [
    {
      id: 'first-reaction-four',
      title: copy('Выпало 4 — без изменений', 'Rolled 4 — unaffected'),
      text: copy(
        'Ваша пешка взяла чёрную пешку и осталась невозмутимой. Она по-прежнему может ходить, брать и шаховать.',
        'Your pawn took the black pawn and remained calm. It can still move, capture, and give check.',
      ),
      rule: copy(
        'Пешка запомнила реакцию: при следующих таких взятиях она повторится без нового броска.',
        'The pawn remembers this reaction. It will react the same way to later captures like this, without another roll.',
      ),
      action: copy('А другие числа?', 'What about the other numbers?'),
      focus: { square: 'd5', subject: 'piece' },
    },
    {
      id: 'first-dice-legend',
      title: copy('Что означают числа', 'What the numbers mean'),
      text: copy(
        'Каждое число означает одну из четырёх реакций. Дальше попробуем вину, опустошение и ярость на доске.',
        'Each number means one of four reactions. Next, you will try guilt, devastation, and berserk on the board.',
      ),
      action: copy('Где видно взятую фигуру?', 'Where is the captured piece?'),
      diceLegend: true,
    },
  ],
  'guilt-roll': [
    {
      id: 'rook-feels-guilt',
      title: copy('Выпало 2 — вина', 'Rolled 2 — guilt'),
      text: copy(
        'Ладья сожалеет о взятии пешки. Теперь она может ходить, но не берёт и не даёт шах.',
        'The rook regrets taking the pawn. It can still move, but cannot capture or give check.',
      ),
      rule: copy(
        'Ладья остаётся на доске и по-прежнему закрывает линии других фигур.',
        'The rook stays on the board and still blocks other pieces’ lines.',
      ),
      action: copy('Попробовать ещё одно взятие', 'Try another capture'),
      focus: { square: 'c4', subject: 'piece' },
    },
  ],
  'guilt-forbids-capture': [
    {
      id: 'guilt-capture-refused',
      title: copy('Вина остановила взятие', 'Guilt stopped the capture'),
      text: copy(
        'Ладья отказалась брать ещё одну фигуру. Пешка d4 осталась на доске.',
        'The rook refused to take another piece. The pawn on d4 stayed on the board.',
      ),
      rule: copy('Но на пустую клетку ладья ходить может.', 'The rook can still move to an empty square.'),
      action: copy('Сходить без взятия', 'Try a quiet move'),
    },
  ],
  'devastation-roll': [
    {
      id: 'rook-devastated',
      title: copy('Выпало 1 — опустошение', 'Rolled 1 — devastation'),
      text: copy(
        'Ладья не смогла пережить взятие пешки и замерла.',
        'The rook could not bear taking the pawn and froze.',
      ),
      rule: copy(
        'Она не ходит, не берёт и не шахует. Без помощи ладья исчезнет через 3 полных цикла.',
        'It cannot move, capture, or give check. Without help, it will disappear after 3 full cycles.',
      ),
      action: copy('Посмотреть отсчёт', 'Look at the countdown'),
      focus: { square: 'c4', subject: 'piece' },
    },
  ],
  'devastated-immobile': [
    {
      id: 'devastation-move-refused',
      title: copy('Опустошение не даёт двигаться', 'Devastation prevents movement'),
      text: copy(
        'Ладья осталась на c4. Даже ход на пустую клетку ей недоступен.',
        'The rook stayed on c4. It cannot even move to an empty square.',
      ),
      rule: copy(
        'Пока ладья на доске, она всё ещё перекрывает линии других фигур.',
        'While it remains on the board, it still blocks other pieces’ lines.',
      ),
      action: copy('Узнать о милосердии', 'Learn about mercy'),
    },
  ],
  'mercy-capture': [
    {
      id: 'mercy-without-reaction',
      title: copy('Милосердие — без кубика', 'Mercy — no die roll'),
      text: copy(
        'Ладья взяла опустошённого коня. Такое взятие считается милосердным и не вызывает новой реакции.',
        'The rook took the devastated knight. This is a mercy capture, so it causes no new reaction.',
      ),
      rule: copy(
        'Состояние ладьи не изменилось, а взятый конь появился под вашим именем.',
        'The rook’s state stayed unchanged, and the captured knight appeared below your name.',
      ),
      action: copy('А если не успеть помочь?', 'What if help comes too late?'),
      focus: { square: 'c4', subject: 'piece' },
    },
  ],
  'start-two-cures': [
    {
      id: 'bishop-started-healing',
      title: copy('Лечение началось', 'Healing has begun'),
      text: copy(
        'Слон лечит ладью и коня. Он помогает своим фигурам на всех восьми соседних клетках, в том числе по диагонали.',
        'The bishop is healing the rook and knight. It helps allies on all eight adjacent squares, including diagonals.',
      ),
      rule: copy(
        'Оставьте их рядом со слоном на полный цикл — ход чёрных и ход белых.',
        'Keep them beside the bishop for a full cycle: one Black turn and one White turn.',
      ),
      action: copy('Дождаться лечения', 'Let the healing finish'),
      focus: { square: 'e3', subject: 'piece' },
    },
  ],
  'cure-two-pieces': [
    {
      id: 'bishop-cured-both',
      title: copy('Ладья и конь исцелены', 'The rook and knight are healed'),
      text: copy(
        'Прошёл полный цикл. Слон снял вину ладьи и опустошение коня.',
        'A full cycle has passed. The bishop cleared the rook’s guilt and the knight’s devastation.',
      ),
      rule: copy(
        'Обе фигуры снова могут ходить, брать и шаховать; коню больше не грозит исчезновение.',
        'Both can move, capture, and give check again; the knight is no longer at risk of disappearing.',
      ),
      action: copy('А что может сам слон?', 'What can the bishop do?'),
      focus: { square: 'f4', subject: 'piece' },
    },
  ],
  'bishop-pacifism': [
    {
      id: 'bishop-refuses-capture',
      title: copy('Слон — пацифист', 'The bishop is a pacifist'),
      text: copy(
        'Слон отказался брать пешку.',
        'The bishop refused to take the pawn.',
      ),
      rule: copy(
        'Слоны ходят по диагонали, но никогда не берут и не шахуют.',
        'Bishops move diagonally, but never capture or give check.',
      ),
      action: copy('Снова взять ладьёй', 'Capture with the rook again'),
    },
  ],
  'remembered-guilt': [
    {
      id: 'guilt-returns-from-memory',
      title: copy('Вина вернулась без броска', 'Guilt returned without a roll'),
      text: copy(
        'Ладья снова взяла пешку и снова почувствовала вину.',
        'The rook took another pawn and feels guilty again.',
      ),
      rule: copy(
        'Лечение снимает текущее состояние, но фигура помнит свою реакцию на взятие.',
        'Healing clears the current state, but the piece remembers how it reacts to captures.',
      ),
      action: copy('Узнать о взятии слона', 'Learn about taking a bishop'),
      focus: { square: 'e6', subject: 'piece' },
    },
  ],
  'bishop-capture-cost': [
    {
      id: 'knight-devastated-by-bishop',
      title: copy('Взятие слона опустошило коня', 'Taking the bishop devastated the knight'),
      text: copy(
        'Конь взял мирного слона и не смог этого пережить — опустошение наступило без броска.',
        'The knight took a peaceful bishop and could not bear it — devastation struck without a roll.',
      ),
      rule: copy(
        'Взятие слона вызывает опустошение. Только король и фигуры с яростью или жаждой крови этого избегают.',
        'Taking a bishop always causes devastation, except for kings and pieces with berserk or bloodlust.',
      ),
      action: copy('Перейти к уроку о стыде', 'Go to the lesson on shame'),
      focus: { square: 'e5', subject: 'countdown' },
    },
  ],
  'start-shame': [
    {
      id: 'enemy-bishop-shame-started',
      title: copy('Слон вызывает стыд у противника', 'A bishop shames enemy pieces'),
      text: copy(
        'Чёрная ладья оказалась рядом с вашим слоном. Пока он рядом, её состояние ухудшается на один этап за полный цикл.',
        'The black rook is beside your bishop. While it stays nearby, the rook’s state worsens by one stage each full cycle.',
      ),
      rule: copy(
        'Вина → опустошение → переход в вашу армию. Конь d4 в ярости невосприимчив к слонам.',
        'Guilt → devastation → joining your army. The berserk knight on d4 is immune to bishops.',
      ),
      action: copy('Посмотреть первый цикл', 'Watch the first cycle'),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'shame-does-not-stack': [
    {
      id: 'shame-caused-guilt',
      title: copy('Первый цикл — вина', 'First cycle — guilt'),
      text: copy(
        'Ладья провела полный цикл рядом с белыми слонами и почувствовала вину.',
        'The rook spent a full cycle beside the white bishops and feels guilty.',
      ),
      rule: copy(
        'Она больше не берёт и не шахует. Второй слон не ускоряет стыд.',
        'It can no longer capture or give check. A second bishop does not speed up shame.',
      ),
      action: copy('Посмотреть следующий цикл', 'Watch the next cycle'),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'shame-devastation': [
    {
      id: 'shame-caused-devastation',
      title: copy('Второй цикл — опустошение', 'Second cycle — devastation'),
      text: copy(
        'Соседство со слонами продолжилось: вина ладьи стала опустошением. Теперь она не может двигаться.',
        'The bishops stayed nearby: the rook’s guilt turned into devastation. It can no longer move.',
      ),
      rule: copy(
        'Ещё через цикл рядом со слоном ладья перейдёт к вам — раньше, чем успеет исчезнуть.',
        'After one more cycle beside the bishop, the rook will join your side before it can disappear.',
      ),
      action: copy('Посмотреть обращение', 'Watch the conversion'),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'convert-rook': [
    {
      id: 'rook-joined-white',
      title: copy('Ладья перешла к белым', 'The rook has joined White'),
      text: copy(
        'Слон спас опустошённую ладью и обратил её в вашу армию. Она снова может ходить и брать, а прежнюю реакцию забыла.',
        'The bishop rescued the devastated rook and brought it to your side. It can move and capture again, and has forgotten its old reaction.',
      ),
      rule: copy(
        'У вас стало на одну ладью больше, у соперника — меньше. Взятия не было, поэтому значок под именем не добавился.',
        'You gained a rook and your opponent lost one. No capture took place, so no captured-piece icon was added.',
      ),
      action: copy('Взять новой ладьёй', 'Capture with your new rook'),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'rebirth-new-roll': [
    {
      id: 'reborn-rook-new-reaction',
      title: copy('Выпало 4 — без изменений', 'Rolled 4 — unaffected'),
      text: copy(
        'Это первое взятие ладьи после обращения, поэтому понадобился новый бросок. Теперь она спокойно относится к взятиям.',
        'This was the rook’s first capture after changing sides, so it rolled again. It now remains calm when it captures.',
      ),
      rule: copy(
        'Ладья запомнила новую реакцию. После обращения счёт её взятий начался с нуля.',
        'The rook remembers its new reaction. Changing sides reset its capture count to zero.',
      ),
      action: copy('Как защититься от стыда?', 'How do you defend against shame?'),
      focus: { square: 'e6', subject: 'piece' },
    },
  ],
  'parry-shame': [
    {
      id: 'friendly-bishop-stopped-shame',
      title: copy('Защита сразу, лечение позже', 'Protection now, healing later'),
      text: copy(
        'Ваш слон встал рядом с ладьёй и сразу остановил стыд от чужого слона.',
        'Your bishop moved beside the rook and immediately stopped the enemy bishop’s shame.',
      ),
      rule: copy(
        'Вина пока остаётся: для исцеления нужен полный цикл непрерывного соседства.',
        'Guilt remains for now: healing takes a full cycle of uninterrupted contact.',
      ),
      action: copy('Дождаться лечения', 'Let the healing finish'),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'protected-cure-matures': [
    {
      id: 'protected-rook-healed',
      title: copy('Вина снята', 'Guilt is cleared'),
      text: copy(
        'Прошёл полный цикл: свой слон исцелил ладью, хотя вражеский слон остался рядом.',
        'A full cycle has passed: the friendly bishop healed the rook, even with the enemy bishop still nearby.',
      ),
      action: copy('Узнать о помощи короля', 'Learn about the king’s help'),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'rally-two-pieces': [
    {
      id: 'king-rallied-allies',
      title: copy('Король поддержал своих', 'The king rallied its allies'),
      text: copy(
        'Король встал рядом с ладьёй и конём и сразу снял их вину и опустошение.',
        'The king moved beside the rook and knight and immediately cleared their guilt and devastation.',
      ),
      rule: copy(
        'Пока свои фигуры рядом с королём, они защищены от стыда. На ярость и вражеские фигуры эта помощь не действует.',
        'Allies stay protected from shame while beside their king. This help does not affect berserk or enemy pieces.',
      ),
      action: copy('Попробовать взятие королём', 'Try a king capture'),
      focus: { square: 'f2', subject: 'piece' },
    },
  ],
  'king-captures-without-roll': [
    {
      id: 'king-unaffected-by-capture',
      title: copy('Королю кубик не нужен', 'The king needs no die'),
      text: copy(
        'Король сам приказал сражаться: он не получает состояний и не поддаётся обращению. Даже за слона кубик ему не нужен.',
        'The king called for battle: it never gains these states or changes sides. Even taking a bishop needs no roll.',
      ),
      rule: copy(
        'Король должен быть вне шаха после каждого действия и всех эффектов в конце хода. Когда другая фигура бросает кубик, это обязательно при любом результате.',
        'Your king must be safe after every action and after all end-of-turn effects. When another piece rolls, this must hold for every possible result.',
      ),
      action: copy('Узнать о коне', 'Learn about the knight'),
      focus: { square: 'h2', subject: 'piece' },
    },
  ],
  'knight-free-capture': [
    {
      id: 'knight-first-capture-free',
      title: copy('Первое взятие — без реакции', 'First capture — no reaction'),
      text: copy(
        'Конь привык к бою. Это его первое взятие, поэтому за эту пешку кубик не понадобился.',
        'The knight is trained for battle. This was its first capture, so taking this pawn needed no roll.',
      ),
      rule: copy('Все взятия идут в счёт, включая милосердные. За следующую пешку конь уже бросит кубик.', 'Every capture counts, including mercy captures. Taking the next pawn will need a roll.'),
      action: copy('Попробовать второе взятие', 'Try the second capture'),
      focus: { square: 'd2', subject: 'piece' },
    },
  ],
  'knight-second-capture-six': [
    {
      id: 'knight-enjoys-capturing',
      title: copy('Выпало 6 — ярость', 'Rolled 6 — berserk'),
      text: copy(
        'Коню понравилось брать фигуры. В ярости взятие первым действием даёт второе; ход без взятия — нет.',
        'The knight enjoys taking pieces. A capture as its first action earns a second; a quiet move does not.',
      ),
      rule: copy(
        'Действует тот же конь: можно пойти или взять. Всего — не больше двух действий за ход.',
        'The same knight acts again: it can move or capture. A turn allows no more than two actions.',
      ),
      action: copy('Сходить конём ещё раз', 'Move the knight again'),
      focus: { square: 'f3', subject: 'piece' },
    },
  ],
  'bonus-bishop-and-third-capture': [
    {
      id: 'third-capture-bloodlust',
      title: copy('Ярость стала жаждой крови', 'Berserk became bloodlust'),
      text: copy(
        'Это третье взятие коня, считая первое до ярости. Ярость уберегла его от опустошения за слона.',
        'This is the knight’s third capture, counting the first one before berserk. Berserk spared it devastation for taking the bishop.',
      ),
      rule: copy(
        'При жажде крови тоже можно сделать до двух действий за ход, но оба — только со взятием. Можно брать своих, кроме короля.',
        'A piece in bloodlust can take up to two actions per turn, both captures. It may also capture allies other than the king.',
      ),
      action: copy('Как считается такой ход?', 'Do both actions count as one turn?'),
      focus: { square: 'h4', subject: 'piece' },
    },
    {
      id: 'two-actions-one-turn',
      title: copy('Два действия — один ход', 'Two actions — one turn'),
      text: copy(
        'Конь сделал два действия, но это был один ход белых. Теперь очередь чёрных.',
        'The knight took two actions, but they were one White turn. Black moves next.',
      ),
      rule: copy(
        'Дополнительное действие не отсчитывается отдельно для лечения, стыда и исчезновения.',
        'The extra action does not count as another turn for healing, shame, or disappearance.',
      ),
      action: copy('Попробовать ход без взятия', 'Try a quiet move'),
    },
  ],
  'bloodlust-forbids-quiet': [
    {
      id: 'bloodlust-quiet-refused',
      title: copy('Без взятия конь не пойдёт', 'The knight will not move without a capture'),
      text: copy(
        'На g2 никого нет, поэтому конь остался на h4.',
        'There is nobody on g2, so the knight stayed on h4.',
      ),
      rule: copy(
        'В начале хода можно выбрать другую фигуру. Брать своих необязательно — сейчас только попробуем это правило.',
        'At the start of a turn, you may choose another piece. Taking an ally is optional; this exercise lets you try it.',
      ),
      action: copy('Попробовать взять свою фигуру', 'Try a friendly capture'),
    },
  ],
  'friendly-capture': [
    {
      id: 'bloodlust-took-ally',
      title: copy('Конь взял свою ладью', 'The knight took its own rook'),
      text: copy(
        'Конь взял союзника, и у вас стало на одну ладью меньше.',
        'The knight took an ally, leaving you with one fewer rook.',
      ),
      rule: copy(
        'Своя ладья не попадает в ряд взятых врагов. От дополнительного взятия можно отказаться.',
        'Your own rook does not appear in your captured-piece row. You may decline the extra capture.',
      ),
      action: copy('Как завершить ход?', 'How do I end the turn?'),
      focus: { square: 'f5', subject: 'piece' },
    },
  ],
  'promote-inherit': [
    {
      id: 'promotion-kept-guilt',
      title: copy('Новая фигура, прежняя вина', 'A new piece, the same guilt'),
      text: copy(
        'Новая фигура всё ещё чувствует вину за взятия пешки.',
        'The new piece still feels guilty about the pawn’s captures.',
      ),
      rule: copy(
        'Ферзь, ладья и конь сохраняют реакцию и число взятий пешки. Эта пешка уже брала фигуры — выбор коня не обнулит счёт.',
        'A queen, rook, or knight keeps the pawn’s reaction and capture count. This pawn had already captured, so choosing a knight cannot restart that count.',
      ),
      action: copy('Посмотреть баланс фигур', 'Look at the material balance'),
      focus: { square: 'g8', subject: 'piece' },
    },
  ],
  'bishop-promotion-rebirth': [
    {
      id: 'promotion-bishop-cleared-reaction',
      title: copy('Превращение в слона сняло ярость', 'Becoming a bishop cleared berserk'),
      text: copy(
        'За взятие выпало 6 — ярость. Но пешка превратилась в слона, и ярость сразу исчезла.',
        'The capture rolled a 6 — berserk. But the pawn then became a bishop, clearing berserk immediately.',
      ),
      rule: copy(
        'Слон забывает реакцию, начинает с нулевым счётом взятий и становится пацифистом. Дополнительного действия нет.',
        'The bishop forgets the reaction, resets its capture count, and becomes a pacifist. There is no extra action.',
      ),
      action: copy('Сравнить варианты превращения', 'Compare promotion choices'),
      focus: { square: 'h8', subject: 'piece' },
    },
  ],
}
