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
            'Цель — поставить мат. Здесь взятия меняют состояние фигур. Начнём с белой пешки: e2 → e4.',
            'The goal is checkmate. Here, captures affect a piece’s state. Start with the white pawn: e2 → e4.',
          ),
          detail: copy(
            'Цель партии — поставить мат. Выберите белую пешку e2 и передвиньте её на выделенную клетку e4.',
            'The goal is checkmate. Select the white pawn on e2 and move it to the highlighted square e4.',
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
            'При первом взятии кубик покажет, как ваша пешка его переживёт. Возьмите пешку: e4 → d5.',
            'On its first capture, the die shows how your pawn reacts. Capture the pawn: e4 → d5.',
          ),
          detail: copy(
            'Возьмите чёрную пешку на d5. Первое обычное взятие определяет реакцию вашей фигуры броском кубика.',
            'Capture the black pawn on d5. A piece’s first ordinary capture uses the die to determine its reaction.',
          ),
        },
        {
          id: 'faces-and-material', kind: 'read',
          hud: 'captures',
          text: copy(
            'Посмотрите под своё имя: там взятая пешка. Рядом +1 — ваш перевес по фигурам на доске.',
            'Look below your name: there is the captured pawn. The +1 beside it is your material lead on the board.',
          ),
          detail: copy(
            'Пешка запомнила выпавшую реакцию. 1 — опустошение, 2–3 — вина, 4–5 — без изменений, 6 — ярость. Под вашим именем появилась взятая пешка, а +1 показывает перевес по фигурам на доске.',
            'Your pawn remembers the result. A 1 devastates, 2–3 bring guilt, 4–5 leave it unaffected, and 6 brings berserk. The pawn below your name records the capture, while +1 shows your material lead on the board.',
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
            'Фигура может жалеть о взятии — это вина. Возьмите пешку ладьёй: c3 → c4.',
            'A piece may regret a capture — that is guilt. Capture the pawn with your rook: c3 → c4.',
          ),
          detail: copy(
            'Возьмите пешку ладьёй с c3 на c4. Виноватая фигура может ходить, но не может брать фигуры и шаховать.',
            'Capture the pawn on c4 with the rook from c3. A guilty piece can move, but cannot capture or give check.',
          ),
        },
        {
          id: 'guilty-still-blocks', kind: 'script', move: move('c8', 'c7'),
          text: copy(
            'Король чёрных идёт на c7: виноватая ладья больше не шахует.',
            'Black’s king moves to c7: the guilty rook no longer gives check.',
          ),
          detail: copy(
            'Король чёрных спокойно идёт на c7. Ладья на c4 перестала шаховать, а её корпус по-прежнему перекрывает линию ладье на c1.',
            'The black king can safely move to c7. The guilty rook on c4 gives no check and still blocks the rook on c1.',
          ),
        },
        {
          id: 'guilt-forbids-capture', kind: 'illegal', move: move('c4', 'd4'), reason: 'guiltCapture',
          text: copy(
            'Попробуйте взять пешку: c4 → d4. Вина запрещает взятия.',
            'Try the capture: c4 → d4. Guilt prevents captures.',
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
            'Теперь передвиньте ладью: c4 → c5. Ход без взятия разрешён.',
            'Now move the rook: c4 → c5. A quiet move is allowed.',
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
              'Бывает, фигура не может пережить взятие — это опустошение. Возьмите пешку ладьёй: c3 → c4.',
              'Sometimes a piece cannot bear a capture — that is devastation. Capture the pawn with your rook: c3 → c4.',
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
              'До исчезновения ладьи — три полных цикла. За цикл оба игрока делают по одному ходу.',
              'The rook has three full cycles before it disappears. In each cycle, both players take one turn.',
            ),
            detail: copy(
              'Выберите ладью на c4 и посмотрите на счётчик. Он начнётся с трёх полных циклов. Каждый цикл включает два завершённых хода, по одному за сторону.',
              'Select the rook on c4 and look at its countdown. It starts at three full cycles. Each cycle includes two completed turns, one per side.',
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
              'Попробуйте передвинуть ладью: c4 → c5. Опустошённая фигура неподвижна.',
              'Try moving the rook: c4 → c5. A devastated piece cannot move.',
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
              'Возьмите опустошённого коня: c3 → c4. Это взятие не вызовет реакции.',
              'Capture the devastated knight: c3 → c4. This capture causes no reaction.',
            ),
            detail: copy(
              'Возьмите опустошённого коня на c4. При милосердном взятии ладья оставит своё состояние прежним, а конь появится в ряду взятых фигур.',
              'Capture the devastated knight on c4. A mercy capture leaves the rook’s state unchanged and records the knight in the captured row.',
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
              'В этой позиции ладье остался 1 цикл, а помощь не успеет. Передвиньте пешку: g2 → g3.',
              'In this position, the rook has 1 cycle left and help will come too late. Move the pawn: g2 → g3.',
            ),
            detail: copy(
              'В этой позиции у опустошённой ладьи остался один цикл. Сделайте ход пешкой с g2 на g3.',
              'The devastated rook has one cycle left in this position. Move the pawn from g2 to g3.',
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
              'Слон помогает своим соседям: здесь ладье с виной и опустошённому коню. Передвиньте слона: c1 → e3.',
              'A bishop helps nearby allies: here, a guilty rook and a devastated knight. Move the bishop: c1 → e3.',
            ),
            detail: copy(
              'Передвиньте слона с c1 на e3. Отпущение вины начнётся одновременно у двух соседних фигур.',
              'Move the bishop from c1 to e3. Absolution begins on both neighboring pieces at the same time.',
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
              'Передвиньте короля: h1 → g1. Это завершит цикл лечения.',
              'Move your king: h1 → g1. This completes the healing cycle.',
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
              'Попробуйте взять пешку слоном: e3 → c5. Слон не может брать фигуры.',
              'Try the bishop capture: e3 → c5. Bishops cannot capture pieces.',
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
              'Возьмите пешку ладьёй: e4 → e6. Запомненная вина вернётся без кубика.',
              'Capture with the rook: e4 → e6. Its remembered guilt returns without a roll.',
            ),
            detail: copy(
              'Ладьёй возьмите пешку на e6. Слон снял состояние, но ладья запомнила свою реакцию и при взятии снова испытывает вину.',
              'Capture the pawn on e6 with the rook. Absolution cleared its state, but the rook remembers its reaction and feels guilt again.',
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
              'Возьмите слона конём: f3 → e5. Взятие слона вызовет опустошение.',
              'Capture the bishop with the knight: f3 → e5. Taking a bishop causes devastation.',
            ),
            detail: copy(
              'Возьмите слона конём с f3. Даже для коня при первом взятии слон вызывает опустошение без броска.',
              'Capture the bishop with the knight from f3. Taking a bishop causes devastation without a roll, even on a knight’s first capture.',
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
              'Свой слон лечит, вражеский вызывает стыд. Подведите слона к чёрной ладье: c1 → e3.',
              'A friendly bishop heals; an enemy bishop causes shame. Bring your bishop beside the black rook: c1 → e3.',
            ),
            detail: copy(
              'Поставьте слона на e3 рядом с чёрной ладьёй. Соседство запускает стыд. Конь d4 в ярости к нему невосприимчив.',
              'Move the bishop to e3 next to the black rook. This starts shame. The berserk knight on d4 is immune.',
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
              'Сохраните соседство с ладьёй и завершите цикл вторым слоном: g4 → f3.',
              'Keep a bishop beside the rook and finish the cycle with your second bishop: g4 → f3.',
            ),
            detail: copy(
              'Поставьте второго слона на f3. Два соседних слона действуют с той же скоростью, что и один. Через полный цикл ладья испытывает вину.',
              'Bring the second bishop to f3. Two adjacent bishops work at the same rate as one. At the end of the cycle the rook feels guilt.',
            ),
          },
          {
            id: 'shame-second-cycle', kind: 'script', move: move('b8', 'a8'),
            text: copy(
              'Чёрные отвечают. Начинается следующий цикл стыда.',
              'Black replies. The next cycle of shame begins.',
            ),
            detail: copy(
              'Соседство продолжается. С вины начинается новый цикл стыда.',
              'The bishops stay nearby. Guilt starts a fresh cycle of shame.',
            ),
          },
          {
            id: 'shame-devastation', kind: 'move', moves: [move('h2', 'h3')],
            expect: (_, state) => at(state, 'e4')?.affliction === 'devastated',
            text: copy(
              'Ещё цикл рядом со слоном усилит стыд. Завершите его ходом пешки: h2 → h3.',
              'Another cycle beside the bishop will deepen shame. Complete it with a pawn move: h2 → h3.',
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
              'Третий цикл рядом со слоном обратит ладью в вашу армию. Завершите его: h3 → h4.',
              'A third cycle beside the bishop will convert the rook to your army. Complete it: h3 → h4.',
            ),
            detail: copy(
              'Сыграйте h4. Ладья перейдёт к белым на той же клетке. Обращение меняет баланс материала без взятия.',
              'Play h4. The rook joins White on the same square. Conversion changes the material balance without a capture.',
            ),
          },
          {
            id: 'converted-piece-ready', kind: 'script', move: move('b8', 'a8'),
            text: copy(
              'Чёрные отвечают. Обращённая ладья забыла прежнюю реакцию.',
              'Black replies. The converted rook has forgotten its old reaction.',
            ),
            detail: copy(
              'После обращения ладья начинает с чистого листа. Она утратила прежнюю реакцию и счётчик взятий.',
              'The converted rook gets a fresh start. It loses its previous reaction and capture count.',
            ),
          },
          {
            id: 'rebirth-new-roll', kind: 'move', moves: [move('e4', 'e6')], roll: fixed(4, 'e4', 'e6'),
            expect: events => events.some(event => event.type === 'reaction' && event.face === 4),
            text: copy(
              'Новой белой ладьёй возьмите пешку: e4 → e6. Она снова бросит кубик.',
              'Capture with your new white rook: e4 → e6. It will roll the die again.',
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
              'Передвиньте своего слона: c1 → e3. Он защитит ладью и начнёт лечение.',
              'Move your bishop: c1 → e3. It will protect the rook and start healing it.',
            ),
            detail: copy(
              'Ладье на e4 угрожает чёрный слон. Передвиньте своего слона на e3, чтобы сразу остановить стыд и начать лечение.',
              'The black bishop is shaming the rook on e4. Move your bishop to e3 to stop shame immediately and begin absolution.',
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
              'The rook is protected. Absolution still takes one full cycle of contact.',
            ),
          },
          {
            id: 'protected-cure-matures', kind: 'move', moves: [move('h1', 'g1')],
            expect: events => events.some(event => event.type === 'cure'
              && event.piece.square === 'e4' && event.cause === 'bishop'),
            text: copy(
              'Передвиньте короля: h1 → g1. Вина ладьи исчезнет.',
              'Move your king: h1 → g1. The rook’s guilt will clear.',
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
            'Король поддерживает своих соседей сразу, без ожидания. Подведите его к ладье и коню: h1 → g2.',
            'The king supports nearby allies immediately, without waiting. Bring it beside the rook and knight: h1 → g2.',
          ),
          detail: copy(
            'Передвиньте короля с h1 на g2. Сбор войск сразу снимет вину и опустошение со своих соседей. Конь в ярости и чёрная ладья сохранят свои состояния.',
            'Move the king from h1 to g2. Rally the Troops instantly clears nearby friendly guilt and devastation. The berserk knight and the black rook keep their states.',
          ),
        },
        {
          id: 'king-response', kind: 'script', move: move('a8', 'b8'),
          text: copy(
            'Чёрные отвечают королём: a8 → b8.',
            'Black replies with its king: a8 → b8.',
          ),
          detail: copy(
            'Чёрные отводят короля на b8. Король должен завершить каждое своё действие в безопасности.',
            'Black moves its king to b8. A king must be safe after each of its actions.',
          ),
        },
        {
          id: 'king-captures-without-roll', kind: 'move', moves: [move('g2', 'h2')],
          expect: (events, state) => events.some(event => event.type === 'capture' && event.victim.type === 'bishop')
            && !events.some(event => event.type === 'reaction') && at(state, 'h2')?.affliction === 'neutral',
          text: copy(
            'Возьмите слона королём: g2 → h2. Король не получает реакций на взятия.',
            'Capture the bishop with your king: g2 → h2. Kings do not react to captures.',
          ),
          detail: copy(
            'Возьмите чёрного слона на h2 королём. Взятия, включая взятие слона, не меняют его состояние. Король может оказаться под шахом, но его нельзя взять как обычную фигуру.',
            'Capture the black bishop on h2 with the king. Captures leave a king unaffected, even when it takes a bishop. A king can be checked, but it is never a capture target.',
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
            'Конь обучен бою: первое обычное взятие не вызовет реакции. Возьмите пешку: b1 → d2.',
            'The knight is trained for battle: its first ordinary capture causes no reaction. Take the pawn: b1 → d2.',
          ),
          detail: copy(
            'Конём с b1 возьмите пешку на d2. Первое обычное взятие коня обходится без броска.',
            'Capture the pawn on d2 with the knight from b1. A knight’s first ordinary capture is free of any roll.',
          ),
        },
        {
          id: 'knight-between-captures', kind: 'script', move: move('a8', 'b8'),
          text: copy(
            'Чёрные отвечают. При следующем взятии конь получит реакцию.',
            'Black replies. The knight’s next capture will set its reaction.',
          ),
          detail: copy(
            'Чёрные двигают короля. Следующее обычное взятие определит реакцию коня.',
            'Black moves its king. The next ordinary capture will set the knight’s reaction.',
          ),
        },
        {
          id: 'knight-second-capture-six', kind: 'move', moves: [move('d2', 'f3')], roll: fixed(6, 'd2', 'f3'),
          expect: (events, state) => events.some(event => event.type === 'reaction' && event.face === 6)
            && at(state, 'f3')?.affliction === 'berserk' && state.phase === 'bonus' && state.turnSerial === 2,
          text: copy(
            'Это второе взятие коня — теперь его реакцию определит кубик. Возьмите пешку: d2 → f3.',
            'This is the knight’s second capture, so the die will set its reaction. Capture the pawn: d2 → f3.',
          ),
          detail: copy(
            'Возьмите пешку на f3. Шестёрка приведёт коня в ярость, и он получит ещё одно действие в этот же ход.',
            'Capture the pawn on f3. A 6 makes the knight go berserk and earns it a second action this turn.',
          ),
        },
        {
          id: 'bonus-bishop-and-third-capture', kind: 'move', moves: [move('f3', 'h4')],
          expect: (events, state) => state.turnSerial === 3 && state.phase === 'primary' && state.side === 'black'
            && at(state, 'h4')?.affliction === 'bloodlust' && at(state, 'h4')?.capturesSinceRebirth === 3
            && events.some(event => event.type === 'capture' && event.victim.type === 'bishop')
            && !events.some(event => event.type === 'reaction' || event.type === 'bonus'),
          text: copy(
            'В ярости конь не боится брать слона. Используйте второе действие тем же конём: f3 → h4.',
            'A berserk knight is not afraid to take a bishop. Use the bonus action with the same knight: f3 → h4.',
          ),
          detail: copy(
            'Пока конь в ярости, дополнительное действие может быть обычным ходом. Тем же конём возьмите слона на h4. Ярость защищает от опустошения за взятие слона, а третье взятие вызовет жажду крови.',
            'The knight can still use its bonus for a quiet move while it is berserk. Use it to capture the bishop on h4. Berserk ignores the bishop’s penalty, and the third capture triggers bloodlust.',
          ),
        },
        {
          id: 'only-one-bonus', kind: 'script', move: move('b8', 'a8'),
          text: copy(
            'Два действия закончены — ходят чёрные. Таймеры продвинулись только один раз.',
            'The two actions are over, so Black moves. Timers advanced only once.',
          ),
          detail: copy(
            'Конь уже сделал два действия, и теперь ходят чёрные. Счётчики циклов продвинулись один раз за весь ход белых.',
            'The knight has used its two actions, so Black moves next. Cycle timers advanced only once for White’s whole turn.',
          ),
        },
        {
          id: 'bloodlust-forbids-quiet', kind: 'illegal', move: move('h4', 'g2'), reason: 'bloodlustMove',
          text: copy(
            'Попробуйте ход без взятия: h4 → g2. Жажда крови его запрещает.',
            'Try the quiet move: h4 → g2. Bloodlust prevents it.',
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
            'Возьмите свою ладью: h4 → f5. Жажда крови позволяет брать союзников.',
            'Capture your own rook: h4 → f5. Bloodlust allows friendly captures.',
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
            'Нажмите «Завершить ход», чтобы отказаться от второго взятия.',
            'Press “End turn” to decline the second capture.',
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
              'Пешка g7 → g8: выберите ферзя, ладью или коня. Вина сохранится.',
              'Move the pawn g7 → g8 and choose a queen, rook, or knight. Its guilt remains.',
            ),
            detail: copy(
              'Проведите пешку на g8 и выберите ферзя, ладью или коня. Новая фигура унаследует вину, реакцию и число взятий. Выбор коня не вернёт бесплатное первое взятие.',
              'Advance the pawn to g8 and choose a queen, rook, or knight. It inherits guilt, its remembered reaction, and its capture count. Choosing a knight does not restore a free capture.',
            ),
          },
          {
            id: 'promoted-material', kind: 'read',
            hud: 'material',
            text: copy(
              'Пешка превратилась — материал изменился. Новых взятий не было.',
              'Promotion changed the material balance. No new capture took place.',
            ),
            detail: copy(
              'Материальный перевес изменился, потому что пешка стала другой фигурой. Значки взятых фигур остались прежними.',
              'The material count changed because the pawn became a different piece. The captured rows stayed the same.',
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
              'Возьмите ладью: g7 → h8, затем выберите слона. Он начнёт с чистого листа.',
              'Capture the rook: g7 → h8, then choose a bishop. It will get a fresh start.',
            ),
            detail: copy(
              'Пешкой с g7 возьмите ладью на h8 и выберите слона. Сначала выбирают фигуру, затем пешка реагирует на взятие. Слон начинает заново без состояния, реакции и прежних взятий.',
              'Capture the rook on h8 from g7 and choose a bishop. You choose the new piece before the pawn reacts. A bishop is reborn and clears its state, reaction, and previous captures.',
            ),
          },
          {
            id: 'promotion-clears-bonus', kind: 'read',
            text: copy(
              'Запомните выбор: ферзь, ладья и конь сохраняют прошлое пешки; слон начинает заново.',
              'Remember the choice: a queen, rook, or knight keeps the pawn’s past; a bishop starts fresh.',
            ),
            detail: copy(
              'Пешка выбросила шестёрку, но превращение в слона сняло ярость до дополнительного действия.',
              'The pawn rolled a 6. Turning into a bishop cleared berserk before it could earn a bonus action.',
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
            'Возьмите пешку: d4 → c5. Вы сможете доиграть эту позицию после обучения.',
            'Capture the pawn: d4 → c5. You can play on from this position after the tutorial.',
          ),
          detail: copy(
            'Возьмите пешку на c5. Это взятие останется в истории, если вы продолжите позицию после обучения.',
            'Capture the pawn on c5. This capture stays in the record if you continue the position after the tutorial.',
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
            'Выберите фигуру, чтобы увидеть доступные ходы. Например, подведите слона к опустошённому коню.',
            'Select a piece to see its available moves. For example, bring your bishop beside the devastated knight.',
          ),
          detail: copy(
            'Теперь ваш выбор. Выберите любой из подсвеченных ходов без взятия. Слон может помочь своим фигурам, а опустошённому коню нужно успеть до конца отсчёта.',
            'Now it’s your choice. Pick any highlighted quiet move. Your bishop can help allies, and the devastated knight needs help before its timer expires.',
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
            'Основные правила вы попробовали. Дальше можно доиграть эту позицию с ИИ или начать новую партию.',
            'You have tried the main rules. Next, continue this position against the AI or start a new game.',
          ),
          detail: copy(
            'Эту позицию можно доиграть с Remorse Engine в тренировочном режиме. Фигуры сохранят свои состояния и запомненные реакции.',
            'You can play on from this position against Remorse Engine in Practice. Each piece keeps its current state and remembered reaction.',
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
