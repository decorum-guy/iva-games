import { describe, expect, it } from 'vitest'
import {
  applyResolvedCommand,
  boardOf,
  canClaimRepetition,
  commandRejection,
  createInitialState,
  createPosition,
  cyclesRemaining,
  enumerateOutcomes,
  isInCheck,
  isSquareAttacked,
  legalCommands,
  pieceAt,
  positionKey,
  validateState,
  type DieFace,
  type GameState,
  type Move,
  type PieceInput,
  type PositionInput,
  type Promotion,
  type Side,
} from './index'

const white = (type: PieceInput['type'], square: string, props: Partial<PieceInput> = {}): PieceInput =>
  ({ type, square, side: 'white', ...props })
const black = (type: PieceInput['type'], square: string, props: Partial<PieceInput> = {}): PieceInput =>
  ({ type, square, side: 'black', ...props })
const kings = [white('king', 'a1'), black('king', 'h8')]

function position(pieces: readonly PieceInput[], options: Omit<PositionInput, 'pieces'> = {}) {
  return createPosition({ pieces: [...kings, ...pieces], ...options })
}

const move = (from: string, to: string, promotion?: Promotion): Move =>
  promotion ? { type: 'move', from, to, promotion } : { type: 'move', from, to }

const play = (state: GameState, from: string, to: string, face?: DieFace) =>
  applyResolvedCommand(state, move(from, to), face).state

function playLine(state: GameState, moves: readonly [string, string][]) {
  return moves.reduce((current, [from, to]) => play(current, from, to), state)
}

const endTurn = { type: 'endTurn' } as const
const claim = { type: 'claimRepetitionDraw' } as const

