import { describe, expect, it } from 'vitest'
import { attackMap, checkLayoutKey, commandKey, createInitialState, createPosition, effectiveEnPassant, evaluateOutcome, hasLegalAction, isInCheck, legalActions, legalCommands, offset, opposite, pieceAt, positionKey, raidMiddles, resolveCandidate, RULES_VERSION, transition, validateCommand, validateState } from '../../src/core'
import type { Action, GameState, PieceInput, PositionInput, Side } from '../../src/core'

const p = (id: string, side: Side, type: PieceInput['type'], square: string, rights: Partial<PieceInput> = {}): PieceInput => ({ id, side, type, square, ...rights })
function pos(pieces: PieceInput[], extra: Omit<PositionInput, 'pieces'> = {}): GameState {
  return createPosition({ rulesVersion: 'overdrive-v1', pieces: [
    ...(!pieces.some(x => x.type === 'king' && x.side === 'white') ? [p('wk', 'white', 'king', 'a1')] : []),
    ...(!pieces.some(x => x.type === 'king' && x.side === 'black') ? [p('bk', 'black', 'king', 'h8')] : []), ...pieces,
  ], ...extra })
}
function move(state: GameState, from: string, to: string, mode: Action['mode'] = 'normal', promotion?: Action['promotion']) {
  return transition(state, { type: 'move', pieceId: pieceAt(state, from)!.id, to, mode, ...(promotion ? { promotion } : {}) }).state
}
function ability(state: GameState, pieceId: string, targetId: string, to?: string, mode: Action['mode'] = 'impulse', promotion?: Action['promotion']) {
  return transition(state, { type: 'ability', pieceId, targetId, mode, ...(to ? { to } : {}), ...(promotion ? { promotion } : {}) })
}
function perft(state: GameState, depth: number): number {
  if (!depth) return 1
  return legalActions(state).reduce((sum, command) => sum + perft(resolveCandidate(state, command).state, depth - 1), 0)
}

describe('OVERDRIVE orthodox foundation', () => {
  it('has a complete validated initial state and orthodox opening perft', () => {
    const initial = createInitialState()
    expect(validateState(initial)).toBe(true)
    expect(initial.rulesVersion).toBe(RULES_VERSION)
    expect(initial.energy).toEqual({ white: 0, black: 0 })
    expect(perft(initial, 1)).toBe(20)
    expect(perft(initial, 2)).toBe(400)
    expect(perft(initial, 3)).toBe(8902)
  }, 30000)
  it('rejects self check and never physically captures a king', () => {
    const state = pos([p('wr', 'white', 'rook', 'a2'), p('br', 'black', 'rook', 'a8')])
    expect(() => move(state, 'a2', 'b2')).toThrow('kingSafety')
    const kingTarget = pos([p('wr', 'white', 'rook', 'h1')])
    expect(() => move(kingTarget, 'h1', 'h8')).toThrow('kingCapture')
  })
  it('keeps pawn attacks distinct from pawn moves and pinned attacks geometric', () => {
    const state = pos([p('wp', 'white', 'pawn', 'e4'), p('bn', 'black', 'knight', 'f6'), p('wr', 'white', 'rook', 'f1'), p('bk', 'black', 'king', 'f8')])
    expect(attackMap(state, 'white').has('d5')).toBe(true)
    expect(attackMap(state, 'white').has('e5')).toBe(false)
    expect(attackMap(state, 'black').has('e4')).toBe(true)
  })
  it('handles real en passant and rejects its discovered self check', () => {
    let state = pos([p('wp', 'white', 'pawn', 'e5'), p('bp', 'black', 'pawn', 'd7', { pawnDoubleStepEligible: true })], { side: 'black' })
    state = move(state, 'd7', 'd5')
    expect(effectiveEnPassant(state)).toBe('d6')
    state = move(state, 'e5', 'd6')
    expect(state.pieces.some(x => x.id === 'bp')).toBe(false)
    expect(state.energy.white).toBe(1)
    const unsafe = pos([p('wk', 'white', 'king', 'a5'), p('wp', 'white', 'pawn', 'b5'), p('bp', 'black', 'pawn', 'c5'), p('br', 'black', 'rook', 'h5')], { enPassant: { pawnId: 'bp', target: 'c6', availableTo: 'white' } })
    expect(effectiveEnPassant(unsafe)).toBe(null)
    expect(() => move(unsafe, 'b5', 'c6')).toThrow('kingSafety')
  })
  it('supports both castlings and checks the transit position', () => {
    const pieces = [p('wk', 'white', 'king', 'e1', { castleEligible: true }), p('wr1', 'white', 'rook', 'a1', { castleEligible: true }), p('wr2', 'white', 'rook', 'h1', { castleEligible: true })]
    const state = pos(pieces)
    expect(pieceAt(move(state, 'e1', 'g1'), 'f1')?.id).toBe('wr2')
    expect(pieceAt(move(state, 'e1', 'c1'), 'd1')?.id).toBe('wr1')
    const unsafe = pos([...pieces, p('br', 'black', 'rook', 'f8')])
    expect(() => move(unsafe, 'e1', 'g1')).toThrow('kingSafety')
  })
})

