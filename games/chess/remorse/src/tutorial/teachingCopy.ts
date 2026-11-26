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
        'Пешка взяла пешку и осталась в норме: может ходить, брать и давать шах.',
        'The pawn captured and stayed unaffected: it can move, capture, and give check.',
      ),
      rule: copy(
        'Она запомнила этот результат. Следующее обычное взятие обойдётся без кубика.',
        'It remembers this result. Its next ordinary capture will not need a roll.',
      ),
      action: copy(
        'Все результаты кубика',
        'All die results',
      ),
      focus: { square: 'd5', subject: 'piece' },
    },
    {
      id: 'first-dice-legend',
      title: copy('Что означают числа', 'What the numbers mean'),
      text: copy(
        'Выпавшая четвёрка оставила пешку в норме. Другие результаты вызывают вину, опустошение или ярость — каждый попробуем дальше.',
        'The 4 left your pawn unaffected. Other results cause guilt, devastation, or berserk. You will try each one next.',
      ),
      action: copy(
        'Взятые фигуры',
        'Captured pieces',
      ),
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
      action: copy(
        'Посмотреть ход короля',
        'Watch the king move',
      ),
      focus: { square: 'c4', subject: 'piece' },
    },
  ],
  'guilt-forbids-capture': [
    {
      id: 'guilt-capture-refused',
      title: copy('Вина остановила взятие', 'Guilt stopped the capture'),
      text: copy(
        'Вина запрещает взятие. Ладья осталась на c4, чёрная пешка — на d4.',
        'Guilt prevents the capture. The rook stays on c4, and the black pawn stays on d4.',
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
        'Она не ходит, не берёт и не даёт шах. Без помощи исчезнет через 3 цикла: ещё по 3 хода каждой стороны.',
        'It cannot move, capture, or give check. Without help, it disappears after 3 cycles: 3 more turns by each side.',
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
        'Ладья взяла опустошённого коня. При милосердном взятии нет ни броска, ни повтора запомненной реакции.',
        'The rook took the devastated knight. Mercy captures neither roll the die nor repeat a remembered reaction.',
      ),
      rule: copy(
        'Ладья осталась в норме. Исключение — взятие опустошённого слона; его разберём в следующем уроке.',
        'The rook stays unaffected. A devastated bishop is an exception; the next lesson explains why.',
      ),
      action: copy(
        'Проверить срок',
        'Check the deadline',
      ),
      focus: { square: 'c4', subject: 'piece' },
    },
  ],
  'start-two-cures': [
    {
      id: 'bishop-started-healing',
      title: copy('Лечение началось', 'Healing has begun'),
      text: copy(
        'Ладья и конь попали на соседние клетки слона. Диагонали тоже считаются, и лечить можно нескольких сразу.',
        'The rook and knight are now beside the bishop. Diagonal neighbors count, and several pieces can heal at once.',
      ),
      rule: copy(
        'Ход сближения не считается. Теперь должны походить чёрные, затем белые — и обе фигуры исцелятся, если останутся рядом.',
        'The move that brought them together does not count. Black must move, then White; both pieces heal if they stay nearby.',
      ),
      action: copy(
        'Ход чёрных',
        'Black’s turn',
      ),
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
      action: copy(
        'Продолжить',
        'Continue',
      ),
      focus: { square: 'f4', subject: 'piece' },
    },
  ],
  'bishop-pacifism': [
    {
      id: 'bishop-refuses-capture',
      title: copy('Слон — пацифист', 'The bishop is a pacifist'),
      text: copy(
        'Слон остался на e3: он не может взять пешку c5.',
        'The bishop stays on e3: it cannot capture the pawn on c5.',
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
        'Конь взял слона — и сразу получил опустошение, без кубика. Даже первое взятие коня здесь не спасает.',
        'The knight took a bishop and was immediately devastated, without a roll. Even its first-capture exemption does not protect it here.',
      ),
      rule: copy(
        'Избежать этого могут только король и фигуры в ярости или с жаждой крови.',
        'Only kings and pieces with berserk or bloodlust avoid this penalty.',
      ),
      action: copy(
        'Следующий урок',
        'Next lesson',
      ),
      focus: { square: 'e5', subject: 'countdown' },
    },
  ],
  'start-shame': [
    {
      id: 'enemy-bishop-shame-started',
      title: copy('Слон вызывает стыд у противника', 'A bishop shames enemy pieces'),
      text: copy(
        'Ваш слон вызывает стыд у чёрной ладьи. Пока состояние прежнее: сначала должны походить чёрные, затем белые.',
        'Your bishop is shaming the black rook. Its state has not changed yet: Black must move, then White.',
      ),
      rule: copy(
        'Каждый цикл: вина → опустошение → переход к вам. Конь d4 в ярости — на него слон не действует.',
        'Each cycle: guilt → devastation → joining your side. The berserk knight on d4 is immune.',
      ),
      action: copy(
        'Ход чёрных',
        'Black’s turn',
      ),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'shame-does-not-stack': [
    {
      id: 'shame-caused-guilt',
      title: copy('Первый цикл — вина', 'First cycle — guilt'),
      text: copy(
        'Прошёл цикл рядом с вашим слоном. Ладья получила вину: больше не берёт и не даёт шах.',
        'A full cycle beside your bishop has passed. The rook is now guilty: it cannot capture or give check.',
      ),
      rule: copy(
        'Второй слон не ускоряет стыд. Уход от обоих остановит отсчёт, но уже полученная вина останется.',
        'The second bishop does not speed up shame. Moving away from both stops the countdown, but guilt already received remains.',
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
        'После третьего цикла ладья сменила сторону. Она снова в норме; прежние реакция и число взятий сброшены.',
        'After the third cycle, the rook changed sides. It is unaffected again; its old reaction and capture count are cleared.',
      ),
      rule: copy(
        'Материал перешёл к вам. Взятия не было — значок под именем не добавляется.',
        'The material changed sides. There was no capture, so no captured-piece icon is added.',
      ),
      action: copy(
        'Продолжить',
        'Continue',
      ),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'rebirth-new-roll': [
    {
      id: 'reborn-rook-new-reaction',
      title: copy('Выпало 4 — без изменений', 'Rolled 4 — unaffected'),
      text: copy(
        'После обращения это первое взятие ладьи. Она бросила кубик заново и получила другую реакцию.',
        'This is the rook’s first capture since changing sides. It rolled again and received a different reaction.',
      ),
      rule: copy(
        'Теперь она запомнит результат 4: обычные взятия не меняют её состояние.',
        'It now remembers the 4: ordinary captures leave its state unchanged.',
      ),
      action: copy(
        'Защита от стыда',
        'Defending against shame',
      ),
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
      action: copy(
        'Ход чёрных',
        'Black’s turn',
      ),
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
      action: copy(
        'Ход чёрных',
        'Black’s turn',
      ),
      focus: { square: 'f2', subject: 'piece' },
    },
  ],
  'king-captures-without-roll': [
    {
      id: 'king-unaffected-by-capture',
      title: copy('Королю кубик не нужен', 'The king needs no die'),
      text: copy(
        'Король взял слона и остался в норме. Он не получает состояний и не переходит в другую армию.',
        'The king took the bishop and stayed unaffected. It cannot receive these states or change sides.',
      ),
      rule: copy(
        'Оставлять короля под шахом нельзя — даже в надежде на удачный кубик. Ход должен быть безопасен при любом результате.',
        'You cannot leave your king in check and hope for a lucky roll. A move must be safe for every possible result.',
      ),
      action: copy(
        'Следующий урок',
        'Next lesson',
      ),
      focus: { square: 'h2', subject: 'piece' },
    },
  ],
  'knight-free-capture': [
    {
      id: 'knight-first-capture-free',
      title: copy('Первое взятие — без реакции', 'First capture — no reaction'),
      text: copy(
        'Конь взял первую пешку без кубика. На обычном втором взятии он уже получит реакцию.',
        'The knight took its first pawn without rolling. Its next ordinary capture will give it a reaction.',
      ),
      rule: copy(
        'Милосердное взятие тоже расходует эту льготу; взятие слона всё равно вызывает опустошение.',
        'A mercy capture also uses up this exemption; taking a bishop still causes devastation.',
      ),
      action: copy(
        'Ход чёрных',
        'Black’s turn',
      ),
      focus: { square: 'd2', subject: 'piece' },
    },
  ],
  'knight-second-capture-six': [
    {
      id: 'knight-enjoys-capturing',
      title: copy('Выпало 6 — ярость', 'Rolled 6 — berserk'),
      text: copy(
        'Взятие привело коня в ярость. Теперь он может сделать ещё одно действие до ответа чёрных.',
        'The capture sent the knight berserk. It can now act once more before Black replies.',
      ),
      rule: copy(
        'Сходите или возьмите тем же конём. Максимум два действия за ход; ход без взятия бонуса не даёт.',
        'Move or capture with the same knight. Two actions per turn is the limit; a quiet first move earns no bonus.',
      ),
      action: copy(
        'Взять слона',
        'Capture the bishop',
      ),
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
      action: copy(
        'Два действия за ход',
        'Two actions in one turn',
      ),
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
      action: copy(
        'Ход чёрных',
        'Black’s turn',
      ),
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
        'В обычной партии можно выбрать другую фигуру. Здесь попробуем ещё одну возможность: взять своего.',
        'In a normal game you can choose another piece. Here, try another option: capture an ally.',
      ),
      action: copy(
        'Взять свою ладью',
        'Capture your own rook',
      ),
    },
  ],
  'friendly-capture': [
    {
      id: 'bloodlust-took-ally',
      title: copy('Конь взял свою ладью', 'The knight took its own rook'),
      text: copy(
        'Ваша ладья снята с доски. Она не попадает в ряд взятых вражеских фигур.',
        'Your rook leaves the board. It does not appear in the row of captured enemy pieces.',
      ),
      rule: copy(
        'У коня осталось дополнительное взятие, но его можно пропустить.',
        'The knight has a bonus capture available, but you may skip it.',
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
        'После превращения вина осталась: новая фигура может ходить, но не берёт и не даёт шах.',
        'Guilt remains after promotion: the new piece can move, but cannot capture or give check.',
      ),
      rule: copy(
        'Ферзь, ладья и конь наследуют реакцию и число взятий. Эта пешка уже брала: конь не получит нового бесплатного взятия.',
        'Queens, rooks, and knights inherit the reaction and capture count. This pawn had already captured, so a knight gets no new free capture.',
      ),
      action: copy('Посмотреть баланс фигур', 'Look at the material balance'),
      focus: { square: 'g8', subject: 'piece' },
    },
  ],
  'bishop-promotion-rebirth': [
    {
      id: 'promotion-bishop-cleared-reaction',
      title: copy('Превращение сняло ярость', 'The bishop is no longer berserk'),
      text: copy(
        'Слон начинает заново: ярость исчезла, реакция забыта, число взятий обнулилось.',
        'The bishop starts fresh: berserk is cleared, its reaction is forgotten, and its capture count returns to zero.',
      ),
      rule: copy(
        'Ярость снята, поэтому бонус отменён. Слон ходит по диагоналям, но не берёт и не даёт шах.',
        'Berserk is cleared, so the bonus is canceled. The bishop moves diagonally but cannot capture or give check.',
      ),
      action: copy('Сравнить варианты превращения', 'Compare promotion choices'),
      focus: { square: 'h8', subject: 'piece' },
    },
  ],
}

export const bishopPromotionReaction: TeachingBeat = {
  id: 'promotion-pawn-berserk',
  title: copy('Выпало 6 — ярость', 'Rolled 6 — berserk'),
  text: copy('Пешка на h8 взяла ладью и впала в ярость.', 'The pawn took the rook on h8 and went berserk.'),
  rule: copy('В ярости взятие первым действием обычно даёт второе.', 'A first-action capture while berserk usually earns a second action.'),
  action: copy('Превратить в слона', 'Promote to bishop'),
  focus: { square: 'h8', subject: 'piece' },
}