describe('movement and capture precedence', () => {
  it('starts with conventional orthodox geometry but leaves the core free of random state', () => {
    const state = createInitialState()
    expect(state.pieces).toHaveLength(32)
    expect(legalCommands(state)).toHaveLength(20)
    expect(validateState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(pieceAt(state, 'e2')?.pawnDoubleStepEligible).toBe(true)
    expect(commandRejection(state, move('e7', 'e5'))).toBe('wrongSide')
    expect(commandRejection(state, move('f1', 'c4'))).toBe('illegalMovement')
    expect(commandRejection(state, endTurn)).toBe('notBonus')
    expect(commandRejection(state, move('b1', 'a3'))).toBeNull()
  })

  it.each([
    [1, 'devastated', 'devastated'],
    [2, 'guilt', 'guilt'],
    [3, 'guilt', 'guilt'],
    [4, 'unaffected', 'neutral'],
    [5, 'unaffected', 'neutral'],
    [6, 'berserk', 'berserk'],
  ] as const)('resolves and records the actual d6 face %s', (face, captureReaction, affliction) => {
    const state = position([white('rook', 'd4'), black('pawn', 'd5')])
    expect(enumerateOutcomes(state, move('d4', 'd5'))).toEqual([
      { face: 1, weight: 1 / 6 }, { face: 2, weight: 2 / 6 },
      { face: 4, weight: 2 / 6 }, { face: 6, weight: 1 / 6 },
    ])
    expect(() => applyResolvedCommand(state, move('d4', 'd5'))).toThrow('invalidRoll')
    const result = applyResolvedCommand(state, move('d4', 'd5'), face)
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'reaction', face, cause: 'roll' }))
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'capture', landing: 'd5', friendly: false, kind: 'ordinary', mercy: false,
      capturer: expect.objectContaining({ id: 'w-d4', side: 'white' }),
      victim: expect.objectContaining({ id: 'b-d5', type: 'pawn', side: 'black', square: 'd5' }),
    }))
    expect(pieceAt(result.state, 'd5')).toMatchObject({ captureReaction, affliction, capturesSinceRebirth: 1 })
    expect(result.state.phase).toBe(face === 6 ? 'bonus' : 'primary')
    expect(result.state.turnSerial).toBe(face === 6 ? 0 : 1)
    expect(pieceAt(state, 'd5')?.side).toBe('black')
    expect(validateState(JSON.parse(JSON.stringify(result.state)))).toEqual(result.state)
  })

  it('counts mercy as the knight’s free capture and rolls next time', () => {
    const state = position([white('knight', 'c4'), black('pawn', 'e5', { affliction: 'devastated' }), black('pawn', 'f7')])
    const mercy = applyResolvedCommand(state, move('c4', 'e5'))
    expect(mercy.events).toContainEqual(expect.objectContaining({ type: 'capture', kind: 'mercy', mercy: true }))
    expect(mercy.events.every(event => event.type !== 'reaction')).toBe(true)
    expect(pieceAt(mercy.state, 'e5')).toMatchObject({ captureReaction: 'unassigned', capturesSinceRebirth: 1 })
    const response = play(mercy.state, 'h8', 'g8')
    const next = applyResolvedCommand(response, move('e5', 'f7'), 3)
    expect(pieceAt(next.state, 'f7')).toMatchObject({ captureReaction: 'guilt', capturesSinceRebirth: 2 })
  })

  it('gives a knight one ordinary free capture unless its target is a bishop', () => {
    const pieces = [white('knight', 'c4'), black('pawn', 'e5'), black('pawn', 'f7')]
    const first = applyResolvedCommand(position(pieces), move('c4', 'e5'))
    expect(first.events.every(event => event.type !== 'reaction')).toBe(true)
    expect(pieceAt(first.state, 'e5')).toMatchObject({ affliction: 'neutral', captureReaction: 'unassigned', capturesSinceRebirth: 1 })
    const bishop = applyResolvedCommand(position([
      white('knight', 'c4'), black('bishop', 'e5', { affliction: 'devastated' }),
    ]), move('c4', 'e5'))
    expect(pieceAt(bishop.state, 'e5')).toMatchObject({ affliction: 'devastated', captureReaction: 'unassigned', capturesSinceRebirth: 1 })
    expect(bishop.events).toContainEqual(expect.objectContaining({ type: 'reaction', cause: 'bishop' }))
    expect(bishop.events).toContainEqual(expect.objectContaining({ type: 'capture', kind: 'ordinary', mercy: false }))
  })

  it('prioritizes kings and berserk over the bishop penalty', () => {
    const king = createPosition({ pieces: [white('king', 'e3'), black('king', 'h8'), black('bishop', 'e4')] })
    const capture = applyResolvedCommand(king, move('e3', 'e4'))
    expect(capture.events.every(event => event.type !== 'reaction')).toBe(true)
    expect(pieceAt(capture.state, 'e4')).toMatchObject({ affliction: 'neutral', capturesSinceRebirth: 1 })
    const berserk = position([white('rook', 'd4', { affliction: 'berserk' }), black('bishop', 'd5')])
    const frenzy = applyResolvedCommand(berserk, move('d4', 'd5'))
    expect(pieceAt(frenzy.state, 'd5')).toMatchObject({ affliction: 'berserk', capturesSinceRebirth: 2 })
    expect(frenzy.state.phase).toBe('bonus')
  })

  it('distinguishes guilt, devastation, bishop pacifism and geometric blockers', () => {
    const guilt = position([white('rook', 'h4', { affliction: 'guilt' }), black('pawn', 'g4')])
    expect(isInCheck(guilt, 'black')).toBe(false)
    expect(commandRejection(guilt, move('h4', 'g4'))).toBe('guiltCapture')
    expect(commandRejection(guilt, move('h4', 'h5'))).toBeNull()
    const wall = createPosition({ pieces: [
      white('king', 'h1'), black('king', 'a8'), black('rook', 'h5'),
      white('rook', 'h3', { affliction: 'devastated' }),
      white('bishop', 'd3'), black('knight', 'f5'),
    ] })
    expect(isInCheck(wall)).toBe(false)
    expect(commandRejection(wall, move('h3', 'h4'))).toBe('devastated')
    expect(commandRejection(wall, move('d3', 'f5'))).toBe('bishopCapture')
    expect(commandRejection(wall, move('d3', 'e4'))).toBeNull()
    expect(isSquareAttacked(boardOf(wall), 'f5', 'white')).toBe(false)
  })
})