describe('OVERDRIVE energy and forms', () => {
  it('earns capture + check once, caps energy, and records overflowing check rewards', () => {
    const pieces = [p('wk', 'white', 'king', 'b1'), p('wr', 'white', 'rook', 'a2'), p('bn', 'black', 'knight', 'a7'), p('bk', 'black', 'king', 'h7')]
    const state = pos(pieces, { energy: { white: 4 } })
    const next = move(state, 'a2', 'a7')
    expect(next.energy.white).toBe(7)
    expect(next.rewardedCheckLayouts.white).toEqual([checkLayoutKey(next, 'white')])
    const capped = move(pos(pieces, { energy: { white: 10 } }), 'a2', 'a7')
    expect(capped.energy.white).toBe(10)
    expect(capped.rewardedCheckLayouts.white.length).toBe(1)
    const repeated = move(pos(pieces, { energy: { white: 4 }, rewardedCheckLayouts: next.rewardedCheckLayouts }), 'a2', 'a7')
    expect(repeated.energy.white).toBe(5)
  })
  it('does not bootstrap 3 to 5 by assuming an unaffordable enhanced check', () => {
    const state = pos([p('wn', 'white', 'knight', 'c3'), p('wr', 'white', 'rook', 'h1'), p('bk', 'black', 'king', 'd4')], { energy: { white: 3 } })
    const next = move(state, 'h1', 'h2')
    expect(next.energy.white).toBe(3)
    expect(isInCheck(next, 'black')).toBe(false)
  })
  it('an actual capture can unlock an enhanced check before the check reward', () => {
    const state = pos([p('wn', 'white', 'knight', 'c3'), p('wr', 'white', 'rook', 'g1'), p('bn', 'black', 'knight', 'h1'), p('bk', 'black', 'king', 'd4')], { energy: { white: 4 } })
    const next = move(state, 'g1', 'h1')
    expect(next.energy.white).toBe(7)
    expect(isInCheck(next, 'black')).toBe(true)
  })
  it('cannot pay from future capture income; spending disables other paid threats', () => {
    const state = pos([p('wn', 'white', 'knight', 'c3'), p('br', 'black', 'rook', 'd3')], { energy: { white: 4 } })
    expect(() => ability(state, 'wn', 'br', 'e4')).toThrow('energy')
    const active = pos([p('wn', 'white', 'knight', 'c3'), p('wr', 'white', 'rook', 'a2'), p('bp', 'black', 'pawn', 'a3'), p('bk', 'black', 'king', 'd4')], { energy: { white: 5 } })
    const next = ability(active, 'wr', 'bp').state
    expect(next.energy.white).toBe(0)
    expect(isInCheck(next, 'black')).toBe(false)
  })
  it('counts precisely three owner turns, including activation, even when another piece moves', () => {
    let state = pos([p('wn', 'white', 'knight', 'b1'), p('wp', 'white', 'pawn', 'f2'), p('bp', 'black', 'pawn', 'g7')], { energy: { white: 10 } })
    state = move(state, 'b1', 'c3', 'activate')
    expect(state.forms.white).toEqual({ pieceId: 'wn', remainingTurns: 2 })
    state = move(state, 'g7', 'g6')
    expect(state.forms.white?.remainingTurns).toBe(2)
    state = move(state, 'f2', 'f3')
    expect(state.forms.white?.remainingTurns).toBe(1)
    state = move(state, 'g6', 'g5')
    state = move(state, 'f3', 'f4')
    expect(state.forms.white).toBe(null)
  })
  it('expires form before testing enhanced check and its reward', () => {
    const state = pos([p('wn', 'white', 'knight', 'c3'), p('wr', 'white', 'rook', 'h1'), p('bk', 'black', 'king', 'd4')], { forms: { white: { pieceId: 'wn', remainingTurns: 1 } } })
    expect(isInCheck(state, 'black')).toBe(true)
    const next = move(state, 'h1', 'h2')
    expect(isInCheck(next, 'black')).toBe(false)
    expect(next.energy.white).toBe(0)
  })
  it('a fresh activation replaces form and captured forms disappear without refund', () => {
    const pieces = [p('wn', 'white', 'knight', 'b1'), p('wr', 'white', 'rook', 'b2'), p('br', 'black', 'rook', 'b8')]
    const state = pos(pieces, { energy: { white: 10 }, forms: { white: { pieceId: 'wn', remainingTurns: 1 } } })
    const next = move(state, 'b2', 'b7', 'activate')
    expect(next.forms.white).toEqual({ pieceId: 'wr', remainingTurns: 2 })
    const captured = move(next, 'b8', 'b7')
    expect(captured.forms.white).toBe(null)
    expect(captured.energy.white).toBe(0)
  })
})

