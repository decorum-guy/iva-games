import { describe, it, expect } from 'vitest'
import { boardOf, isSquareAttacked } from '../../src/core/geometry'
import { refreshContacts, settlePassives } from '../../src/core/passives'
import { createPosition, createInitialState, validateState } from '../../src/core/state'
import { applyResolvedCommand, legalCommands, enumerateOutcomes, positionKey, canClaimRepetition } from '../../src/core/rules'
import type { Piece, PieceInput, Side, DieFace } from '../../src/core/types'

// Independent coordinate and attack oracle: does not reuse the core's ray,
// offset, susceptibility, contact, or attack helpers.
const xy = (s: string) => [s.charCodeAt(0) - 97, Number(s[1]) - 1]
const sq = (n: number) => String.fromCharCode(97 + n % 8) + (Math.floor(n / 8) + 1)
const nearby = (a: string, b: string) => {
  const [x,y] = xy(a), [u,v] = xy(b)
  return a !== b && Math.abs(x-u) <= 1 && Math.abs(y-v) <= 1
}
function attacked(pieces: readonly Piece[], target: string, side: Side) {
  const [x,y] = xy(target)
  return pieces.some(p => {
    if (p.side !== side || p.square === target) return false
    const [u,v] = xy(p.square), dx = x-u, dy = y-v
    if (p.type === 'king') return Math.max(Math.abs(dx), Math.abs(dy)) === 1
    if (p.type === 'bishop' || p.affliction === 'guilt' || p.affliction === 'devastated') return false
    if (p.type === 'pawn') return Math.abs(dx) === 1 && dy === (side === 'white' ? 1 : -1)
    if (p.type === 'knight') return Math.abs(dx) * Math.abs(dy) === 2
    const straight = dx === 0 || dy === 0
    const diagonal = Math.abs(dx) === Math.abs(dy)
    if (!straight && !(p.type === 'queen' && diagonal)) return false
    const distance = Math.max(Math.abs(dx), Math.abs(dy))
    for (let step = 1; step < distance; step++) {
      const bx = u + Math.sign(dx)*step, by = v + Math.sign(dy)*step
      if (pieces.some(other => xy(other.square)[0] === bx && xy(other.square)[1] === by)) return false
    }
    return true
  })
}
const immune = (p: Piece) => p.type === 'king' || p.affliction === 'berserk' || p.affliction === 'bloodlust'
const afflicted = (p: Piece) => p.affliction === 'guilt' || p.affliction === 'devastated'
const cleared = (p: Piece): Piece => ({ ...p, affliction: 'neutral', devastationDue: null, cureArmedAt: null, shameArmedAt: null })
function referenceContacts(pieces: readonly Piece[], now: number): Piece[] {
  return pieces.map(p => {
    if (immune(p)) return p
    const neighbors = pieces.filter(q => nearby(p.square, q.square))
    const rally = neighbors.some(q => q.side === p.side && q.type === 'king')
    const friend = neighbors.some(q => q.side === p.side && q.type === 'bishop')
    const foe = neighbors.some(q => q.side !== p.side && q.type === 'bishop')
    if (rally && afflicted(p)) return cleared(p)
    return { ...p,
      cureArmedAt: !rally && friend && afflicted(p) ? p.cureArmedAt ?? now : null,
      shameArmedAt: !rally && !friend && foe ? p.shameArmedAt ?? now : null,
    }
  })
}
function referenceSettlement(pieces: readonly Piece[], now: number) {
  const transformed: Piece[] = []
  for (const p of pieces) {
    if (p.cureArmedAt !== null && now - p.cureArmedAt >= 2) {
      transformed.push(cleared(p))
    } else if (p.shameArmedAt !== null && now - p.shameArmedAt >= 2) {
      if (p.affliction === 'devastated') {
        transformed.push({ ...cleared(p), side: p.side === 'white' ? 'black' : 'white', captureReaction: 'unassigned', capturesSinceRebirth: 0, castleEligible: false, pawnDoubleStepEligible: false })
      } else {
        const next = p.affliction === 'guilt' ? 'devastated' : 'guilt'
        transformed.push({ ...p, affliction: next, devastationDue: next === 'devastated' ? now+6 : null, cureArmedAt: null, shameArmedAt: null })
      }
    } else if (p.devastationDue === null || p.devastationDue > now) {
      transformed.push(p)
    }
  }
  return referenceContacts(transformed, now)
}
let seed = 0x25a11d
const rnd = (n: number) => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) % n }
const plain = (id: string, type: Piece['type'], square: string, side: Side, affliction: Piece['affliction'] = 'neutral'): Piece => ({
  id, type, square, side, affliction,
  captureReaction: affliction === 'berserk' || affliction === 'bloodlust' ? 'berserk' : 'unassigned',
  capturesSinceRebirth: affliction === 'bloodlust' ? 3 : affliction === 'berserk' ? 1 : 0,
  castleEligible: false, pawnDoubleStepEligible: false,
  devastationDue: affliction === 'devastated' ? 11 + rnd(6) : null,
  cureArmedAt: null, shameArmedAt: null,
})