describe('completed-turn timing and simultaneous passives', () => {
  it('arms devastation at the activation boundary and removes at +6 without a trophy', () => {
    const base = position([white('rook', 'd4'), black('pawn', 'd5'), white('knight', 'b1')])
    const state = play(base, 'd4', 'd5', 1)
    expect(pieceAt(state, 'd5')?.devastationDue).toBe(7)
    expect(cyclesRemaining(pieceAt(state, 'd5')!, state)).toBe(3)
    const two = playLine(state, [['h8', 'h7'], ['b1', 'c3']])
    expect(cyclesRemaining(pieceAt(two, 'd5')!, two)).toBe(2)
    const four = playLine(two, [['h7', 'g7'], ['c3', 'b1']])
    expect(cyclesRemaining(pieceAt(four, 'd5')!, four)).toBe(1)
    const six = play(four, 'g7', 'h8')
    const expired = applyResolvedCommand(six, move('b1', 'c3'))
    expect(expired.state.turnSerial).toBe(7)
    expect(pieceAt(expired.state, 'd5')).toBeUndefined()
    expect(expired.events.map(event => event.type)).toEqual(['move', 'remove', 'turn'])
  })

  it('cures two pieces after one cycle and remembers a cured piece’s rolled reaction', () => {
    const root = position([
      white('bishop', 'c3'), white('rook', 'e4', { affliction: 'guilt', captureReaction: 'guilt' }),
      white('knight', 'd5', { affliction: 'devastated' }), black('pawn', 'e6'),
    ])
    const one = play(root, 'c3', 'd4')
    expect(pieceAt(one, 'e4')?.cureArmedAt).toBe(1)
    expect(pieceAt(one, 'd5')?.cureArmedAt).toBe(1)
    const two = play(one, 'h8', 'g8')
    expect(pieceAt(two, 'e4')?.affliction).toBe('guilt')
    const three = applyResolvedCommand(two, move('a1', 'a2'))
    expect(three.events.filter(event => event.type === 'cure')).toHaveLength(2)
    expect(pieceAt(three.state, 'd5')?.devastationDue).toBeNull()
    const four = play(three.state, 'g8', 'h8')
    const relapse = applyResolvedCommand(four, move('e4', 'e6'))
    expect(pieceAt(relapse.state, 'e6')).toMatchObject({ affliction: 'guilt', captureReaction: 'guilt' })
    expect(relapse.events).toContainEqual(expect.objectContaining({ type: 'reaction', cause: 'memory' }))
  })

  it('converts and cures due targets before expiring others, independently of input order', () => {
    const state = position([
      white('bishop', 'd4'),
      white('rook', 'e4', { affliction: 'devastated', devastationDue: 2, cureArmedAt: 0 }),
      black('queen', 'd5', { affliction: 'devastated', devastationDue: 2, shameArmedAt: 0 }),
      black('knight', 'h4', { affliction: 'devastated', devastationDue: 2 }),
    ], { turnSerial: 1 })
    const transition = applyResolvedCommand(state, move('a1', 'a2'))
    const reversed = applyResolvedCommand({ ...state, pieces: [...state.pieces].reverse() }, move('a1', 'a2'))
    expect(positionKey(reversed.state)).toBe(positionKey(transition.state))
    expect(reversed.events).toEqual(transition.events)
    expect(pieceAt(transition.state, 'e4')?.affliction).toBe('neutral')
    expect(pieceAt(transition.state, 'd5')).toMatchObject({ side: 'white', id: 'b-d5', affliction: 'neutral' })
    expect(pieceAt(transition.state, 'h4')).toBeUndefined()
    expect(transition.events.map(event => event.type)).toEqual(['move', 'cure', 'convert', 'remove', 'turn'])
  })

  it('uses the old owner’s aura for one snapshot before the converted bishop’s new contact arms', () => {
    const root = position([
      white('bishop', 'd4', { affliction: 'devastated', shameArmedAt: 0 }),
      white('rook', 'c4', { affliction: 'guilt', cureArmedAt: 0 }),
      black('bishop', 'e5', { shameArmedAt: 0 }),
    ], { turnSerial: 1 })
    const following = applyResolvedCommand(root, move('a1', 'a2'))
    expect(pieceAt(following.state, 'd4')).toMatchObject({ side: 'black', affliction: 'neutral' })
    expect(pieceAt(following.state, 'c4')).toMatchObject({ affliction: 'neutral', shameArmedAt: 2 })
    expect(pieceAt(following.state, 'e5')).toMatchObject({ affliction: 'guilt', cureArmedAt: 2 })
    expect(following.events.filter(event => event.type === 'cure')).toHaveLength(1)
    const nextCycle = playLine(following.state, [['h8', 'g8'], ['a2', 'a1']])
    expect(pieceAt(nextCycle, 'c4')?.affliction).toBe('guilt')
    expect(pieceAt(nextCycle, 'e5')?.affliction).toBe('neutral')
  })

  it('keeps maturity if one of two friendly source bishops moves away', () => {
    const root = position([
      white('bishop', 'd4'), white('bishop', 'e3'),
      white('rook', 'e4', { affliction: 'guilt', cureArmedAt: 0 }),
    ], { turnSerial: 1 })
    const following = applyResolvedCommand(root, move('d4', 'c5'))
    expect(pieceAt(following.state, 'e4')).toMatchObject({ affliction: 'neutral', cureArmedAt: null })
    expect(following.events).toContainEqual(expect.objectContaining({ type: 'cure', cause: 'bishop' }))
  })

  it('resets interrupted coverage and treats two enemy bishops as one source of progress', () => {
    const root = position([
      white('rook', 'e4', { captureReaction: 'unaffected' }), white('knight', 'b1'),
      black('bishop', 'd5'), black('bishop', 'f5', { affliction: 'guilt' }),
    ])
    expect(pieceAt(root, 'e4')?.shameArmedAt).toBe(0)
    const continuous = playLine(root, [['b1', 'c3'], ['h8', 'g8']])
    expect(pieceAt(continuous, 'e4')).toMatchObject({ affliction: 'guilt', captureReaction: 'unaffected', shameArmedAt: 2 })
    const interrupted = playLine(root, [['e4', 'e3'], ['h8', 'g8'], ['e3', 'e4'], ['g8', 'h8']])
    expect(pieceAt(interrupted, 'e4')).toMatchObject({ affliction: 'neutral', shameArmedAt: 3 })
    expect(pieceAt(play(interrupted, 'b1', 'c3'), 'e4')?.affliction).toBe('guilt')
  })

  it('has continuing passive coverage from afflicted bishops and no self-heal', () => {
    const root = position([
      white('bishop', 'd4', { affliction: 'devastated' }), black('rook', 'e4', { affliction: 'guilt' }),
      white('knight', 'b1'),
    ])
    const state = playLine(root, [['b1', 'c3'], ['h8', 'g8']])
    expect(pieceAt(state, 'd4')).toMatchObject({ affliction: 'devastated', cureArmedAt: null })
    expect(pieceAt(state, 'e4')?.affliction).toBe('devastated')
  })

  it('blocks shame immediately under allied bishop coverage without precharging cures', () => {
    const before = position([
      white('bishop', 'b2'), white('rook', 'd4', { affliction: 'guilt' }), black('bishop', 'd5'),
    ])
    const protectedState = play(before, 'b2', 'c3')
    expect(pieceAt(protectedState, 'd4')).toMatchObject({ shameArmedAt: null, cureArmedAt: 1 })
    expect(pieceAt(playLine(protectedState, [['h8', 'g8'], ['a1', 'a2']]), 'd4')?.affliction).toBe('neutral')

    const root = position([white('bishop', 'd4'), white('rook', 'e4'), white('knight', 'b1'), black('pawn', 'e5')])
    const state = playLine(root, [['b1', 'c3'], ['h8', 'g8']])
    expect(pieceAt(state, 'e4')?.cureArmedAt).toBeNull()
    const capture = play(state, 'e4', 'e5', 2)
    expect(pieceAt(capture, 'e5')).toMatchObject({ affliction: 'guilt', cureArmedAt: 3 })
    expect(pieceAt(playLine(capture, [['g8', 'h8'], ['c3', 'b1']]), 'e5')?.affliction).toBe('neutral')
  })

  it('arms each shame stage separately, then converts with identity and original rights reset', () => {
    const root = position([
      white('bishop', 'c5'), white('knight', 'b1'),
      black('pawn', 'e7', { pawnDoubleStepEligible: true }),
      black('rook', 'd7', { captureReaction: 'unaffected', capturesSinceRebirth: 2 }),
    ])
    const start = play(root, 'c5', 'd6')
    expect(pieceAt(start, 'e7')).toMatchObject({ affliction: 'neutral', shameArmedAt: 1 })
    const guilt = playLine(start, [['h8', 'g8'], ['b1', 'c3']])
    expect(pieceAt(guilt, 'e7')).toMatchObject({ affliction: 'guilt', shameArmedAt: 3 })
    const devastated = playLine(guilt, [['g8', 'h8'], ['c3', 'b1']])
    expect(pieceAt(devastated, 'e7')).toMatchObject({ affliction: 'devastated', shameArmedAt: 5, devastationDue: 11 })
    const converted = playLine(devastated, [['h8', 'g8'], ['b1', 'c3']])
    expect(pieceAt(converted, 'd7')).toMatchObject({
      id: 'b-d7', side: 'white', captureReaction: 'unassigned', capturesSinceRebirth: 0,
    })
    expect(pieceAt(converted, 'e7')).toMatchObject({
      id: 'b-e7', side: 'white', pawnDoubleStepEligible: false, affliction: 'neutral', devastationDue: null,
    })
    const moving = play(converted, 'g8', 'h8')
    expect(commandRejection(moving, move('e7', 'e8', 'queen'))).toBeNull()
    expect(commandRejection(moving, move('e7', 'e6'))).toBe('illegalMovement')
  })

  it('revokes castling on a converted original rook even when it keeps its square', () => {
    const root = createPosition({ pieces: [
      white('king', 'e1', { castleEligible: true }), black('king', 'h8'),
      white('rook', 'a1', { affliction: 'devastated', castleEligible: true }),
      white('knight', 'c2'), black('bishop', 'b2'),
    ] })
    const state = playLine(root, [['c2', 'e3'], ['h8', 'g8']])
    expect(pieceAt(state, 'a1')).toMatchObject({ id: 'w-a1', side: 'black', castleEligible: false })
    expect(commandRejection(state, move('e1', 'c1'))).toBe('illegalMovement')
  })

  it('does not restore a pawn double step after conversion onto its new home rank', () => {
    const root = position([
      white('bishop', 'e3'), black('pawn', 'd2', { affliction: 'devastated', id: 'b-d7' }),
    ])
    const converted = playLine(root, [['a1', 'b1'], ['h8', 'g8']])
    expect(pieceAt(converted, 'd2')).toMatchObject({ id: 'b-d7', side: 'white', pawnDoubleStepEligible: false })
    expect(commandRejection(converted, move('d2', 'd3'))).toBeNull()
    expect(commandRejection(converted, move('d2', 'd4'))).toBe('illegalMovement')
  })

  it('rallies only allied negative afflictions immediately and keeps remembered reaction', () => {
    const root = createPosition({ pieces: [
      white('king', 'e2'), black('king', 'h8'),
      white('rook', 'e4', { affliction: 'guilt', captureReaction: 'guilt' }),
      white('pawn', 'g4', { affliction: 'devastated' }),
      white('knight', 'g3', { affliction: 'berserk' }),
      black('knight', 'f4', { affliction: 'guilt' }),
    ] })
    const result = applyResolvedCommand(root, move('e2', 'f3'))
    expect(result.events.filter(event => event.type === 'cure')).toHaveLength(2)
    expect(pieceAt(result.state, 'e4')).toMatchObject({ affliction: 'neutral', captureReaction: 'guilt' })
    expect(pieceAt(result.state, 'g4')?.devastationDue).toBeNull()
    expect(pieceAt(result.state, 'g3')?.affliction).toBe('berserk')
    expect(pieceAt(result.state, 'f4')?.affliction).toBe('guilt')
  })
})