describe('the six complete abilities', () => {
  it('sweeps an enemy without moving the pawn, taking a piece, or losing its initial right', () => {
    const state = pos([p('wp', 'white', 'pawn', 'e2', { pawnDoubleStepEligible: true }), p('bn', 'black', 'knight', 'f3')], { energy: { white: 5 }, quietPly: 8 })
    const result = ability(state, 'wp', 'bn')
    expect(pieceAt(result.state, 'e3')?.id).toBe('bn')
    expect(pieceAt(result.state, 'e2')?.pawnDoubleStepEligible).toBe(true)
    expect(result.state.quietPly).toBe(9)
    expect(result.events.some(e => e.type === 'capture')).toBe(false)
    expect(() => ability(pos([...state.pieces, p('block', 'black', 'pawn', 'e3')], { energy: { white: 5 } }), 'wp', 'bn')).toThrow('illegalMovement')
  })
  it('sweeping a pawn resets the quiet count and clears the moved pawn right', () => {
    const state = pos([p('wp', 'white', 'pawn', 'e6'), p('bp', 'black', 'pawn', 'f7', { pawnDoubleStepEligible: true })], { energy: { white: 5 }, quietPly: 8 })
    const next = ability(state, 'wp', 'bp').state
    expect(next.quietPly).toBe(0)
    expect(pieceAt(next, 'e7')?.pawnDoubleStepEligible).toBe(false)
  })
  it.each([[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]])('raids both middle targets for jump %i,%i', (dx, dy) => {
    const to = offset('d4', dx, dy)!
    for (const middle of raidMiddles('d4', to)) {
      const state = pos([p('wn', 'white', 'knight', 'd4'), p('br', 'black', 'rook', middle)], { energy: { white: 5 } })
      const next = ability(state, 'wn', 'br', to).state
      expect(pieceAt(next, to)?.id).toBe('wn')
      expect(next.pieces.some(x => x.id === 'br')).toBe(false)
      expect(next.pieces).toHaveLength(3)
    }
  })
  it('raid requires empty landing and removes only the selected middle piece', () => {
    const pieces = [p('wn', 'white', 'knight', 'c3'), p('bp', 'black', 'pawn', 'd3'), p('br', 'black', 'rook', 'd4')]
    const next = ability(pos(pieces, { energy: { white: 5 } }), 'wn', 'bp', 'e4').state
    expect(next.pieces.some(p => p.id === 'br')).toBe(true)
    expect(() => ability(pos([...pieces, p('block', 'white', 'pawn', 'e4')], { energy: { white: 5 } }), 'wn', 'bp', 'e4')).toThrow('illegalMovement')
  })
  it('battery jumps exactly one occupied square, of either color, and only to capture', () => {
    for (const side of ['white', 'black'] as const) {
      const state = pos([p('wb', 'white', 'bishop', 'c1'), p('block', side, 'pawn', 'd2'), p('br', 'black', 'rook', 'h6')], { energy: { white: 5 } })
      expect(pieceAt(ability(state, 'wb', 'br').state, 'h6')?.id).toBe('wb')
    }
    const noBlock = pos([p('wb', 'white', 'bishop', 'c1'), p('br', 'black', 'rook', 'h6')], { energy: { white: 5 } })
    expect(() => ability(noBlock, 'wb', 'br')).toThrow('illegalMovement')
    const twoBlocks = pos([...noBlock.pieces, p('p1', 'white', 'pawn', 'd2'), p('p2', 'black', 'pawn', 'f4')], { energy: { white: 5 } })
    expect(() => ability(twoBlocks, 'wb', 'br')).toThrow('illegalMovement')
  })
  it('ram pushes a first friendly or enemy piece and forbids chains and the board edge', () => {
    for (const side of ['white', 'black'] as const) {
      const state = pos([p('wr', 'white', 'rook', 'c3'), p('target', side, 'knight', 'c6')], { energy: { white: 5 } })
      const next = ability(state, 'wr', 'target').state
      expect(pieceAt(next, 'c6')?.id).toBe('wr')
      expect(pieceAt(next, 'c7')?.id).toBe('target')
      expect(next.pieces.length).toBe(state.pieces.length)
      expect(() => ability(pos([...state.pieces, p('block', 'white', 'pawn', 'c7')], { energy: { white: 5 } }), 'wr', 'target')).toThrow('illegalMovement')
    }
    expect(() => ability(pos([p('wr', 'white', 'rook', 'c3'), p('target', 'black', 'knight', 'c8')], { energy: { white: 5 } }), 'wr', 'target')).toThrow('illegalMovement')
  })
  it('v3 shifts a continuous mixed chain atomically with one Ram in any power mode', () => {
    const line = ['b4', 'c4', 'd4', 'e4', 'f4', 'g4'].map((square, index) =>
      p('p' + index, index % 2 ? 'black' : 'white', index % 2 ? 'knight' : 'pawn', square))
    const pieces = [p('wr', 'white', 'rook', 'a4'), ...line]
    for (const mode of ['impulse', 'activate', 'form'] as const) {
      const state = pos(pieces, {
        rulesVersion: RULES_VERSION,
        energy: { white: mode === 'form' ? 0 : mode === 'activate' ? 6 : 3 },
        forms: mode === 'form' ? { white: { pieceId: 'wr', remainingTurns: 2 } } : {},
      })
      const { state: next, events } = ability(state, 'wr', 'p0', undefined, mode)
      expect(next.pieces).toHaveLength(state.pieces.length)
      expect(pieceAt(next, 'b4')?.id).toBe('wr')
      expect(pieceAt(next, 'h4')?.id).toBe('p5')
      expect(events.filter(event => event.type === 'move' && event.forced)).toHaveLength(6)
      expect(events.some(event => event.type === 'capture')).toBe(false)
      expect(next.energy.white).toBe(0)
      expect(next.forms.white?.remainingTurns ?? 0).toBe(mode === 'form' ? 1 : mode === 'activate' ? 2 : 0)
      expect(validateState(next)).toBe(true)
      expect(() => ability({ ...state, rulesVersion: 'overdrive-v2' }, 'wr', 'p0', undefined, mode)).toThrow('illegalMovement')
    }
    const energy = { white: 3 }
    const full = pos([...pieces, p('edge', 'black', 'bishop', 'h4')], { rulesVersion: RULES_VERSION, energy })
    expect(() => ability(full, 'wr', 'p0')).toThrow('illegalMovement')
    expect(full.energy.white).toBe(3)
    const king = pos([p('wr', 'white', 'rook', 'a4'), ...line.slice(0, 2), p('bk', 'black', 'king', 'd4')], { rulesVersion: RULES_VERSION, energy })
    expect(() => ability(king, 'wr', 'p0')).toThrow('illegalMovement')
  })
  it('rotation exchanges only the nearest friendly piece on a queen ray', () => {
    const state = pos([p('wq', 'white', 'queen', 'c3'), p('wr', 'white', 'rook', 'f6')], { energy: { white: 5 } })
    const next = ability(state, 'wq', 'wr').state
    expect(pieceAt(next, 'f6')?.id).toBe('wq')
    expect(pieceAt(next, 'c3')?.id).toBe('wr')
    expect(() => ability(pos([...state.pieces, p('block', 'black', 'pawn', 'd4')], { energy: { white: 5 } }), 'wq', 'wr')).toThrow('illegalMovement')
  })
  it('covered retreat resolves simultaneously and can leave check through a protected final position', () => {
    const state = pos([p('wk', 'white', 'king', 'c1'), p('wn', 'white', 'knight', 'd2'), p('br', 'black', 'rook', 'a1')], { energy: { white: 5 } })
    expect(isInCheck(state)).toBe(true)
    expect(() => move(state, 'c1', 'd1')).toThrow('kingSafety')
    const next = ability(state, 'wk', 'wn', 'd1').state
    expect(pieceAt(next, 'd1')?.id).toBe('wk')
    expect(pieceAt(next, 'c1')?.id).toBe('wn')
    expect(isInCheck(next, 'white')).toBe(false)
    const unsafe = pos([...state.pieces, p('br2', 'black', 'rook', 'd8')], { energy: { white: 5 } })
    expect(() => ability(unsafe, 'wk', 'wn', 'd1')).toThrow('kingSafety')
  })
})

