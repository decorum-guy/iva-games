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
        'Пешка взяла противника и осталась невозмутимой. Она по-прежнему может ходить, брать и шаховать.',
        'Your pawn took an enemy and remained calm. It can still move, capture, and give check.',
      ),
      rule: copy(
        'Пешка запомнила эту реакцию: следующие обычные взятия будут без броска.',
        'The pawn remembers this reaction: its next ordinary captures need no new roll.',
      ),
      action: copy('А другие числа?', 'What about the other numbers?'),
      focus: { square: 'd5', subject: 'piece' },
    },
    {
      id: 'first-dice-legend',
      title: copy('Как фигура переживёт взятие', 'How a piece reacts to a capture'),
      text: copy(
        'Результат кубика определяет реакцию фигуры. Вину, опустошение и ярость дальше попробуем на доске.',
        'The die sets the piece’s reaction. Next, you will try guilt, devastation, and berserk on the board.',
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
        'Ладья взяла пешку и почувствовала вину. Посмотрите, как изменился её корпус.',
        'The rook took a pawn and feels guilty. Look at the change on its surface.',
      ),
      rule: copy(
        'Ходить можно; брать и шаховать нельзя. Ладья всё ещё занимает клетку и перекрывает линии других фигур.',
        'It can move, but cannot capture or give check. It still occupies its square and blocks other pieces’ lines.',
      ),
      action: copy('Проверить в игре', 'Try it on the board'),
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
      action: copy('Попробовать обычный ход', 'Try a quiet move'),
    },
  ],
  'devastation-roll': [
    {
      id: 'rook-devastated',
      title: copy('Выпало 1 — опустошение', 'Rolled 1 — devastation'),
      text: copy(
        'Ладья не смогла пережить взятие и замерла.',
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
        'Слон начал лечить ладью и коня: его помощь действует на все соседние клетки, включая диагонали.',
        'The bishop has started healing the rook and knight: its help reaches every immediately neighboring square, including diagonals.',
      ),
      rule: copy(
        'Не разрывайте соседство полный цикл: один ход чёрных и один белых.',
        'Keep them beside the bishop without interruption for a full cycle: one Black turn and one White turn.',
      ),
      action: copy('Дать время лечению', 'Let the healing continue'),
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
        'Слон отказался брать пешку. Он помогает своим и влияет на чужих без взятий.',
        'The bishop refused to take the pawn. It helps allies and influences enemies without capturing.',
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
        'Даже первое взятие коня не спасает от опустошения за слона. Король и фигуры в ярости — исключения.',
        'Even a knight’s first capture does not avoid the bishop penalty. Kings and berserk pieces are exceptions.',
      ),
      action: copy('Продолжить', 'Continue'),
      focus: { square: 'e5', subject: 'countdown' },
    },
  ],
  'start-shame': [
    {
      id: 'enemy-bishop-shame-started',
      title: copy('Слон вызывает стыд у противника', 'A bishop shames enemy pieces'),
      text: copy(
        'Чёрная ладья оказалась рядом с вашим слоном. Пока соседство не прерывается, каждый полный цикл ухудшает её состояние.',
        'The black rook is beside your bishop. As long as contact continues, each full cycle worsens its state.',
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
        'Ладья провела полный цикл рядом с вражескими для неё слонами и почувствовала вину.',
        'The rook spent a full cycle beside enemy bishops and feels guilty.',
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
        'Ещё один цикл рядом со слоном — и она сменит армию, раньше конца отсчёта исчезновения.',
        'One more cycle beside a bishop will change its army, before its removal countdown runs out.',
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
        'После третьего цикла слон обратил ладью. Теперь она ваша, без прежнего состояния и реакции.',
        'After the third cycle, the bishop converted the rook. It is yours now, with its old state and reaction cleared.',
      ),
      rule: copy(
        'Ладья осталась на доске: материал изменился, но взятия не было.',
        'The rook stayed on the board: material changed, but no capture took place.',
      ),
      action: copy('Взять новой ладьёй', 'Capture with your new rook'),
      focus: { square: 'e4', subject: 'piece' },
    },
  ],
  'rebirth-new-roll': [
    {
      id: 'reborn-rook-new-reaction',
      title: copy('4 — Новая реакция', '4 — A new reaction'),
      text: copy(
        'После обращения ладья бросила кубик заново. Выпало 4 — взятие оставило её без изменений.',
        'After conversion, the rook rolled again. A 4 left it unaffected by the capture.',
      ),
      rule: copy(
        'Она запомнила новую реакцию, а отсчёт её взятий после обращения начался заново.',
        'It remembers this new reaction, and conversion restarted its capture count.',
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
        'Ждать цикл не нужно. Ярость и состояния чужих фигур король не меняет.',
        'No cycle of waiting is needed. The king does not clear berserk or change enemy pieces’ states.',
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
        'Король взял слона и остался невозмутим: он сам отдал приказ сражаться.',
        'The king took the bishop and remained calm: it was the king who called for battle.',
      ),
      rule: copy(
        'Взятия не меняют его состояние. Но от шаха короля по-прежнему нужно защищать.',
        'Captures never change its state. You must still protect your king from check.',
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
        'Конь привык к бою: первую обычную фигуру он берёт без реакции.',
        'The knight is trained for battle: its first ordinary capture causes no reaction.',
      ),
      rule: copy('При втором обычном взятии ему понадобится кубик.', 'Its second ordinary capture needs a die roll.'),
      action: copy('Попробовать второе взятие', 'Try the second capture'),
      focus: { square: 'd2', subject: 'piece' },
    },
  ],
  'knight-second-capture-six': [
    {
      id: 'knight-enjoys-capturing',
      title: copy('Выпало 6 — ярость', 'Rolled 6 — berserk'),
      text: copy(
        'Коню понравилось брать фигуры. Он впал в ярость и получил ещё одно действие.',
        'The knight enjoys taking pieces. It has gone berserk and earned one more action.',
      ),
      rule: copy(
        'Вторым действием можно пойти или взять тем же конём. Третьего действия не будет.',
        'Use the same knight for a quiet move or another capture. There is no third action.',
      ),
      action: copy('Использовать второй ход', 'Use the bonus move'),
      focus: { square: 'f3', subject: 'piece' },
    },
  ],
  'bonus-bishop-and-third-capture': [
    {
      id: 'third-capture-bloodlust',
      title: copy('Ярость стала жаждой крови', 'Berserk became bloodlust'),
      text: copy(
        'У яростного коня уже три взятия всего, включая первое — теперь это жажда крови. Ярость защитила его от опустошения за слона.',
        'The berserk knight has three captures in total, including its first — that triggers bloodlust. Berserk protected it from the bishop penalty.',
      ),
      rule: copy(
        'Теперь конь ходит только со взятием и может брать своих, кроме короля.',
        'The knight now moves only by capturing, and may take allies other than the king.',
      ),
      action: copy('Как считается такой ход?', 'How does this turn count?'),
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
        'Счётчики лечения, стыда и исчезновения продвинулись за этот ход только один раз.',
        'Healing, shame, and removal timers advanced only once for this whole turn.',
      ),
      action: copy('Проверить жажду крови', 'Try bloodlust'),
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
        'Жажда крови разрешает только взятия — и первым, и вторым действием.',
        'Bloodlust permits only captures, on both the first and the bonus action.',
      ),
      action: copy('Попробовать взять свою фигуру', 'Try a friendly capture'),
    },
  ],
  'friendly-capture': [
    {
      id: 'bloodlust-took-ally',
      title: copy('Конь взял свою ладью', 'The knight took its own rook'),
      text: copy(
        'Жажда крови позволила коню взять союзника. У вас стало меньше материала.',
        'Bloodlust let the knight capture an ally. You now have less material.',
      ),
      rule: copy(
        'Свою ладью не добавляют к взятым врагам. Второе взятие доступно, но от него можно отказаться.',
        'Your rook is not added to captured enemies. Another capture is available, but you may decline it.',
      ),
      action: copy('Отказаться от второго взятия', 'Decline the second capture'),
      focus: { square: 'f5', subject: 'piece' },
    },
  ],
  'promote-inherit': [
    {
      id: 'promotion-kept-guilt',
      title: copy('Новая фигура, прежняя вина', 'A new piece, the same guilt'),
      text: copy(
        'Пешка стала другой фигурой, но всё ещё переживает из-за своих взятий.',
        'The pawn became a different piece, but still regrets its captures.',
      ),
      rule: copy(
        'Ферзь, ладья и конь наследуют состояние, реакцию и число взятий; выбор коня не даёт нового бесплатного взятия.',
        'A queen, rook, or knight inherits the state, reaction, and capture count; choosing a knight gives no new free capture.',
      ),
      action: copy('Посмотреть баланс фигур', 'Look at the material balance'),
      focus: { square: 'g8', subject: 'piece' },
    },
  ],
  'bishop-promotion-rebirth': [
    {
      id: 'promotion-bishop-cleared-reaction',
      title: copy('Слон начинает с чистого листа', 'A bishop gets a fresh start'),
      text: copy(
        'За взятие выпало 6 — ярость. Но выбранное превращение в слона сразу её сняло.',
        'The capture rolled a 6 — berserk. But your chosen promotion to a bishop immediately cleared it.',
      ),
      rule: copy(
        'Слон забывает прежнюю реакцию и взятия, становится пацифистом и не получает второго хода.',
        'The bishop forgets its old reaction and captures, becomes a pacifist, and earns no bonus move.',
      ),
      action: copy('Продолжить', 'Continue'),
      focus: { square: 'h8', subject: 'piece' },
    },
  ],
}