describe('bonus, check and stochastic safety', () => {
  it('does not tick in the bonus phase, allows decline, and saturates at two actions', () => {
    const state = position([white('rook', 'd4', { affliction: 'berserk', capturesSinceRebirth: 2 }),
      white('rook', 'e5'), black('pawn', 'd5'), black('knight', 'd7')])
    const primary = applyResolvedCommand(state, move('d4', 'd5'))
    expect(primary.state.repetition).toBe(state.repetition)
    expect(primary.state.turnSerial).toBe(0)
    expect(primary.state.bonusPieceId).toBe('w-d4')
    expect(pieceAt(primary.state, 'd5')?.affliction).toBe('bloodlust')
    expect(commandRejection(primary.state, move('d5', 'd6'))).toBe('bloodlustMove')
    expect(commandRejection(primary.state, move('e5', 'f5'))).toBe('wrongBonusPiece')
    expect(applyResolvedCommand(primary.state, endTurn).state.turnSerial).toBe(1)
    const extra = applyResolvedCommand(primary.state, move('d5', 'e5'))
    expect(extra.events).toContainEqual(expect.objectContaining({ type: 'capture', friendly: true }))
    expect(extra.state).toMatchObject({ side: 'black', phase: 'primary', turnSerial: 1, bonusPieceId: null })
    expect(pieceAt(extra.state, 'e5')).toMatchObject({ id: 'w-d4', affliction: 'bloodlust', capturesSinceRebirth: 4 })
  })

  it('applies bloodlust when the first reaction of 6 is delayed to the fourth capture', () => {
    const state = position([
      white('rook', 'd4', { capturesSinceRebirth: 3 }),
      black('pawn', 'd5'), black('pawn', 'e5'),
    ])
    const result = applyResolvedCommand(state, move('d4', 'd5'), 6)
    expect(result.state.phase).toBe('bonus')
    expect(pieceAt(result.state, 'd5')).toMatchObject({ affliction: 'bloodlust', capturesSinceRebirth: 4 })
    expect(result.events.map(event => event.type)).toEqual(['move', 'capture', 'reaction', 'affliction', 'bonus'])
    expect(commandRejection(result.state, move('d5', 'd6'))).toBe('bloodlustMove')
  })

  it('autocompletes if the earned bonus has no accessible legal capture', () => {
    const state = position([
      white('knight', 'c4', { affliction: 'berserk', capturesSinceRebirth: 2 }), black('pawn', 'e5'),
    ])
    const result = applyResolvedCommand(state, move('c4', 'e5'))
    expect(pieceAt(result.state, 'e5')?.affliction).toBe('bloodlust')
    expect(result.state).toMatchObject({ phase: 'primary', turnSerial: 1, side: 'black' })
    expect(result.events.some(event => event.type === 'bonus')).toBe(false)
  })

  it('rejects primary captures unsafe for some faces and requires a safe existing berserker bonus', () => {
    const pieces = [white('knight', 'a3', { affliction: 'devastated', devastationDue: 1 }),
      black('rook', 'a8'), black('pawn', 'c4')]
    const unassigned = position([...pieces, white('rook', 'c3')])
    expect(isInCheck(unassigned)).toBe(false)
    expect(commandRejection(unassigned, move('c3', 'c4'))).toBe('kingSafety')
    expect(() => applyResolvedCommand(unassigned, move('c3', 'c4'), 6)).toThrow('kingSafety')
    const berserk = position([...pieces, white('rook', 'c3', { affliction: 'berserk' })])
    const result = applyResolvedCommand(berserk, move('c3', 'c4'))
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'bonus', required: true }))
    expect(cyclesRemaining(pieceAt(result.state, 'a3')!, result.state)).toBe(1)
    expect(commandRejection(result.state, endTurn)).toBe('endTurnUnsafe')
    expect(commandRejection(result.state, move('c4', 'b4'))).toBe('kingSafety')
    const rescue = applyResolvedCommand(result.state, move('c4', 'a4'))
    expect(pieceAt(rescue.state, 'a3')).toBeUndefined()
    expect(isInCheck(rescue.state, 'white')).toBe(false)
    expect(rescue.state.turnSerial).toBe(1)
  })

  it('keeps the geometric attack of a pinned piece', () => {
    const root = createPosition({ pieces: [
      white('king', 'g1'), white('rook', 'e1'), black('king', 'e8'), black('rook', 'e5'),
    ], side: 'black' })
    expect(commandRejection(root, move('e5', 'g5'))).toBe('kingSafety')
    expect(isSquareAttacked(boardOf(root), 'h5', 'black')).toBe(true)
  })

  it('rejects an immediate self-check even when a hypothetical second action could repair it', () => {
    const state = position([white('rook', 'a3', { affliction: 'berserk' }), black('rook', 'a8'), black('pawn', 'c3')])
    expect(commandRejection(state, move('a3', 'c3'))).toBe('kingSafety')
  })

  it('adjudicates real mate only after a completed turn and never permits capturing a king', () => {
    const state = createPosition({ pieces: [
      white('king', 'c6'), white('queen', 'c7', { affliction: 'berserk' }),
      black('king', 'a8'), black('pawn', 'b7'),
    ] })
    const result = applyResolvedCommand(state, move('c7', 'b7'))
    expect(isInCheck(result.state, 'black')).toBe(true)
    expect(result.state.outcome).toBeNull()
    expect(commandRejection(result.state, move('b7', 'a8'))).toBe('kingCapture')
    expect(applyResolvedCommand(result.state, endTurn).state.outcome).toEqual({ reason: 'checkmate', winner: 'white' })
  })
})