describe('enhanced attacks, promotions and history', () => {
  it('paid/form attacks work at 5/0, pinned pieces still threaten, and occupied raid landings matter', () => {
    const pieces = [p('wn', 'white', 'knight', 'c3'), p('bk', 'black', 'king', 'd4')]
    expect(isInCheck(pos(pieces, { energy: { white: 4 } }), 'black')).toBe(false)
    expect(isInCheck(pos(pieces, { energy: { white: 5 } }), 'black')).toBe(true)
    expect(isInCheck(pos(pieces, { forms: { white: { pieceId: 'wn', remainingTurns: 1 } } }), 'black')).toBe(true)
    const blocked = pos([...pieces, p('a', 'white', 'pawn', 'e4'), p('b', 'white', 'pawn', 'd5')], { energy: { white: 5 } })
    expect(isInCheck(blocked, 'black')).toBe(false)
    const bishop = pos([p('wb', 'white', 'bishop', 'c1'), p('wp', 'white', 'pawn', 'd2'), p('bk', 'black', 'king', 'h6')], { energy: { white: 5 } })
    expect(isInCheck(bishop, 'black')).toBe(true)
  })
  it('enhanced threats also forbid castling transit', () => {
    const pieces = [p('wk', 'white', 'king', 'e1', { castleEligible: true }), p('wr', 'white', 'rook', 'h1', { castleEligible: true }), p('bn', 'black', 'knight', 'f2')]
    const ordinary = pos(pieces)
    expect(() => move(ordinary, 'e1', 'g1')).not.toThrow()
    expect(() => move(pos(pieces, { energy: { black: 5 } }), 'e1', 'g1')).toThrow('kingSafety')
  })
  it('preserves form identity through all four own promotions without extending it', () => {
    for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as const) {
      const state = pos([p('wp', 'white', 'pawn', 'b7')], { forms: { white: { pieceId: 'wp', remainingTurns: 2 } } })
      const next = move(state, 'b7', 'b8', 'normal', promotion)
      expect(pieceAt(next, 'b8')?.type).toBe(promotion)
      expect(next.forms.white).toEqual({ pieceId: 'wp', remainingTurns: 1 })
    }
  })
  it('requires selected own forced promotion, auto-queens enemy, and rejects wrong back rank', () => {
    const own = pos([p('wr', 'white', 'rook', 'b6'), p('wp', 'white', 'pawn', 'b7')], { energy: { white: 5 } })
    expect(() => ability(own, 'wr', 'wp')).toThrow('promotionRequired')
    expect(pieceAt(ability(own, 'wr', 'wp', undefined, 'impulse', 'knight').state, 'b8')?.type).toBe('knight')
    const enemy = pos([p('wk', 'white', 'king', 'h3'), p('wr', 'white', 'rook', 'b3'), p('bp', 'black', 'pawn', 'b2')], { energy: { white: 5 } })
    expect(pieceAt(ability(enemy, 'wr', 'bp').state, 'b1')?.type).toBe('queen')
    const unsafe = pos([p('wk', 'white', 'king', 'a1'), p('wr', 'white', 'rook', 'b3'), p('bp', 'black', 'pawn', 'b2')], { energy: { white: 5 } })
    expect(() => ability(unsafe, 'wr', 'bp')).toThrow('kingSafety')
    const wrongEdge = pos([p('wr', 'white', 'rook', 'b6'), p('bp', 'black', 'pawn', 'b7')], { energy: { white: 5 } })
    expect(() => ability(wrongEdge, 'wr', 'bp')).toThrow('illegalMovement')
  })
  it('forced rook relocation destroys historical castling rights', () => {
    const state = pos([p('wk', 'white', 'king', 'e1', { castleEligible: true }), p('wr', 'white', 'rook', 'a1', { castleEligible: true }), p('wq', 'white', 'queen', 'a3')], { energy: { white: 5 } })
    const next = ability(state, 'wq', 'wr').state
    expect(pieceAt(next, 'a3')?.castleEligible).toBe(false)
  })
  it('keys resource/form/reward semantics, normalizes interchangeable IDs and ignores ineffective EP', () => {
    const pieces = [p('n1', 'white', 'knight', 'b1'), p('n2', 'white', 'knight', 'g1')]
    const base = pos(pieces)
    expect(positionKey(base)).toBe(positionKey(pos([p('changed1', 'white', 'knight', 'b1'), p('changed2', 'white', 'knight', 'g1')])))
    expect(positionKey(base)).not.toBe(positionKey(pos(pieces, { energy: { white: 5 } })))
    expect(positionKey(base)).not.toBe(positionKey(pos(pieces, { forms: { white: { pieceId: 'n1', remainingTurns: 1 } } })))
    expect(positionKey(base)).not.toBe(positionKey(pos(pieces, { rewardedCheckLayouts: { white: [checkLayoutKey(base, 'white')] } })))
    const epPieces = [p('bp', 'black', 'pawn', 'd5')]
    expect(positionKey(pos(epPieces))).toBe(positionKey(pos(epPieces, { enPassant: { pawnId: 'bp', target: 'd6', availableTo: 'white' } })))
  })
  it('makes illegal commands wholly atomic and exact replay deterministic', () => {
    const initial = createInitialState(), snapshot = JSON.stringify(initial)
    expect(() => move(initial, 'e2', 'e5')).toThrow()
    expect(JSON.stringify(initial)).toBe(snapshot)
    const commands: Action[] = [
      { type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'e4' },
      { type: 'move', mode: 'normal', pieceId: 'black-pawn-3', to: 'd5' },
      { type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'd5' },
    ]
    let a = initial, b = JSON.parse(snapshot) as GameState
    for (const command of commands) { const ra = transition(a, command), rb = transition(b, command); expect(ra).toEqual(rb); a = ra.state; b = rb.state }
    expect(validateState(a)).toBe(true)
    expect(JSON.stringify(initial)).toBe(snapshot)
  })
})

