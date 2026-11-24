import { createInitialState, createPosition, isInCheck } from '../core'
import type { GameState, Piece, Square } from '../core/types'
import { fixed, move } from './lessonTypes'
import type { Copy, Lesson } from './lessonTypes'
import { TEACHING_BEATS } from './teachingCopy'

const copy = (ru: string, en: string): Copy => ({ ru, en })
const at = (state: GameState, square: Square): Piece | undefined =>
  state.pieces.find(piece => piece.square === square)
const kings = [
  { side: 'white', type: 'king', square: 'h1' },
  { side: 'black', type: 'king', square: 'a8' },
] as const

const lessonPositions: readonly Lesson[] = [
  {
    id: 'first-capture',
    title: copy('Первое взятие', 'First capture'),
    positions: [{
      setup: createInitialState,
      steps: [
        {
          id: 'open-with-e4', kind: 'move', moves: [move('e2', 'e4')],
          text: copy(
            'Цель — поставить мат. В Remorse взятия могут менять состояние фигур. Для начала передвиньте белую пешку на выделенную клетку.',
            'The goal is checkmate. In Remorse, captures can change how pieces feel and act. Start by moving the white pawn to the highlighted square.',
          ),
          detail: copy(
            'Фигуры ходят как в обычных шахматах, но после взятий могут вести себя иначе. Выберите пешку, затем клетку назначения.',
            'Pieces move as in ordinary chess, but captures can change what they are able to do. Select the pawn, then its destination square.',
          ),
        },
        {
          id: 'black-pawn-d5', kind: 'script', move: move('d7', 'd5'),
          text: copy(
            'Чёрные отвечают пешкой: d7 → d5.',
            'Black replies with the pawn: d7 → d5.',
          ),
          detail: copy(
            'Теперь ход чёрных. Чёрная пешка выходит на d5.',
            'Black moves next. Watch the black pawn advance to d5.',
          ),
        },
        {
          id: 'capture-and-roll', kind: 'move', moves: [move('e4', 'd5')], roll: fixed(4, 'e4', 'd5'),
          expect: events => events.some(event => event.type === 'reaction' && event.face === 4),
          text: copy(
            'Возьмите чёрную пешку. Кубик покажет, как ваша пешка отнесётся к первому взятию.',
            'Capture the black pawn. The die will show how your pawn feels about its first capture.',
          ),
          detail: copy(
            'После взятия кубик определит реакцию пешки. Она запомнит её: при следующих таких взятиях нового броска не будет.',
            'The die will set the pawn’s reaction after the capture. It remembers that reaction, so later captures like this will not need another roll.',
          ),
        },
        {
          id: 'faces-and-material', kind: 'read',
          hud: 'captures',
          text: copy(
            'Под вашим именем появилась взятая пешка. Рядом +1: сейчас у вас перевес в одну пешку.',
            'The captured pawn now appears below your name. The +1 beside it means you are one pawn ahead.',
          ),
          detail: copy(
            'Значки показывают взятые вами вражеские фигуры. Число рядом сравнивает оставшиеся на доске фигуры: пешка — 1, конь и слон — 3, ладья — 5, ферзь — 9. Их состояния и расположение в этот подсчёт не входят.',
            'The icons show enemy pieces you have captured. The number compares the pieces still on the board: pawn 1, knight and bishop 3, rook 5, queen 9. It does not account for their states or positions.',
          ),
        },
      ],
    }],
  },
  {
    id: 'guilt',
    title: copy('Вина', 'Guilt'),
    positions: [{
      setup: () => createPosition({ pieces: [
        { side: 'white', type: 'king', square: 'h1' },
        { side: 'black', type: 'king', square: 'c8' },
        { side: 'white', type: 'rook', square: 'c3' },
        { side: 'white', type: 'rook', square: 'c1' },
        { side: 'black', type: 'pawn', square: 'c4' },
        { side: 'black', type: 'pawn', square: 'd4' },
      ] }),
      steps: [
        {
          id: 'guilt-roll', kind: 'move', moves: [move('c3', 'c4')], roll: fixed(2, 'c3', 'c4'),
          expect: (_, state) => at(state, 'c4')?.affliction === 'guilt' && !isInCheck(state, 'black'),
          text: copy(
            'В новой позиции возьмите пешку ладьёй и посмотрите, как фигура может пожалеть о взятии.',
            'In this new position, take the pawn with your rook to see how a piece can come to regret a capture.',
          ),
          detail: copy(
            'Возьмите пешку ладьёй с c3 на c4. Виноватая фигура может ходить, но не может брать фигуры и шаховать.',
            'Capture the pawn on c4 with the rook from c3. A guilty piece can move, but cannot capture or give check.',
          ),
        },
        {
          id: 'guilty-still-blocks', kind: 'script', move: move('c8', 'c7'),
          text: copy(
            'Король чёрных может встать на c7: ладья с виной ему не угрожает.',
            'Black’s king can move to c7: the guilty rook does not threaten it.',
          ),
          detail: copy(
            'Ладья c4 не даёт шаха, но закрывает линию другой белой ладье на c1. Поэтому король может подойти по той же вертикали.',
            'The rook on c4 gives no check but still blocks the other white rook on c1. The king can therefore approach along the same file.',
          ),
        },
        {
          id: 'guilt-forbids-capture', kind: 'illegal', move: move('c4', 'd4'), reason: 'guiltCapture',
          text: copy(
            'Попробуйте взять следующую пешку ладьёй с виной.',
            'Try taking the next pawn with the guilty rook.',
          ),
          detail: copy(
            'Попробуйте взять ладьёй пешку на d4. Вина запрещает взятия.',
            'Try to capture the pawn on d4 with the rook. A guilt-ridden piece cannot capture.',
          ),
        },
        {
          id: 'guilt-quiet-move', kind: 'move', moves: [move('c4', 'c5')],
          expect: (_, state) => at(state, 'c5')?.affliction === 'guilt',
          text: copy(
            'Передвиньте ту же ладью на пустую клетку. Вина не мешает ходить без взятия.',
            'Move the same rook to an empty square. Guilt does not prevent quiet moves.',
          ),
          detail: copy(
            'Теперь передвиньте ту же ладью на свободную c5. Обычные ходы остаются доступны.',
            'Now move the same rook to the empty square c5. Quiet moves are still available.',
          ),
        },
      ],
    }],
  },
  {
    id: 'devastation-mercy',
    title: copy('Опустошение и милосердие', 'Devastation and mercy'),
    positions: [
      {
        setup: () => createPosition({ pieces: [
          ...kings, { side: 'white', type: 'rook', square: 'c3' },
          { side: 'black', type: 'pawn', square: 'c4' },
        ] }),
        steps: [
          {
            id: 'devastation-roll', kind: 'move', moves: [move('c3', 'c4')], roll: fixed(1, 'c3', 'c4'),
            expect: (_, state) => at(state, 'c4')?.devastationDue === state.turnSerial + 6,
            text: copy(
              'В новой позиции возьмите пешку ладьёй. Иногда фигура тяжело переживает взятие и впадает в опустошение.',
              'In this new position, take the pawn with your rook. A capture can be too much for a piece and leave it devastated.',
            ),
            detail: copy(
              'Ладьёй с c3 возьмите пешку на c4. При единице фигура впадает в опустошение.',
              'Capture the pawn on c4 with the rook from c3. Rolling a 1 causes devastation.',
            ),
          },
          {
            id: 'inspect-countdown', kind: 'inspect', square: 'c4',
            focus: { square: 'c4', subject: 'countdown' },
            text: copy(
              'Выберите опустошённую ладью, чтобы увидеть, сколько ей осталось до исчезновения.',
              'Select the devastated rook to see how long it has before it disappears.',
            ),
            detail: copy(
              'Цифра рядом с ладьёй показывает оставшееся время. Срок считают по завершённым ходам обеих сторон, а не по времени на часах.',
              'The number beside the rook shows its remaining time. This is counted in completed player turns, not time on a clock.',
            ),
          },
          {
            id: 'one-turn-half-cycle', kind: 'script', move: move('a8', 'b8'),
            expect: (_, state) => at(state, 'c4')?.devastationDue === state.turnSerial + 5,
            text: copy(
              'Чёрные ходят королём. Прошла половина одного цикла.',
              'Black moves its king. Half a cycle has passed.',
            ),
            detail: copy(
              'Чёрные завершают свой ход. С последнего взятия прошла половина цикла.',
              'Black completes a turn. Half a cycle has passed since the capture.',
            ),
          },
          {
            id: 'devastated-immobile', kind: 'illegal', move: move('c4', 'c5'), reason: 'devastated',
            text: copy(
              'Попробуйте передвинуть опустошённую ладью на пустую клетку.',
              'Try moving the devastated rook to an empty square.',
            ),
            detail: copy(
              'Попробуйте передвинуть ладью на c5. Опустошение лишило её ходов и шахов, но она всё ещё занимает клетку.',
              'Try to move the rook to c5. Devastation prevents it from moving or giving check, and it still occupies its square.',
            ),
          },
        ],
      },
      {
        setup: () => createPosition({ pieces: [
          ...kings, { side: 'white', type: 'rook', square: 'c3' },
          { side: 'black', type: 'knight', square: 'c4', affliction: 'devastated', devastationDue: 6 },
        ] }),
        steps: [
          {
            id: 'mercy-capture', kind: 'move', moves: [move('c3', 'c4')],
            expect: (events, state) => events.some(event => event.type === 'capture' && event.kind === 'mercy')
              && at(state, 'c4')?.captureReaction === 'unassigned'
              && !events.some(event => event.type === 'reaction'),
            text: copy(
              'Другой пример: теперь опустошён конь соперника. Возьмите его ладьёй.',
              'A new example: this time, your opponent’s knight is devastated. Capture it with your rook.',
            ),
            detail: copy(
              'Взятие опустошённой фигуры считается милосердным: она сама хочет уйти с доски. Такое взятие не вызывает реакции. Исключение — опустошённый слон; к нему вернёмся в следующем уроке.',
              'Taking a devastated piece is a mercy capture: the piece wants to leave the board. It causes no reaction in the capturer. A devastated bishop is an exception; bishops come next.',
            ),
          },
        ],
      },
      {
        setup: () => createPosition({ turnSerial: 4, pieces: [
          ...kings, { side: 'white', type: 'pawn', square: 'g2' },
          { side: 'white', type: 'rook', square: 'c4', affliction: 'devastated', devastationDue: 6 },
          { side: 'black', type: 'pawn', square: 'b7' },
        ] }),
        steps: [
          {
            id: 'near-expiry', kind: 'move', moves: [move('g2', 'g3')],
            expect: (_, state) => at(state, 'c4')?.devastationDue === state.turnSerial + 1,
            text: copy(
              'Ещё один пример: белой ладье остался один цикл, а помощи рядом нет. Сделайте ход пешкой.',
              'One more example: the white rook has one cycle left, with no help nearby. Move your pawn.',
            ),
            detail: copy(
              'В этой новой позиции у опустошённой ладьи остался один цикл. После хода белых и ответа чёрных она исчезнет, если её не исцелить.',
              'In this new position, the devastated rook has one cycle left. It will disappear after White’s move and Black’s reply unless it is healed.',
            ),
          },
          {
            id: 'self-removal', kind: 'script', move: move('a8', 'b8'),
            expect: events => events.some(event => event.type === 'remove' && event.piece.square === 'c4')
              && !events.some(event => event.type === 'capture'),
            text: copy(
              'Ход чёрных завершает отсчёт. Опустошённая ладья исчезает.',
              'Black’s turn finishes the countdown. The devastated rook disappears.',
            ),
            detail: copy(
              'После хода чёрных цикл завершится и ладья исчезнет.',
              'Black’s turn completes the cycle, and the rook disappears.',
            ),
          },
          {
            id: 'removal-material-only', kind: 'read',
            hud: 'material',
            text: copy(
              'Ладья не получила помощи и исчезла. Перевес +5 пропал, но значок взятой ладьи никому не добавился.',
              'The rook received no help and disappeared. Your +5 lead vanished, but neither player gained a captured-rook icon.',
            ),
            detail: copy(
              'Исчезновение изменило баланс фигур на доске. Никто не получил значок взятой ладьи.',
              'Self-removal changed the material balance. Neither player gets a rook in their captured row.',
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'bishop-help',
    title: copy('Помощь слона', 'Help from a bishop'),
    positions: [
      {
        setup: () => createPosition({ pieces: [
          ...kings, { side: 'white', type: 'bishop', square: 'c1' },
          { side: 'white', type: 'rook', square: 'e4', affliction: 'guilt',
            captureReaction: 'guilt', capturesSinceRebirth: 1 },
          { side: 'white', type: 'knight', square: 'f4', affliction: 'devastated', devastationDue: 6 },
          { side: 'black', type: 'pawn', square: 'e6' },
          { side: 'black', type: 'pawn', square: 'c5' },
        ] }),
        steps: [
          {
            id: 'start-two-cures', kind: 'move', moves: [move('c1', 'e3')],
            expect: (_, state) => at(state, 'e4')?.cureArmedAt === state.turnSerial
              && at(state, 'f4')?.cureArmedAt === state.turnSerial,
            text: copy(
              'В новой позиции подведите слона к ладье с виной и опустошённому коню. Слон лечит своих соседей.',
              'In this new position, bring your bishop beside the guilty rook and the devastated knight. Bishops heal nearby allies.',
            ),
            detail: copy(
              'Слон помогает всем своим фигурам на восьми соседних клетках, включая диагональные. Пока он их лечит, вы можете ходить другими фигурами.',
              'A bishop helps every allied piece on the eight adjacent squares, including diagonals. You may move other pieces while it heals them.',
            ),
          },
          {
            id: 'cure-opposing-turn', kind: 'script', move: move('a8', 'b8'),
            text: copy(
              'Чёрные ходят. Лечение ещё не завершено.',
              'Black moves. The healing is not complete yet.',
            ),
            detail: copy(
              'Через ход чёрных пройдёт половина цикла. Сохраните слона рядом с обеими фигурами.',
              'Black’s move uses half the cycle. Keep the bishop beside both pieces.',
            ),
          },
          {
            id: 'cure-two-pieces', kind: 'move', moves: [move('h1', 'g1')],
            expect: events => events.filter(event => event.type === 'cure' && event.cause === 'bishop').length === 2,
            text: copy(
              'Сделайте ход королём, оставив слона рядом с ладьёй и конём. Это завершит цикл лечения.',
              'Move your king, leaving the bishop beside the rook and knight. This completes the healing cycle.',
            ),
            detail: copy(
              'Сходите королём на g1. Через полный цикл слон снимет и вину ладьи, и опустошение коня.',
              'Move your king to g1. After a full cycle the bishop clears both the rook’s guilt and the knight’s devastation.',
            ),
          },
          {
            id: 'cure-complete', kind: 'script', move: move('b8', 'a8'),
            text: copy(
              'Обе фигуры исцелены. Чёрные отвечают королём.',
              'Both pieces are healed. Black replies with its king.',
            ),
            detail: copy(
              'Обе фигуры снова могут брать и шаховать. Чёрные возвращают короля на a8.',
              'Both pieces can capture and give check again. Black returns the king to a8.',
            ),
          },
          {
            id: 'bishop-pacifism', kind: 'illegal', move: move('e3', 'c5'), reason: 'bishopCapture',
            text: copy(
              'Попробуйте взять пешку слоном.',
              'Try taking the pawn with your bishop.',
            ),
            detail: copy(
              'Попробуйте взять пешку на c5 слоном. Слон — пацифист, ему доступны только пустые клетки по диагонали.',
              'Try to capture the pawn on c5 with the bishop. A pacifist bishop can only move to empty squares along a diagonal.',
            ),
          },
          {
            id: 'remembered-guilt', kind: 'move', moves: [move('e4', 'e6')],
            expect: events => events.some(event => event.type === 'reaction' && event.cause === 'memory'
              && event.affliction === 'guilt'),
            text: copy(
              'Ладья исцелена. Возьмите ею ещё одну пешку и посмотрите, вернётся ли вина.',
              'The rook is healed. Take another pawn with it and see whether guilt returns.',
            ),
            detail: copy(
              'Ладьёй возьмите пешку на e6. Слон снял состояние, но ладья запомнила свою реакцию и при взятии снова испытывает вину.',
              'Capture the pawn on e6 with the rook. Healing cleared its state, but the rook remembers its reaction and feels guilt again.',
            ),
          },
        ],
      },
      {
        setup: () => createPosition({ pieces: [
          ...kings, { side: 'white', type: 'knight', square: 'f3' },
          { side: 'black', type: 'bishop', square: 'e5' },
        ] }),
        steps: [
          {
            id: 'bishop-capture-cost', kind: 'move', moves: [move('f3', 'e5')],
            expect: (events, state) => events.some(event => event.type === 'reaction' && event.cause === 'bishop')
              && at(state, 'e5')?.affliction === 'devastated' && at(state, 'e5')?.captureReaction === 'unassigned',
            text: copy(
              'Другой пример: что произойдёт с фигурой, которая возьмёт мирного слона? Попробуйте взять его конём.',
              'A new example: what happens to a piece that takes a peaceful bishop? Try capturing it with the knight.',
            ),
            detail: copy(
              'Взятие слона вызывает опустошение без броска. Даже если слон сам опустошён, милосердным такое взятие не считается. Исключения — король и фигуры с яростью или жаждой крови.',
              'Taking a bishop causes devastation without a roll. Even if the bishop is devastated, taking it is not a mercy capture. Kings and pieces with berserk or bloodlust are exempt.',
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'shame-conversion',
    title: copy('Стыд и обращение', 'Shame and conversion'),
    positions: [
      {
        setup: () => createPosition({ pieces: [
          ...kings, { side: 'white', type: 'bishop', square: 'c1' },
          { side: 'white', type: 'bishop', square: 'g4' },
          { side: 'white', type: 'pawn', square: 'h2' },
          { side: 'black', type: 'rook', square: 'e4', captureReaction: 'guilt', capturesSinceRebirth: 1 },
          { side: 'black', type: 'knight', square: 'd4', affliction: 'berserk',
            captureReaction: 'berserk', capturesSinceRebirth: 1 },
          { side: 'black', type: 'pawn', square: 'e6' },
        ] }),
        steps: [
          {
            id: 'start-shame', kind: 'move', moves: [move('c1', 'e3')],
            expect: (_, state) => at(state, 'e4')?.shameArmedAt === state.turnSerial
              && at(state, 'd4')?.shameArmedAt === null,
            text: copy(
              'В новой позиции подведите своего слона к чёрной ладье. Рядом с чужим слоном фигура испытывает стыд.',
              'In this new position, bring your bishop beside the black rook. A piece feels shame next to an enemy bishop.',
            ),
            detail: copy(
              'Стыд действует и на фигуру с запомненной реакцией «Без изменений»: 4–5 относится только к её собственным взятиям. Король, ярость и жажда крови невосприимчивы к стыду.',
              'Shame can affect a piece whose remembered reaction is “Unaffected”: a 4 or 5 only concerns its own captures. Kings and pieces with berserk or bloodlust are immune to shame.',
            ),
          },
          {
            id: 'shame-half-cycle', kind: 'script', move: move('a8', 'b8'),
            text: copy(
              'Чёрные ходят. До первого эффекта стыда ещё полцикла.',
              'Black moves. Shame needs another half-cycle to take effect.',
            ),
            detail: copy(
              'Чёрные ходят королём. Ладья пока остаётся в обычном состоянии.',
              'Black moves its king. The rook remains unchanged for now.',
            ),
          },
          {
            id: 'shame-does-not-stack', kind: 'move', moves: [move('g4', 'f3')],
            expect: (_, state) => at(state, 'e4')?.affliction === 'guilt' && at(state, 'd4')?.affliction === 'berserk',
            text: copy(
              'Подведите к ладье второго слона. Этот ход завершит первый цикл стыда.',
              'Bring your second bishop beside the rook. This move completes the first cycle of shame.',
            ),
            detail: copy(
              'Первый слон остаётся рядом с ладьёй. Второй слон не ускорит эффект: за один полный цикл состояние ухудшится только на один этап.',
              'The first bishop stays beside the rook. Adding another bishop does not speed up the effect: its state worsens by only one stage per full cycle.',
            ),
          },
          {
            id: 'shame-second-cycle', kind: 'script', move: move('b8', 'a8'),
            text: copy(
              'Чёрные отвечают. Начинается следующий цикл стыда.',
              'Black replies. The next cycle of shame begins.',
            ),
            detail: copy(
              'Слоны остаются рядом, поэтому отсчёт продолжается. Если соседство прервётся, незавершённый цикл придётся начать заново, но уже возникшая вина останется.',
              'The bishops stay nearby, so the countdown continues. Breaking contact resets an unfinished cycle, but does not clear guilt that has already taken hold.',
            ),
          },
          {
            id: 'shame-devastation', kind: 'move', moves: [move('h2', 'h3')],
            expect: (_, state) => at(state, 'e4')?.affliction === 'devastated',
            text: copy(
              'Оставьте слонов рядом с ладьёй и сделайте ход пешкой. Завершится второй цикл стыда.',
              'Keep the bishops beside the rook and move your pawn. This completes the second cycle of shame.',
            ),
            detail: copy(
              'Продвиньте пешку на h3. В конце второго цикла ладья станет опустошённой.',
              'Advance the pawn to h3. At the end of the second cycle the rook becomes devastated.',
            ),
          },
          {
            id: 'shame-third-cycle', kind: 'script', move: move('a8', 'b8'),
            text: copy(
              'Чёрные ходят. До обращения ладьи остался один ход.',
              'Black moves. The rook is one turn away from conversion.',
            ),
            detail: copy(
              'Чёрные ходят королём. До обращения остался один ход.',
              'Black moves its king. Conversion is one turn away.',
            ),
          },
          {
            id: 'convert-rook', kind: 'move', moves: [move('h3', 'h4')],
            expect: (events, state) => events.some(event => event.type === 'convert' && event.piece.square === 'e4')
              && at(state, 'e4')?.side === 'white' && at(state, 'e4')?.captureReaction === 'unassigned'
              && at(state, 'e4')?.capturesSinceRebirth === 0,
            text: copy(
              'Сделайте ещё один ход пешкой. За третий цикл слон обратит ладью в вашу армию.',
              'Move your pawn once more. On the third cycle, the bishop will bring the rook to your side.',
            ),
            detail: copy(
              'Ладья перейдёт к белым на той же клетке. Если фигура испытывала вину или опустошение ещё до соседства со слоном, цепочка начинается с этого состояния — заново проходить все три этапа не нужно.',
              'The rook will join White on the same square. If a piece was already guilty or devastated before meeting the bishop, shame starts from that state; it does not repeat all three stages.',
            ),
          },
          {
            id: 'converted-piece-ready', kind: 'script', move: move('b8', 'a8'),
            text: copy(
              'Чёрные отвечают. Обращённая ладья забыла прежнюю реакцию.',
              'Black replies. The converted rook has forgotten its old reaction.',
            ),
            detail: copy(
              'Ладья теперь принадлежит белым. Её прежнее состояние и реакция сняты, число взятий обнулилось.',
              'The rook now belongs to White. Its old state and reaction are cleared, and its capture count is zero.',
            ),
          },
          {
            id: 'rebirth-new-roll', kind: 'move', moves: [move('e4', 'e6')], roll: fixed(4, 'e4', 'e6'),
            expect: events => events.some(event => event.type === 'reaction' && event.face === 4),
            text: copy(
              'Возьмите пешку ладьёй, которая теперь принадлежит вам. После обращения её реакцию снова определит кубик.',
              'Take the pawn with the rook that has joined your side. After changing sides, it needs a new roll to set its reaction.',
            ),
            detail: copy(
              'Новой белой ладьёй возьмите пешку на e6. При первом взятии после обращения она снова бросает кубик.',
              'Use your new white rook to capture the pawn on e6. Its first capture after conversion rolls the die again.',
            ),
          },
        ],
      },
      {
        setup: () => createPosition({ pieces: [
          ...kings, { side: 'white', type: 'bishop', square: 'c1' },
          { side: 'white', type: 'rook', square: 'e4', affliction: 'guilt', captureReaction: 'guilt',
            capturesSinceRebirth: 1 },
          { side: 'black', type: 'bishop', square: 'f5' },
        ] }),
        steps: [
          {
            id: 'parry-shame', kind: 'move', moves: [move('c1', 'e3')],
            expect: (_, state) => at(state, 'e4')?.shameArmedAt === null
              && at(state, 'e4')?.affliction === 'guilt' && at(state, 'e4')?.cureArmedAt === state.turnSerial,
            text: copy(
              'В новой позиции чужой слон угрожает вашей ладье. Подведите своего слона, чтобы остановить стыд и начать лечение.',
              'In this new position, an enemy bishop threatens your rook with shame. Bring your bishop beside the rook to protect and heal it.',
            ),
            detail: copy(
              'Ладье на e4 угрожает чёрный слон. Передвиньте своего слона на e3, чтобы сразу остановить стыд и начать лечение.',
              'The black bishop is shaming the rook on e4. Move your bishop to e3 to stop shame immediately and begin healing.',
            ),
          },
          {
            id: 'protected-but-still-guilty', kind: 'script', move: move('a8', 'b8'),
            expect: (_, state) => at(state, 'e4')?.affliction === 'guilt',
            text: copy(
              'Стыд остановлен. Для лечения нужно ещё полцикла.',
              'Shame has stopped. Healing needs another half-cycle.',
            ),
            detail: copy(
              'Ладья под защитой. Лечение завершится через полный цикл соседства.',
              'The rook is protected. Healing still takes one full cycle of contact.',
            ),
          },
          {
            id: 'protected-cure-matures', kind: 'move', moves: [move('h1', 'g1')],
            expect: events => events.some(event => event.type === 'cure'
              && event.piece.square === 'e4' && event.cause === 'bishop'),
            text: copy(
              'Сделайте ход королём. Полный цикл рядом со своим слоном снимет вину ладьи.',
              'Move your king. A full cycle beside its friendly bishop will clear the rook’s guilt.',
            ),
            detail: copy(
              'Сходите королём на g1. Когда цикл завершится, вина ладьи исчезнет.',
              'Move your king to g1. The rook’s guilt clears as the cycle completes.',
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'king-rally',
    title: copy('Король собирает войска', 'The king rallies the troops'),
    positions: [{
      setup: () => createPosition({ pieces: [
        ...kings, { side: 'white', type: 'rook', square: 'f2', affliction: 'guilt' },
        { side: 'white', type: 'knight', square: 'f3', affliction: 'devastated', devastationDue: 6 },
        { side: 'white', type: 'knight', square: 'h3', affliction: 'berserk', captureReaction: 'berserk',
          capturesSinceRebirth: 1 },
        { side: 'black', type: 'bishop', square: 'h2' },
        { side: 'black', type: 'rook', square: 'f1', affliction: 'guilt' },
      ] }),
      steps: [
        {
          id: 'rally-two-pieces', kind: 'move', moves: [move('h1', 'g2')],
          expect: (events, state) => events.filter(event => event.type === 'cure' && event.cause === 'rally').length === 2
            && at(state, 'h3')?.affliction === 'berserk' && at(state, 'f1')?.affliction === 'guilt',
          text: copy(
            'В новой позиции подведите короля к ладье и коню. Король помогает соседним союзникам сразу.',
            'In this new position, bring the king beside the rook and knight. The king helps neighboring allies immediately.',
          ),
          detail: copy(
            'Помощь короля действует на восемь соседних клеток, как у слона, но ждать цикл не нужно. Можно подвести короля к фигуре или саму фигуру к королю. Чужие фигуры и ярость остаются без изменений.',
            'The king helps allies on the eight adjacent squares, like a bishop, but without waiting a cycle. Move the king beside a piece or the piece beside its king. Enemy pieces and berserk remain unchanged.',
          ),
        },
        {
          id: 'king-response', kind: 'script', move: move('a8', 'b8'),
          text: copy(
            'Чёрные отвечают королём: a8 → b8.',
            'Black replies with its king: a8 → b8.',
          ),
          detail: copy(
            'После любого действия свой король должен быть вне шаха. Если эффекты в конце хода создадут шах, дополнительное действие может помочь это предотвратить.',
            'Your king must be safe after every action. If effects at the end of the turn would expose it to check, an extra action may let you prevent that.',
          ),
        },
        {
          id: 'king-captures-without-roll', kind: 'move', moves: [move('g2', 'h2')],
          expect: (events, state) => events.some(event => event.type === 'capture' && event.victim.type === 'bishop')
            && !events.some(event => event.type === 'reaction') && at(state, 'h2')?.affliction === 'neutral',
          text: copy(
            'Возьмите чёрного слона королём. Посмотрите, действует ли на него опустошение за слона.',
            'Take the black bishop with your king. See whether taking a bishop devastates it.',
          ),
          detail: copy(
            'Король не получает вину, опустошение, ярость или жажду крови и не может перейти к сопернику. При этом его нельзя оставлять под шахом. Королей не берут: цель партии — мат.',
            'A king cannot gain guilt, devastation, berserk, or bloodlust, and cannot change sides. It must still stay out of check. Kings are never captured: the goal is checkmate.',
          ),
        },
      ],
    }],
  },
  {
    id: 'knight-berserk-bloodlust',
    title: copy('Конь, ярость и жажда крови', 'Knight, berserk, and bloodlust'),
    positions: [{
      setup: () => createPosition({ pieces: [
        ...kings, { side: 'white', type: 'knight', square: 'b1' },
        { side: 'white', type: 'rook', square: 'f5' },
        { side: 'black', type: 'pawn', square: 'd2' },
        { side: 'black', type: 'pawn', square: 'f3' },
        { side: 'black', type: 'bishop', square: 'h4' },
        { side: 'black', type: 'pawn', square: 'g7' },
      ] }),
      steps: [
        {
          id: 'knight-free-capture', kind: 'move', moves: [move('b1', 'd2')],
          expect: (events, state) => at(state, 'd2')?.capturesSinceRebirth === 1
            && !events.some(event => event.type === 'reaction'),
          text: copy(
            'В новой позиции возьмите пешку конём. Конь обучен бою, поэтому за такое первое взятие кубик не нужен.',
            'In this new position, take the pawn with your knight. Knights are trained for battle, so a first capture like this needs no roll.',
          ),
          detail: copy(
            'Льгота действует только на первое взятие коня. Милосердное тоже засчитывается первым. Взятие слона всё равно вызывает опустошение, как в уроке о слонах.',
            'The exemption applies only to a knight’s first capture. A mercy capture also counts as its first. Taking a bishop still causes devastation, as in the bishop lesson.',
          ),
        },
        {
          id: 'knight-between-captures', kind: 'script', move: move('a8', 'b8'),
          text: copy(
            'Чёрные отвечают. Конь уже взял одну фигуру; следующее взятие пешки потребует броска.',
            'Black replies. The knight has taken one piece; taking the next pawn will need a roll.',
          ),
          detail: copy(
            'После первого взятия к коню применяются те же реакции, что к другим фигурам. Милосердие и взятие слона остаются отдельными исключениями.',
            'After its first capture, the knight uses the same reactions as other pieces. Mercy and taking a bishop remain separate exceptions.',
          ),
        },
        {
          id: 'knight-second-capture-six', kind: 'move', moves: [move('d2', 'f3')], roll: fixed(6, 'd2', 'f3'),
          expect: (events, state) => events.some(event => event.type === 'reaction' && event.face === 6)
            && at(state, 'f3')?.affliction === 'berserk' && state.phase === 'bonus' && state.turnSerial === 2,
          text: copy(
            'Возьмите конём вторую пешку. Теперь его реакцию определит кубик.',
            'Take the second pawn with your knight. The die will now set its reaction.',
          ),
          detail: copy(
            'При шестёрке конь впадёт в ярость и получит второе действие в этот же ход. Оно необязательно, если ход можно безопасно завершить.',
            'A 6 makes the knight go berserk and earns it a second action this turn. That action is optional if ending the turn is safe.',
          ),
        },
        {
          id: 'bonus-bishop-and-third-capture', kind: 'move', moves: [move('f3', 'h4')],
          expect: (events, state) => state.turnSerial === 3 && state.phase === 'primary' && state.side === 'black'
            && at(state, 'h4')?.affliction === 'bloodlust' && at(state, 'h4')?.capturesSinceRebirth === 3
            && events.some(event => event.type === 'capture' && event.victim.type === 'bishop')
            && !events.some(event => event.type === 'reaction' || event.type === 'bonus'),
          text: copy(
            'Используйте дополнительное действие тем же конём: возьмите слона. Ярость защищает от опустошения за такое взятие.',
            'Use the extra action with the same knight to take the bishop. Berserk protects it from devastation for this capture.',
          ),
          detail: copy(
            'Пока конь в ярости, дополнительное действие может быть обычным ходом. Тем же конём возьмите слона на h4. Ярость защищает от опустошения за взятие слона, а третье взятие вызовет жажду крови.',
            'The knight can still use its bonus for a quiet move while it is berserk. Use it to capture the bishop on h4. Berserk ignores the bishop’s penalty, and the third capture triggers bloodlust.',
          ),
        },
        {
          id: 'only-one-bonus', kind: 'script', move: move('b8', 'a8'),
          text: copy(
            'Белые закончили оба действия. Теперь отвечают чёрные.',
            'White has finished both actions. Black replies next.',
          ),
          detail: copy(
            'Конь уже сделал два действия, и теперь ходят чёрные. Счётчики циклов продвинулись один раз за весь ход белых.',
            'The knight has used its two actions, so Black moves next. Cycle timers advanced only once for White’s whole turn.',
          ),
        },
        {
          id: 'bloodlust-forbids-quiet', kind: 'illegal', move: move('h4', 'g2'), reason: 'bloodlustMove',
          text: copy(
            'Попробуйте прыгнуть конём с жаждой крови на пустую клетку.',
            'Try moving the bloodlust knight to an empty square.',
          ),
          detail: copy(
            'Попробуйте прыгнуть на пустую g2. При жажде крови коню доступны только взятия, в том числе в дополнительном действии.',
            'Try to jump to the empty square g2. Bloodlust allows only captures, including on the bonus action.',
          ),
        },
        {
          id: 'friendly-capture', kind: 'move', moves: [move('h4', 'f5')],
          expect: (events, state) => events.some(event => event.type === 'capture' && event.friendly)
            && state.phase === 'bonus',
          text: copy(
            'Для примера возьмите конём свою ладью. Жажда крови разрешает брать союзников.',
            'For this exercise, take your own rook with the knight. Bloodlust allows friendly captures.',
          ),
          detail: copy(
            'Возьмите свою ладью на f5. Жажда крови разрешает взятие союзной фигуры, кроме короля. В истории появится потеря своей фигуры, а ряд взятых фигур соперника останется прежним.',
            'Capture your own rook on f5. Bloodlust can take friendly pieces other than the king. The log records a friendly loss and the captured-enemy rows stay unchanged.',
          ),
        },
        {
          id: 'decline-optional-bonus', kind: 'move', moves: [{ type: 'endTurn' }],
          expect: (_, state) => state.phase === 'primary' && state.side === 'black',
          text: copy(
            'Второе взятие необязательно. Завершите ход и передайте очередь чёрным.',
            'A second capture is optional. End your turn and let Black move.',
          ),
          detail: copy(
            'Конь может взять пешку на g7, но теперь нажмите «Завершить ход». Дополнительное действие можно пропустить, если король после расчёта эффектов в безопасности.',
            'The knight could capture the pawn on g7. This time press “End turn.” You can skip the bonus if your king stays safe after end-of-turn effects.',
          ),
        },
      ],
    }],
  },
  {
    id: 'promotion',
    title: copy('Превращение', 'Promotion'),
    positions: [
      {
        setup: () => createPosition({ pieces: [
          ...kings, { side: 'white', type: 'pawn', square: 'g7', affliction: 'guilt',
            captureReaction: 'guilt', capturesSinceRebirth: 2 },
          { side: 'black', type: 'pawn', square: 'b7' },
        ] }),
        steps: [
          {
            id: 'promote-inherit', kind: 'move',
            moves: [move('g7', 'g8', 'queen'), move('g7', 'g8', 'rook'), move('g7', 'g8', 'knight')],
            expect: (events, state) => events.some(event => event.type === 'promotion')
              && at(state, 'g8')?.affliction === 'guilt' && at(state, 'g8')?.captureReaction === 'guilt'
              && at(state, 'g8')?.capturesSinceRebirth === 2,
            text: copy(
              'В новой позиции доведите пешку до последней горизонтали и выберите ферзя, ладью или коня. Сохранится ли её вина?',
              'In this new position, advance the pawn to the last rank and choose a queen, rook, or knight. Will its guilt remain?',
            ),
            detail: copy(
              'Эта пешка уже взяла две фигуры и запомнила вину. Ферзь, ладья и конь сохранят её состояние, реакцию и число взятий. У коня первое взятие бывает без броска только при нулевом счёте и ещё не определённой реакции.',
              'This pawn has already taken two pieces and remembers guilt. A queen, rook, or knight keeps its state, reaction, and capture count. A knight only gets a first capture without rolling if its count is zero and its reaction is still unassigned.',
            ),
          },
          {
            id: 'promoted-material', kind: 'read',
            hud: 'material',
            text: copy(
              'Вместо пешки у вас теперь более ценная фигура — число перевеса выросло. Ряд взятых фигур остался прежним.',
              'You now have a more valuable piece in place of the pawn, so your material lead has grown. The captured-piece row is unchanged.',
            ),
            detail: copy(
              'Превращение изменило стоимость фигур на доске. Это не взятие: исчезнувшая пешка не добавляется ни в чей ряд трофеев.',
              'Promotion changed the value of the pieces on the board. It is not a capture: the pawn is not added to either player’s captured pieces.',
            ),
          },
        ],
      },
      {
        setup: () => createPosition({ pieces: [
          { side: 'white', type: 'king', square: 'd1' }, { side: 'black', type: 'king', square: 'a8' },
          { side: 'white', type: 'pawn', square: 'g7', capturesSinceRebirth: 1 },
          { side: 'black', type: 'rook', square: 'h8' },
          { side: 'black', type: 'pawn', square: 'e6' },
        ] }),
        steps: [
          {
            id: 'bishop-promotion-rebirth', kind: 'move',
            moves: [move('g7', 'h8', 'bishop')], roll: fixed(6, 'g7', 'h8'),
            expect: (events, state) => events.some(event => event.type === 'reaction' && event.face === 6)
              && events.some(event => event.type === 'promotion' && event.promotion === 'bishop')
              && at(state, 'h8')?.captureReaction === 'unassigned' && at(state, 'h8')?.affliction === 'neutral'
              && at(state, 'h8')?.capturesSinceRebirth === 0 && state.phase === 'primary',
            text: copy(
              'Другой пример: возьмите ладью пешкой и выберите превращение в слона.',
              'A new example: capture the rook with your pawn and choose to promote it to a bishop.',
            ),
            detail: copy(
              'Сначала выберите слона. Затем пешка отреагирует на взятие, а превращение снимет это состояние. Слон также забудет прежнюю реакцию и начнёт с нулевым числом взятий.',
              'Choose the bishop first. The pawn then reacts to the capture, and promotion clears that state. The bishop also forgets the old reaction and resets its capture count.',
            ),
          },
          {
            id: 'promotion-clears-bonus', kind: 'read',
            text: copy(
              'Ферзь, ладья и конь сохраняют состояние пешки, её реакцию и число взятий. При превращении в слона состояние и реакция исчезают, а счёт взятий обнуляется.',
              'A queen, rook, or knight keeps the pawn’s state, remembered reaction, and capture count. Promoting to a bishop clears the state and reaction and resets the capture count.',
            ),
            detail: copy(
              'Превращение в слона снимает даже ярость и жажду крови. Вместе с яростью исчезает и дополнительное действие. Сам слон не берёт фигуры.',
              'Becoming a bishop clears even berserk and bloodlust. Clearing berserk also removes the extra action. The bishop itself cannot capture.',
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'final-decision',
    title: copy('Последнее решение с подсказкой', 'One last guided decision'),
    positions: [{
      setup: () => createPosition({ pieces: [
        { side: 'white', type: 'king', square: 'g1' },
        { side: 'white', type: 'rook', square: 'a1', affliction: 'guilt',
          captureReaction: 'guilt', capturesSinceRebirth: 1 },
        { side: 'white', type: 'knight', square: 'c3', affliction: 'devastated', devastationDue: 6 },
        { side: 'white', type: 'bishop', square: 'f1' },
        { side: 'white', type: 'rook', square: 'e1' },
        { side: 'white', type: 'pawn', square: 'd4' },
        { side: 'white', type: 'pawn', square: 'e4' },
        { side: 'white', type: 'pawn', square: 'h3' },
        { side: 'black', type: 'king', square: 'g8' },
        { side: 'black', type: 'bishop', square: 'f8' },
        { side: 'black', type: 'rook', square: 'd8' },
        { side: 'black', type: 'knight', square: 'b8' },
        { side: 'black', type: 'pawn', square: 'c5' },
        { side: 'black', type: 'pawn', square: 'c6' },
        { side: 'black', type: 'pawn', square: 'h7' },
        { side: 'black', type: 'pawn', square: 'g4' },
      ] }),
      steps: [
        {
          id: 'final-lesson-capture', kind: 'move', moves: [move('d4', 'c5')], roll: fixed(4, 'd4', 'c5'),
          expect: events => events.some(event => event.type === 'capture' && event.victim.square === 'c5'),
          text: copy(
            'Последний пример можно доиграть после обучения. Начните со взятия чёрной пешки.',
            'You can play on from this final example after the tutorial. Start by taking the black pawn.',
          ),
          detail: copy(
            'В этой позиции есть ладья с виной и опустошённый конь. Начните со взятия пешкой; затем сами выберете, что делать дальше.',
            'This position has a guilty rook and a devastated knight. Start with the pawn capture, then choose what to do next.',
          ),
        },
        {
          id: 'open-defense', kind: 'script', move: move('b8', 'a6'),
          text: copy(
            'Чёрный конь выходит на a6 и угрожает пешке c5.',
            'Black’s knight moves to a6 and threatens the c5 pawn.',
          ),
          detail: copy(
            'Чёрный конь выходит на a6 и угрожает пешке на c5.',
            'The black knight moves to a6 and threatens the pawn on c5.',
          ),
        },
        {
          id: 'open-quiet-choice', kind: 'move', moves: 'open',
          text: copy(
            'В этом упражнении выберите ход без взятия. Нажмите на фигуру, чтобы увидеть доступные клетки. Можно помочь коню своим слоном.',
            'For this exercise, choose a move without a capture. Select a piece to see the available squares. You could help the knight with your bishop.',
          ),
          detail: copy(
            'Опустошённому коню нужно успеть помочь до конца отсчёта. Попробуйте применить правило лечения или выберите другой подсвеченный ход без взятия.',
            'The devastated knight needs help before its countdown ends. Try applying the healing rule, or choose another highlighted move without a capture.',
          ),
        },
        {
          id: 'open-legal-reply', kind: 'script', move: 'reply',
          expect: (_, state) => state.phase === 'primary' && state.side === 'white' && state.outcome === null,
          text: copy(
            'Чёрные отвечают. Следующий ход будет вашим.',
            'Black replies. The next turn will be yours.',
          ),
          detail: copy(
            'Чёрные отвечают допустимым ходом. Следующее решение снова за вами.',
            'Black makes a legal reply. The next decision is yours.',
          ),
        },
        {
          id: 'practice-ready', kind: 'read',
          text: copy(
            'Теперь можно доиграть эту позицию с ИИ без учебных ограничений или начать новую партию.',
            'You can now play on against the AI without tutorial restrictions, or start a new game.',
          ),
          detail: copy(
            'В продолжении фигуры сохранят свои состояния и запомненные реакции. Это тренировочная партия: рейтинг не меняется.',
            'If you continue, the pieces keep their states and remembered reactions. This is a practice game and does not affect your rating.',
          ),
        },
      ],
    }],
  },
]

// Append acknowledged explanations without inserting/reordering saved steps.
export const LESSONS: readonly Lesson[] = lessonPositions.map(lesson => ({
  ...lesson,
  positions: lesson.positions.map(position => ({
    ...position,
    steps: position.steps.map(step => TEACHING_BEATS[step.id]
      ? { ...step, after: TEACHING_BEATS[step.id] }
      : step),
  })),
}))