describe('special moves and validated positions', () => {
  it.each([
    ['guilt', true],
    ['devastated', false],
    ['bloodlust', false],
  ] as const)('handles castling with a formerly eligible %s rook', (affliction, allowed) => {
    const state = createPosition({ pieces: [
      white('king', 'e1', { castleEligible: true }), black('king', 'e8'),
      white('rook', 'h1', { affliction, castleEligible: true }),
    ] })
    expect(commandRejection(state, move('e1', 'g1')) === null).toBe(allowed)
    if (allowed) {
      const result = applyResolvedCommand(state, move('e1', 'g1'))
      expect(result.events.filter(event => event.type === 'move' && event.castle)).toHaveLength(2)
      expect(pieceAt(result.state, 'f1')).toMatchObject({ castleEligible: false, affliction: 'neutral' })
      expect(pieceAt(result.state, 'g1')).toMatchObject({ type: 'king', castleEligible: false })
    }
  })

  it('blocks castling through an attacked square and never grants absent historical rights', () => {
    const base = [white('king', 'e1', { castleEligible: true }), black('king', 'e8'), white('rook', 'h1', { castleEligible: true })]
    const pin = createPosition({ pieces: [...base, black('rook', 'f8')] })
    expect(commandRejection(pin, move('e1', 'g1'))).toBe('illegalMovement')
    const replaced = createPosition({ pieces: [base[0], base[1], white('rook', 'h1')] })
    expect(commandRejection(replaced, move('e1', 'g1'))).toBe('illegalMovement')
  })

  it('rejects en-passant discovered check through the removed victim square', () => {
    const state = createPosition({ pieces: [
      white('king', 'h5'), white('pawn', 'g5'), black('king', 'h8'), black('pawn', 'f5'), black('rook', 'a5'),
    ], enPassant: { pawnId: 'b-f5', target: 'f6', availableTo: 'white' } })
    expect(isInCheck(state)).toBe(false)
    expect(commandRejection(state, move('g5', 'f6'))).toBe('kingSafety')
  })

  it('snapshots en-passant mercy and keeps an unspent right through a bonus', () => {
    const base = position([white('pawn', 'e5'), black('pawn', 'd5', { affliction: 'devastated' })], {
      enPassant: { pawnId: 'b-d5', target: 'd6', availableTo: 'white' },
    })
    const result = applyResolvedCommand(base, move('e5', 'd6'))
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'capture', kind: 'enPassant', mercy: true, landing: 'd6',
      victim: expect.objectContaining({ square: 'd5', id: 'b-d5' }),
    }))
    expect(pieceAt(result.state, 'd5')).toBeUndefined()
    const root = position([white('pawn', 'c4', { affliction: 'berserk' }), black('pawn', 'd5'), black('pawn', 'e5')], {
      enPassant: { pawnId: 'b-e5', target: 'e6', availableTo: 'white' },
    })
    const primary = play(root, 'c4', 'd5')
    expect(primary.phase).toBe('bonus')
    expect(primary.enPassant).toEqual(root.enPassant)
    const reloaded = validateState(JSON.parse(JSON.stringify(primary)))
    const completed = applyResolvedCommand(reloaded, move('d5', 'e6'))
    expect(completed.state.enPassant).toBeNull()
    expect(completed.events).toContainEqual(expect.objectContaining({ type: 'capture', kind: 'enPassant' }))
  })

  it('keeps original double-step rights explicit, and expires en passant after the eligible whole turn', () => {
    const state = position([white('pawn', 'd2'), white('pawn', 'e2', { pawnDoubleStepEligible: true }), black('pawn', 'd4')])
    expect(commandRejection(state, move('d2', 'd4'))).toBe('illegalMovement')
    expect(commandRejection(state, move('d2', 'd3'))).toBeNull()
    const double = play(state, 'e2', 'e4')
    expect(pieceAt(double, 'e4')?.pawnDoubleStepEligible).toBe(false)
    expect(double.enPassant).toEqual({ pawnId: 'w-e2', availableTo: 'black', target: 'e3' })
    expect(commandRejection(double, move('d4', 'e3'))).toBeNull()
    const expired = play(double, 'h8', 'g8')
    expect(expired.enPassant).toBeNull()
  })

  it('requires promotion before the roll, applies reaction as pawn, and rebirth cancels a bishop bonus', () => {
    const state = createPosition({ pieces: [
      white('king', 'a1'), black('king', 'a8'), white('pawn', 'g7'), black('rook', 'h8'),
    ] })
    expect(commandRejection(state, move('g7', 'h8'))).toBe('promotionRequired')
    const knight = applyResolvedCommand(state, move('g7', 'h8', 'knight'), 3)
    expect(pieceAt(knight.state, 'h8')).toMatchObject({
      id: 'w-g7', type: 'knight', capturesSinceRebirth: 1, captureReaction: 'guilt', affliction: 'guilt',
    })
    expect(knight.events.map(event => event.type)).toEqual(['move', 'capture', 'reaction', 'promotion', 'turn'])
    const queen = applyResolvedCommand(state, move('g7', 'h8', 'queen'), 6)
    expect(queen.state.phase).toBe('bonus')
    expect(pieceAt(queen.state, 'h8')).toMatchObject({ type: 'queen', affliction: 'berserk' })
    const bishop = applyResolvedCommand(state, move('g7', 'h8', 'bishop'), 6)
    expect(bishop.state.phase).toBe('primary')
    expect(pieceAt(bishop.state, 'h8')).toMatchObject({ type: 'bishop', affliction: 'neutral', capturesSinceRebirth: 0, captureReaction: 'unassigned' })
  })

  it('rejects malformed snapshots and an unpromoted back-rank pawn', () => {
    expect(() => position([white('pawn', 'd8')])).toThrow('back rank')
    const base = position([white('knight', 'd4')])
    expect(() => validateState({ ...base, pieces: [...base.pieces, base.pieces[0]] })).toThrow('duplicate')
    expect(() => validateState({ ...base, repetition: {} })).toThrow('missing repetition root')
    expect(() => validateState({ ...base, phase: 'bonus', bonusPieceId: 'w-d4' })).toThrow('no safe bonus')
    expect(() => validateState({ ...base, outcome: { reason: 'checkmate', winner: 'white' } })).toThrow('invalid game outcome')
  })
})