describe('result and hostile input boundaries', () => {
  it('detects real mate, stalemate, and a concrete ability escape from ordinary mate', () => {
    const mate = pos([p('wk', 'white', 'king', 'a1'), p('bq', 'black', 'queen', 'b2'), p('bk', 'black', 'king', 'c3')])
    expect(evaluateOutcome(mate)).toEqual({ reason: 'checkmate', winner: 'black' })
    const stalemate = pos([p('wk', 'white', 'king', 'a1'), p('bq', 'black', 'queen', 'c2')])
    expect(evaluateOutcome(stalemate)).toEqual({ reason: 'stalemate', winner: null })
    const surround = [p('wk', 'white', 'king', 'c1'), p('wb', 'white', 'bishop', 'd2'), p('br', 'black', 'rook', 'a1'), p('br2', 'black', 'rook', 'b8'), p('br3', 'black', 'rook', 'c8')]
    expect(evaluateOutcome(pos(surround))).toEqual({ reason: 'checkmate', winner: 'black' })
    const escaped = pos(surround, { energy: { white: 5 } })
    expect(hasLegalAction(escaped)).toBe(true)
    expect(legalCommands(escaped).some(c => c.type === 'ability' && c.pieceId === 'wk')).toBe(true)
  })
  it('handles claimable and automatic draws with mate priority', () => {
    const initial = createInitialState(), key = positionKey(initial)
    const claimable = { ...initial, repetition: { [key]: 3 } }
    expect(legalCommands(claimable)).toContainEqual({ type: 'claimDraw', reason: 'repetition' })
    expect(transition(claimable, { type: 'claimDraw', reason: 'repetition' }).state.outcome?.winner).toBe(null)
    expect(evaluateOutcome({ ...initial, repetition: { [key]: 5 } })?.reason).toBe('repetition')
    expect(transition({ ...initial, quietPly: 100 }, { type: 'claimDraw', reason: 'fiftyMoves' }).state.outcome?.reason).toBe('fiftyMoves')
    expect(evaluateOutcome({ ...initial, quietPly: 150 })?.reason).toBe('seventyFiveMoves')
    expect(evaluateOutcome(pos([], { quietPly: 150 }))?.reason).toBe('bareKings')
    expect(() => transition(initial, { type: 'claimDraw', reason: 'repetition' })).toThrow('noDraw')
  })
  it('rejects malformed state, forged rights/forms and malformed commands', () => {
    const state = createInitialState()
    expect(validateState({ ...state, rulesVersion: 'remorse-v1' })).toBe(false)
    expect(validateState({ ...state, energy: { white: -1, black: 0 } })).toBe(false)
    expect(validateState({ ...state, forms: { white: { pieceId: 'black-pawn-0', remainingTurns: 2 }, black: null } })).toBe(false)
    expect(validateState({ ...state, pieces: [...state.pieces, state.pieces[0]] })).toBe(false)
    expect(validateCommand({ type: 'move', mode: 'normal', pieceId: 'white-pawn-0', to: 'a9' })).toBe(false)
    expect(validateCommand({ type: 'move', mode: 'normal', pieceId: 'white-pawn-0', to: 'a3', energy: 10 })).toBe(false)
    expect(validateCommand({ type: 'agreeDraw', side: 'white' })).toBe(false)
    expect(new Set(legalCommands(state).map(commandKey)).size).toBe(legalCommands(state).length)
  })
  it('all generated commands are deterministic legal transitions and preserve state invariants', () => {
    let state = createInitialState()
    for (let ply = 0; ply < 45 && !state.outcome; ply++) {
      const actions = legalCommands(state)
      const selected = actions[(ply * 19 + 7) % actions.length]
      expect(selected).toBeDefined()
      const snapshot = JSON.stringify(state)
      const next = transition(state, selected).state
      expect(validateState(next)).toBe(true)
      expect(isInCheck(next, opposite(next.side))).toBe(false)
      expect(JSON.stringify(state)).toBe(snapshot)
      state = next
    }
  }, 20000)
})