describe('independent semantic audit', () => {
  it('compares every square in 400 mixed boards against a separately written attack oracle', () => {
    const types = ['pawn','knight','bishop','rook','queen','king'] as const
    const states = ['neutral','guilt','devastated','berserk','bloodlust'] as const
    for (let sample = 0; sample < 400; sample++) {
      const occupied = new Set<number>()
      const pieces: Piece[] = []
      while (pieces.length < 2+rnd(25)) {
        const n = rnd(64)
        if (occupied.has(n)) continue
        occupied.add(n)
        const type = types[rnd(types.length)]
        pieces.push(plain(String(pieces.length), type, sq(n), rnd(2) ? 'white' : 'black', type === 'king' ? 'neutral' : states[rnd(states.length)]))
      }
      const board = boardOf({ pieces })
      for (let i = 0; i < 64; i++) for (const side of ['white','black'] as const) {
        expect(isSquareAttacked(board, sq(i), side), JSON.stringify({sample, i, side, pieces})).toBe(attacked(pieces, sq(i), side))
      }
    }
  })

  it('compares 800 simultaneous passive batches with independent adjacency and deadline calculations', () => {
    const types = ['pawn','knight','bishop','rook','queen','bishop','king'] as const
    const states = ['neutral','guilt','devastated','berserk','bloodlust'] as const
    for (let sample = 0; sample < 800; sample++) {
      const occupied = new Set<number>()
      const pieces: Piece[] = []
      while (pieces.length < 8+rnd(20)) {
        const n = rnd(64)
        if (occupied.has(n)) continue
        occupied.add(n)
        const type = types[rnd(types.length)]
        pieces.push(plain(String(pieces.length), type, sq(n), rnd(2) ? 'white' : 'black', type === 'king' ? 'neutral' : states[rnd(states.length)]))
      }
      const initialized = referenceContacts(pieces, 10).map(p => ({ ...p,
        cureArmedAt: p.cureArmedAt === null ? null : 9 + rnd(2),
        shameArmedAt: p.shameArmedAt === null ? null : 9 + rnd(2),
      }))
      expect(refreshContacts(initialized, 10)).toEqual(referenceContacts(initialized, 10))
      expect(settlePassives(initialized, 11), `sample ${sample}`).toEqual(referenceSettlement(initialized, 11))
      expect([...settlePassives([...initialized].reverse(), 11)].sort((a,b) => a.id.localeCompare(b.id))).toEqual([...referenceSettlement(initialized, 11)].sort((a,b) => a.id.localeCompare(b.id)))
    }
  })

  it('checks all capture reaction faces, prior memories, mercy, bishop precedence, and the knight exemption', () => {
    const situations: Partial<PieceInput>[] = [
      {}, { capturesSinceRebirth: 1 }, { capturesSinceRebirth: 2 }, { capturesSinceRebirth: 3 },
      { captureReaction: 'guilt', capturesSinceRebirth: 1 },
      { captureReaction: 'devastated', capturesSinceRebirth: 1 },
      { captureReaction: 'unaffected', capturesSinceRebirth: 1 },
      { affliction: 'berserk', captureReaction: 'berserk', capturesSinceRebirth: 1 },
      { affliction: 'berserk', captureReaction: 'berserk', capturesSinceRebirth: 2 },
      { affliction: 'bloodlust', captureReaction: 'berserk', capturesSinceRebirth: 3 },
    ]
    let checked = 0
    for (const type of ['pawn','knight','rook','queen'] as const) for (const situation of situations) {
      for (const victimType of ['pawn','bishop'] as const) for (const victimState of ['neutral','devastated'] as const) {
        const from = type === 'pawn' ? 'c4' : type === 'knight' ? 'c3' : 'd4'
        const state = createPosition({ pieces: [
          { type: 'king', side:'white', square:'a1' }, { type:'king', side:'black', square:'h7' },
          { type, side:'white', square:from, ...situation },
          { type:victimType, side:'black', square:'d5', affliction:victimState },
        ] })
        const p = state.pieces.find(p => p.square === from)!
        const frenzy = p.affliction === 'berserk' || p.affliction === 'bloodlust'
        const free = type === 'knight' && p.capturesSinceRebirth === 0
        const mercy = victimState === 'devastated' && victimType !== 'bishop'
        const roll = !frenzy && victimType !== 'bishop' && !mercy && !free && p.captureReaction === 'unassigned'
        for (const face of (roll ? [1,2,3,4,5,6] : [undefined]) as (DieFace | undefined)[]) {
          const result = applyResolvedCommand(state, { type:'move', from, to:'d5' }, face)
          const after = result.state.pieces.find(q => q.id === p.id)!
          const count = p.capturesSinceRebirth+1
          let memory = p.captureReaction
          let current = p.affliction
          if (frenzy) current = count >= 3 ? 'bloodlust' : 'berserk'
          else if (victimType === 'bishop') current = 'devastated'
          else if (!mercy && !free) {
            const reaction = face === 1 ? 'devastated' : face === 2 || face === 3 ? 'guilt' : face === 4 || face === 5 ? 'unaffected' : face === 6 ? 'berserk' : memory
            memory = reaction
            current = reaction === 'unaffected' ? 'neutral' : reaction === 'berserk' && count >= 3 ? 'bloodlust' : reaction as Piece['affliction']
          }
          expect(after, JSON.stringify({type,situation,victimType,victimState,face})).toMatchObject({ captureReaction:memory, affliction:current, capturesSinceRebirth:count })
          validateState(result.state)
          checked++
        }
      }
    }
    console.log('capture cases', checked)
  })

  it('plays 12 deterministic varied random games while checking independent king safety and validated round trips', () => {
    let commands = 0
    let completed = 0
    for (let game = 0; game < 12; game++) {
      let state = createInitialState()
      for (let ply = 0; ply < 140 && !state.outcome; ply++) {
        const legal = legalCommands(state)
        expect(legal.length).toBeGreaterThan(0)
        const captures = legal.filter(c => c.type === 'move' && state.pieces.some(p => p.square === c.to))
        const candidates = captures.length && rnd(3) ? captures : legal
        const command = candidates[rnd(candidates.length)]
        const options = enumerateOutcomes(state, command)
        const outcome = options[rnd(options.length)]
        const oldSide = state.side
        state = applyResolvedCommand(state, command, outcome.face).state
        const king = state.pieces.find(p => p.side === oldSide && p.type === 'king')!
        expect(attacked(state.pieces, king.square, oldSide === 'white' ? 'black' : 'white'), JSON.stringify({game,ply,command})).toBe(false)
        expect(validateState(JSON.parse(JSON.stringify(state)))).toEqual(state)
        commands++
      }
      if (state.outcome) completed++
    }
    console.log('random games', { commands, completed })
  })

  it('documents inert en-passant metadata distinguishing otherwise identical repeat positions', () => {
    const base = createPosition({ pieces: [
      { type:'king', side:'white', square:'a1' }, { type:'king', side:'black', square:'h8' },
      { type:'knight', side:'white', square:'b1' }, { type:'knight', side:'black', square:'g8' },
      { type:'pawn', side:'white', square:'e2', pawnDoubleStepEligible:true },
    ] })
    let state = applyResolvedCommand(base, {type:'move',from:'e2',to:'e4'}).state
    const firstKey = positionKey(state)
    const firstMoves = legalCommands(state).map(c => JSON.stringify(c)).sort()
    const line = [['g8','f6'],['b1','c3'],['f6','g8'],['c3','b1']]
    for (let cycle = 0; cycle < 2; cycle++) for (const [from,to] of line) state = applyResolvedCommand(state, {type:'move',from,to}).state
    expect(legalCommands(state).map(c => JSON.stringify(c)).sort()).toEqual(firstMoves)
    expect(positionKey(state)).not.toBe(firstKey)
    expect(canClaimRepetition(state)).toBe(false)
    console.log('inert en passant', { rootWithEP:state.repetition[firstKey], repeatedWithoutEP:state.repetition[positionKey(state)], claimAfterThreeBoardOccurrences:canClaimRepetition(state) })
  })
})