describe('draws and complete semantic repetition', () => {
  it('counts the initial position once, tracks turns, and allows a non-ticking claim', () => {
    const initial = position([white('knight', 'b1'), black('knight', 'g8')])
    const cycle: [string, string][] = [['b1', 'c3'], ['g8', 'f6'], ['c3', 'b1'], ['f6', 'g8']]
    expect(initial.repetition[positionKey(initial)]).toBe(1)
    const twice = playLine(initial, cycle)
    expect(positionKey(twice)).toBe(positionKey(initial))
    expect(twice.repetition[positionKey(twice)]).toBe(2)
    expect(canClaimRepetition(twice)).toBe(false)
    const third = playLine(twice, cycle)
    expect(Object.values(third.repetition).reduce((sum, count) => sum + count, 0)).toBe(9)
    expect(legalCommands(third)).toContainEqual(claim)
    const claimed = applyResolvedCommand(third, claim)
    expect(claimed.state.turnSerial).toBe(third.turnSerial)
    expect(claimed.state.repetition).toBe(third.repetition)
    expect(claimed.state.outcome).toEqual({ reason: 'repetition', winner: null })
    expect(validateState(claimed.state)).toEqual(claimed.state)
  })

  it('keys reaction memory, rights and remaining timers but excludes the serial origin', () => {
    const make = (turnSerial: number, devastationDue: number) => position([
      white('rook', 'd4', { affliction: 'devastated', devastationDue }),
      white('pawn', 'e2', { pawnDoubleStepEligible: true }),
    ], { turnSerial })
    const a = make(0, 4)
    const b = make(7, 11)
    expect(positionKey(a)).toBe(positionKey(b))
    expect(positionKey(make(7, 12))).not.toBe(positionKey(a))
    expect(positionKey({ ...a, pieces: a.pieces.map(piece => ({ ...piece, pawnDoubleStepEligible: false })) })).not.toBe(positionKey(a))
    expect(positionKey({ ...a, pieces: a.pieces.map(piece => piece.type === 'rook'
      ? { ...piece, captureReaction: 'guilt', capturesSinceRebirth: 1 } : piece) })).not.toBe(positionKey(a))
  })

  it('ignores expired historical castling and capture counts with no future effect', () => {
    const base = (rook: Partial<PieceInput>) => position([white('rook', 'f4', rook), black('pawn', 'g5')])
    const movedKing = createPosition({ pieces: [
      white('king', 'e1'), black('king', 'a8'), white('rook', 'h1', { castleEligible: true }),
    ] })
    const movedBoth = createPosition({ pieces: [white('king', 'e1'), black('king', 'a8'), white('rook', 'h1')] })
    expect(positionKey(movedKing)).toBe(positionKey(movedBoth))
    expect(positionKey(base({ capturesSinceRebirth: 1 }))).not.toBe(positionKey(base({ capturesSinceRebirth: 2 })))
    expect(positionKey(base({ captureReaction: 'guilt', capturesSinceRebirth: 1 }))).toBe(
      positionKey(base({ captureReaction: 'guilt', capturesSinceRebirth: 2 })),
    )
  })

  it('has automatic bare kings and stalemate, plus no orthodox insufficient-material shortcut', () => {
    expect(position([]).outcome).toEqual({ reason: 'bareKings', winner: null })
    expect(position([white('bishop', 'd4')]).outcome).toBeNull()
    const stalemate = createPosition({ side: 'black', pieces: [
      white('king', 'c6'), white('queen', 'c7'), black('king', 'a8'),
    ] })
    expect(stalemate.outcome).toEqual({ reason: 'stalemate', winner: null })
  })

  it('accepts authenticated off-turn resignation without modifying phase or repetition', () => {
    const state = createInitialState()
    const actor: Side = 'black'
    const result = applyResolvedCommand(state, { type: 'resign' }, undefined, actor)
    expect(result.state.outcome).toEqual({ reason: 'resignation', winner: 'white' })
    expect(result.state.repetition).toBe(state.repetition)
    expect(result.state.phase).toBe(state.phase)
    expect(result.state.side).toBe(state.side)
    expect(result.state.turnSerial).toBe(state.turnSerial)
    expect(commandRejection(state, move('e2', 'e4'), actor)).toBe('wrongSide')
  })
})