describe('teaching uses the unchanged live rules', () => {
  it('validates every teaching fixture, the expected action and its observable lesson', async () => {
    const { TEACHING_FIXTURES } = await import('../../src/core/teaching')
    expect(TEACHING_FIXTURES).toHaveLength(9)
    for (const fixture of TEACHING_FIXTURES) {
      expect(validateState(fixture.state), fixture.id).toBe(true)
      expect(legalActions(fixture.state).map(commandKey), fixture.id).toContain(commandKey(fixture.expected))
      const result = transition(fixture.state, fixture.expected)
      expect(validateState(result.state), fixture.id).toBe(true)
      if (fixture.id === 'capture') expect(result.state.energy.white).toBe(2)
      else if (fixture.id === 'check') { expect(result.state.energy.white).toBe(2); expect(isInCheck(result.state)).toBe(true) }
      else if (fixture.id === 'form') expect(result.state.forms.white).toEqual({ pieceId: 'wn', remainingTurns: 2 })
      else expect(result.events.some(e => e.type === 'ability' && e.ability === fixture.id)).toBe(true)
    }
  })
})

describe('cross-feature regressions from the normative rule audit', () => {
  it('gives one check reward for a discovered double check', () => {
    const state = pos([p('wk', 'white', 'king', 'a1'), p('wr', 'white', 'rook', 'e1'), p('wb', 'white', 'bishop', 'e2'), p('bk', 'black', 'king', 'e8')])
    const next = move(state, 'e2', 'b5')
    expect(isInCheck(next, 'black')).toBe(true)
    expect(next.energy.white).toBe(2)
    expect(next.rewardedCheckLayouts.white).toHaveLength(1)
  })
  it('lets a stationary king be the single battery screen without moving or taking that king', () => {
    const state = pos([p('wk', 'white', 'king', 'd2'), p('wb', 'white', 'bishop', 'c1'), p('bq', 'black', 'queen', 'h6'), p('bk', 'black', 'king', 'a8')], { energy: { white: 5 } })
    expect(isInCheck(state, 'white')).toBe(true)
    const next = ability(state, 'wb', 'bq').state
    expect(pieceAt(next, 'd2')?.id).toBe('wk')
    expect(pieceAt(next, 'h6')?.id).toBe('wb')
    expect(isInCheck(next, 'white')).toBe(false)
  })
  it('allows EP after an activation double step but expires it on any opposing ability', () => {
    let state = pos([p('wp', 'white', 'pawn', 'e2', { pawnDoubleStepEligible: true }), p('bp', 'black', 'pawn', 'd4'), p('br', 'black', 'rook', 'f6'), p('bn', 'black', 'knight', 'f5')], { energy: { white: 10, black: 5 } })
    state = move(state, 'e2', 'e4', 'activate')
    expect(state.enPassant).toEqual({ pawnId: 'wp', target: 'e3', availableTo: 'black' })
    expect(effectiveEnPassant(state)).toBe('e3')
    expect(move(state, 'd4', 'e3').pieces.some(p => p.id === 'wp')).toBe(false)
    const alternative = ability(state, 'br', 'bn').state
    expect(alternative.enPassant).toBe(null)
    expect(alternative.forms.white).toEqual({ pieceId: 'wp', remainingTurns: 2 })
  })
  it('does not regain pawn double step after a forced displacement and return', () => {
    const state = pos([p('wp', 'white', 'pawn', 'e2', { pawnDoubleStepEligible: true }), p('wq', 'white', 'queen', 'f3')], { energy: { white: 10 } })
    const away = ability(state, 'wq', 'wp').state
    expect(pieceAt(away, 'f3')?.pawnDoubleStepEligible).toBe(false)
    const sameSide = { ...away, side: 'white' as const }
    const back = ability(sameSide, 'wq', 'wp').state
    expect(pieceAt(back, 'e2')?.pawnDoubleStepEligible).toBe(false)
    expect(() => move({ ...back, side: 'white' }, 'e2', 'e4')).toThrow('illegalMovement')
  })
  it('repeats actual complete positions three and five times without double-counting a reload', () => {
    let state = pos([p('wn', 'white', 'knight', 'b1'), p('bn', 'black', 'knight', 'g8')])
    const initialKey = positionKey(state)
    const cycle = () => {
      state = move(state, 'b1', 'a3'); state = move(state, 'g8', 'h6'); state = move(state, 'a3', 'b1'); state = move(state, 'h6', 'g8')
    }
    cycle(); cycle()
    expect(state.repetition[initialKey]).toBe(3)
    expect(legalCommands(state)).toContainEqual({ type: 'claimDraw', reason: 'repetition' })
    state = JSON.parse(JSON.stringify(state)) as GameState
    expect(validateState(state)).toBe(true)
    expect(state.repetition[initialKey]).toBe(3)
    cycle(); cycle()
    expect(state.outcome).toEqual({ reason: 'repetition', winner: null })
  })
  it('prioritizes checkmate on the 150th quiet ply', () => {
    const state = pos([p('wk', 'white', 'king', 'c3'), p('wq', 'white', 'queen', 'b3'), p('bk', 'black', 'king', 'a1')], { quietPly: 149 })
    const next = move(state, 'b3', 'b2')
    expect(next.quietPly).toBe(150)
    expect(next.outcome).toEqual({ reason: 'checkmate', winner: 'white' })
  })
  it('requires a complete paid action, disallows redundant impulse on a formed piece and atomically rejects a futile activation', () => {
    const state = pos([p('wn', 'white', 'knight', 'c3'), p('br', 'black', 'rook', 'd4')], { energy: { white: 10 }, forms: { white: { pieceId: 'wn', remainingTurns: 1 } } })
    expect(() => ability(state, 'wn', 'br', 'e4')).toThrow('form')
    const used = ability(state, 'wn', 'br', 'e4', 'form').state
    expect(used.forms.white).toBe(null)
    expect(used.energy.white).toBe(10)
    expect(() => move(state, 'c3', 'c3', 'activate')).toThrow('illegalMovement')
    expect(state.forms.white?.remainingTurns).toBe(1)
    expect(state.energy.white).toBe(10)
  })
})

it('rolls back a late king-safety failure after activation and a provisional check reward', () => {
  const state = pos([p('wk', 'white', 'king', 'a1'), p('wr', 'white', 'rook', 'a2'), p('br', 'black', 'rook', 'a8'), p('bk', 'black', 'king', 'h2')], { energy: { white: 10 } })
  const before = JSON.stringify(state)
  expect(() => move(state, 'a2', 'g2', 'activate')).toThrow('kingSafety')
  expect(JSON.stringify(state)).toBe(before)
  expect(state.forms.white).toBe(null)
  expect(state.rewardedCheckLayouts.white).toHaveLength(0)
  expect(state.energy.white).toBe(10)
})
