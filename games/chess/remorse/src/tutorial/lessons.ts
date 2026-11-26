import { createInitialState, createPosition, isInCheck } from '../core'
import type { GameState, Piece, Square } from '../core/types'
import { fixed, move } from './lessonTypes'
import type { Copy, Lesson } from './lessonTypes'
import { bishopPromotionReaction, TEACHING_BEATS } from './teachingCopy'

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
            'Цель — поставить мат. Но здесь взятия могут менять состояние фигур. Выберите белую пешку e2, затем клетку e4.',
            'The goal is checkmate, but captures can change a piece’s state. Select the white pawn on e2, then the square e4.',
          ),
        },
        {
          id: 'black-pawn-d5', kind: 'script', move: move('d7', 'd5'),
          text: copy(
            'Чёрные отвечают пешкой: d7 → d5.',
            'Black replies with the pawn: d7 → d5.',
          ),
        },
        {
          id: 'capture-and-roll', kind: 'move', moves: [move('e4', 'd5')], roll: fixed(4, 'e4', 'd5'),
          expect: events => events.some(event => event.type === 'reaction' && event.face === 4),
          text: copy(
            'Возьмите пешку на d5 своей пешкой e4. Это её первое взятие: после него кубик определит реакцию.',
            'Take the pawn on d5 with your e4 pawn. This is its first capture, so the die will decide its reaction.',
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
            'Возьмите пешку c4 ладьёй c3. После броска посмотрим, что изменилось.',
            'Take the pawn on c4 with the rook on c3. After the roll, you will see what changes.',
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
            'Попробуйте взять пешку d4 ладьёй c4. Сейчас ладья чувствует вину.',
            'Try taking the pawn on d4 with the rook on c4. The rook is currently guilty.',
          ),
        },
        {
          id: 'guilt-quiet-move', kind: 'move', moves: [move('c4', 'c5')],
          expect: (_, state) => at(state, 'c5')?.affliction === 'guilt',
          text: copy(
            'Теперь сходите ладьёй c4–c5. Вина не мешает ходить на пустые клетки.',
            'Now move the rook from c4 to c5. Guilt still allows moves to empty squares.',
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
              'Возьмите пешку c4 ладьёй c3. Здесь увидим другую реакцию на взятие.',
              'Take the pawn on c4 with the rook on c3 to see another reaction to a capture.',
            ),
          },
          {
            id: 'inspect-countdown', kind: 'inspect', square: 'c4',
            focus: { square: 'c4', subject: 'countdown' },
            text: copy(
              'Нажмите на ладью c4. Подсветится счётчик: сколько ей осталось до исчезновения.',
              'Select the rook on c4. Its highlighted countdown shows how long it has before disappearing.',
            ),
            detail: copy(
              'Цикл — по одному следующему ходу каждой стороны. Ход, в котором ладья получила опустошение, не считается. До исчезновения — 3 цикла, то есть 6 ходов игроков. Это не время на часах.',
              'A cycle is one subsequent turn by each side. The turn that caused devastation does not count. Removal takes 3 cycles: 6 player turns. This is a turn count, not a clock.',
            ),
          },
          {
            id: 'one-turn-half-cycle', kind: 'script', move: move('a8', 'b8'),
            expect: (_, state) => at(state, 'c4')?.devastationDue === state.turnSerial + 5,
            text: copy(
              'Чёрные ходят королём. После этого до исчезновения ладьи останется 5 ходов: белые, чёрные — и дальше по очереди.',
              'Black moves its king. After this, the rook will have 5 turns left before disappearing: White, Black, and so on.',
            ),
          },
          {
            id: 'devastated-immobile', kind: 'illegal', move: move('c4', 'c5'), reason: 'devastated',
            text: copy(
              'Попробуйте сходить ладьёй c4–c5. Опустошение мешает даже ходу на пустую клетку.',
              'Try moving the rook from c4 to c5. Devastation prevents even a move to an empty square.',
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
              'Чёрный конь c4 уже опустошён. Возьмите его ладьёй c3: такое взятие называют милосердным.',
              'The black knight on c4 is already devastated. Take it with the rook on c3: this is called a mercy capture.',
            ),
            detail: copy(
              'При милосердном взятии текущее состояние не меняется, а взятие засчитывается. Это важно для первого взятия коня и порога жажды крови. Опустошённый слон — исключение: за него действует правило взятия слона.',
              'A mercy capture leaves the current state unchanged but still counts as a capture. This matters for a knight’s first capture and the bloodlust threshold. A devastated bishop follows the bishop-capture rule instead.',
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
              'У ладьи c4 остался один цикл: ход белых и ход чёрных. Сходите пешкой g2–g3, чтобы увидеть, что будет без помощи.',
              'The rook on c4 has one cycle left: a White turn and a Black turn. Move g2–g3 to see what happens without help.',
            ),
          },
          {
            id: 'self-removal', kind: 'script', move: move('a8', 'b8'),
            expect: events => events.some(event => event.type === 'remove' && event.piece.square === 'c4')
              && !events.some(event => event.type === 'capture'),
            text: copy(
              'Ход чёрных завершит цикл, и ладья исчезнет.',
              'Black’s turn will complete the cycle, and the rook will disappear.',
            ),
          },
          {
            id: 'removal-material-only', kind: 'read',
            hud: 'material',
            text: copy(
              'Ладья не получила помощи и исчезла. Перевес +5 пропал, но значок взятой ладьи никому не добавился.',
              'The rook received no help and disappeared. Your +5 lead vanished, but neither player gained a captured-rook icon.',
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
              'Ладья e4 чувствует вину, а конь f4 опустошён. Подведите слона c1–e3: он сможет вылечить обоих.',
              'The rook on e4 is guilty; the knight on f4 is devastated. Move the bishop c1–e3 to heal them both.',
            ),
            detail: copy(
              'Слон помогает всем своим фигурам на восьми соседних клетках, включая диагональные. Пока он их лечит, вы можете ходить другими фигурами.',
              'A bishop helps every allied piece on the eight adjacent squares, including diagonals. You may move other pieces while it heals them.',
            ),
          },
          {
            id: 'cure-opposing-turn', kind: 'script', move: move('a8', 'b8'),
            text: copy(
              'Сейчас ход чёрных, затем белых. Вместе они завершат полный цикл рядом со слоном.',
              'Black moves now, then White. Together these turns will complete a full cycle beside the bishop.',
            ),
          },
          {
            id: 'cure-two-pieces', kind: 'move', moves: [move('h1', 'g1')],
            expect: events => events.filter(event => event.type === 'cure' && event.cause === 'bishop').length === 2,
            text: copy(
              'Сходите королём h1–g1, оставив слона рядом с ладьёй и конём. В конце этого хода они исцелятся.',
              'Move the king h1–g1, keeping the bishop beside the rook and knight. They will heal at the end of this turn.',
            ),
          },
          {
            id: 'cure-complete', kind: 'script', move: move('b8', 'a8'),
            text: copy(
              'Обе фигуры исцелены. Чёрные отвечают королём.',
              'Both pieces are healed. Black replies with its king.',
            ),
          },
          {
            id: 'bishop-pacifism', kind: 'illegal', move: move('e3', 'c5'), reason: 'bishopCapture',
            text: copy(
              'Попробуйте взять пешку c5 слоном e3.',
              'Try taking the pawn on c5 with the bishop on e3.',
            ),
          },
          {
            id: 'remembered-guilt', kind: 'move', moves: [move('e4', 'e6')],
            expect: events => events.some(event => event.type === 'reaction' && event.cause === 'memory'
              && event.affliction === 'guilt'),
            text: copy(
              'Ладья исцелена. Возьмите ею пешку: e4×e6. Посмотрим, забыла ли она свою реакцию.',
              'The rook is healed. Capture e4×e6 to see whether it has forgotten its reaction.',
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
              'Возьмите слона e5 конём f3. За взятие слона действует особое правило.',
              'Take the bishop on e5 with the knight on f3. Capturing a bishop has its own rule.',
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
              'Поставьте слона c1–e3 рядом с чёрной ладьёй e4. Чужой слон вызывает стыд.',
              'Move the bishop c1–e3 beside the black rook on e4. An enemy bishop causes shame.',
            ),
            detail: copy(
              'Стыд меняет состояние, но не память о кубике. Даже результат 4–5 не защищает от стыда. Король, ярость и жажда крови невосприимчивы.',
              'Shame changes the current state, not the remembered die result. Even a 4 or 5 does not protect against shame. Kings, berserk, and bloodlust are immune.',
            ),
          },
          {
            id: 'shame-half-cycle', kind: 'script', move: move('a8', 'b8'),
            text: copy(
              'Чёрные ходят королём. Ладья пока останется в норме: для первого этапа стыда нужен ещё ход белых.',
              'Black moves its king. The rook stays unaffected for now: it also needs White’s next turn to reach the first stage of shame.',
            ),
          },
          {
            id: 'shame-does-not-stack', kind: 'move', moves: [move('g4', 'f3')],
            expect: (_, state) => at(state, 'e4')?.affliction === 'guilt' && at(state, 'd4')?.affliction === 'berserk',
            text: copy(
              'Сходите вторым слоном g4–f3. Завершится первый цикл рядом с ладьёй; два слона не ускоряют отсчёт.',
              'Move the second bishop g4–f3. This completes the first cycle beside the rook; two bishops do not speed it up.',
            ),
          },
          {
            id: 'shame-second-cycle', kind: 'script', move: move('b8', 'a8'),
            text: copy(
              'Чёрные ходят королём. Если ладья останется рядом со слоном ещё ход белых, вина сменится опустошением.',
              'Black moves its king. If the rook stays beside a bishop through White’s next turn, guilt will become devastation.',
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
              'Оставьте слонов на месте и сходите пешкой h2–h3. Завершится второй цикл стыда.',
              'Leave the bishops in place and move h2–h3. This completes the second cycle of shame.',
            ),
          },
          {
            id: 'shame-third-cycle', kind: 'script', move: move('a8', 'b8'),
            text: copy(
              'Чёрные ходят королём. После следующего хода белых ладья сменит сторону, если слон останется рядом.',
              'Black moves its king. After White’s next turn, the rook will change sides if the bishop stays nearby.',
            ),
          },
          {
            id: 'convert-rook', kind: 'move', moves: [move('h3', 'h4')],
            expect: (events, state) => events.some(event => event.type === 'convert' && event.piece.square === 'e4')
              && at(state, 'e4')?.side === 'white' && at(state, 'e4')?.captureReaction === 'unassigned'
              && at(state, 'e4')?.capturesSinceRebirth === 0,
            text: copy(
              'Сходите пешкой h3–h4. После третьего цикла ладья перейдёт в вашу армию.',
              'Move h3–h4. After this third cycle, the rook will join your army.',
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
          },
          {
            id: 'rebirth-new-roll', kind: 'move', moves: [move('e4', 'e6')], roll: fixed(4, 'e4', 'e6'),
            expect: events => events.some(event => event.type === 'reaction' && event.face === 4),
            text: copy(
              'Возьмите пешку e6 новой ладьёй e4. После смены стороны прежняя реакция забыта.',
              'Take the pawn on e6 with your new rook on e4. Changing sides erased its old reaction.',
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
              'Чужой слон f5 вызывает стыд у ладьи e4. Защитите её своим слоном: c1–e3.',
              'The enemy bishop on f5 is shaming your rook on e4. Protect it by moving your bishop c1–e3.',
            ),
          },
          {
            id: 'protected-but-still-guilty', kind: 'script', move: move('a8', 'b8'),
            expect: (_, state) => at(state, 'e4')?.affliction === 'guilt',
            text: copy(
              'Чёрные ходят королём. Стыд уже остановлен; лечение закончится после следующего хода белых.',
              'Black moves its king. Shame is already blocked; healing will finish after White’s next turn.',
            ),
          },
          {
            id: 'protected-cure-matures', kind: 'move', moves: [move('h1', 'g1')],
            expect: events => events.some(event => event.type === 'cure'
              && event.piece.square === 'e4' && event.cause === 'bishop'),
            text: copy(
              'Сходите королём h1–g1, оставив слона рядом с ладьёй. В конце хода вина исчезнет.',
              'Move the king h1–g1, keeping the bishop beside the rook. Guilt will clear at the end of the turn.',
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
            'Подведите короля h1–g2 к ладье f2 и коню f3. Король помогает сразу, без ожидания.',
            'Move the king h1–g2 beside the rook on f2 and knight on f3. A king’s help is immediate.',
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
            'Возьмите слона h2 королём g2. Король не получает реакции даже за слона.',
            'Take the bishop on h2 with the king on g2. A king stays immune even when taking a bishop.',
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
            'Возьмите пешку d2 конём b1. Коню положено одно взятие без реакции.',
            'Take the pawn on d2 with the knight on b1. A knight gets one capture without a reaction.',
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
        },
        {
          id: 'knight-second-capture-six', kind: 'move', moves: [move('d2', 'f3')], roll: fixed(6, 'd2', 'f3'),
          expect: (events, state) => events.some(event => event.type === 'reaction' && event.face === 6)
            && at(state, 'f3')?.affliction === 'berserk' && state.phase === 'bonus' && state.turnSerial === 2,
          text: copy(
            'Возьмите пешку f3 конём d2. Это его второе взятие: теперь реакцию определит кубик.',
            'Now take the pawn on f3 with the knight on d2. This is its second capture, so it rolls the die.',
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
            'Тем же конём возьмите слона h4. Ярость защищает от опустошения за слона.',
            'Use the same knight to capture the bishop on h4. Berserk protects it from devastation for taking a bishop.',
          ),
        },
        {
          id: 'only-one-bonus', kind: 'script', move: move('b8', 'a8'),
          text: copy(
            'Белые закончили оба действия. Теперь отвечают чёрные.',
            'White has finished both actions. Black replies next.',
          ),
        },
        {
          id: 'bloodlust-forbids-quiet', kind: 'illegal', move: move('h4', 'g2'), reason: 'bloodlustMove',
          text: copy(
            'Попробуйте сходить конём h4–g2 без взятия. Теперь у него жажда крови.',
            'Try moving the knight h4–g2 without a capture. It now has bloodlust.',
          ),
        },
        {
          id: 'friendly-capture', kind: 'move', moves: [move('h4', 'f5')],
          expect: (events, state) => events.some(event => event.type === 'capture' && event.friendly)
            && state.phase === 'bonus',
          text: copy(
            'Возьмите свою ладью f5 конём h4. Жажда крови разрешает брать союзников, но не заставляет.',
            'Take your own rook on f5 with the knight on h4. Bloodlust allows friendly captures, but never forces them.',
          ),
        },
        {
          id: 'decline-optional-bonus', kind: 'move', moves: [{ type: 'endTurn' }],
          expect: (_, state) => state.phase === 'primary' && state.side === 'black',
          text: copy(
            'Можно взять ещё раз, но необязательно. Нажмите «Завершить ход», чтобы передать очередь чёрным.',
            'You may capture again, but you do not have to. Press “End turn” to let Black move.',
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
              'Пешка g7 чувствует вину. Сходите на g8 и выберите ферзя, ладью или коня.',
              'The pawn on g7 is guilty. Move it to g8 and choose a queen, rook, or knight.',
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
            beforePromotion: bishopPromotionReaction,
            expect: (events, state) => events.some(event => event.type === 'reaction' && event.face === 6
              && event.piece.type === 'pawn' && event.affliction === 'berserk')
              && events.some(event => event.type === 'promotion' && event.promotion === 'bishop')
              && at(state, 'h8')?.captureReaction === 'unassigned' && at(state, 'h8')?.affliction === 'neutral'
              && at(state, 'h8')?.capturesSinceRebirth === 0 && state.phase === 'primary',
            text: copy(
              'Возьмите ладью h8 пешкой g7 и выберите слона. Сначала увидим реакцию пешки, затем превращение.',
              'Capture the rook on h8 with the g7 pawn and choose a bishop. First comes the pawn’s reaction, then promotion.',
            ),
            detail: copy(
              'Сначала выберите слона. Затем пешка отреагирует на взятие, а превращение снимет это состояние. Слон также забудет прежнюю реакцию и начнёт с нулевым числом взятий.',
              'Choose the bishop first. The pawn then reacts to the capture, and promotion clears that state. The bishop also forgets the old reaction and resets its capture count.',
            ),
          },
          {
            id: 'promotion-clears-bonus', kind: 'read',
            text: copy(
              'Ферзь, ладья и конь сохраняют состояние пешки. Слон начинает заново: реакция забыта, счёт взятий обнулён, дополнительного действия нет.',
              'A queen, rook, or knight keeps the pawn’s state. A bishop starts fresh: reaction forgotten, capture count reset, no bonus action.',
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
            'Последняя позиция — для практики. Начните со взятия пешкой d4×c5; затем сможете выбрать ход сами.',
            'This last position is for practice. Start with d4×c5, then choose a move for yourself.',
          ),
        },
        {
          id: 'open-defense', kind: 'script', move: move('b8', 'a6'),
          text: copy(
            'Чёрный конь выходит на a6 и угрожает пешке c5.',
            'Black’s knight moves to a6 and threatens the c5 pawn.',
          ),
        },
        {
          id: 'open-quiet-choice', kind: 'move', moves: 'open',
          text: copy(
            'Выберите любой допустимый ход без взятия. Можно помочь опустошённому коню c3 слоном или сыграть иначе.',
            'Choose any legal non-capturing move. You can bring the bishop to help the devastated knight on c3, or make another move.',
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
        },
        {
          id: 'practice-ready', kind: 'read',
          text: copy(
            'Теперь можно доиграть эту позицию против ИИ или начать новую партию.',
            'You can now play on against the AI from this position, or start a new game.',
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
