/**
 * Deterministic, handcrafted tactical positions for the energy-v2 audit.
 * These are reachable-state-independent rule probes, not self-play evidence,
 * human strength measurements, or a claim about their prevalence in games.
 */
import {
  checkLayoutKey, commandKey, createPosition, energyBankSize, isInCheck,
  legalCommands, transition, validateState,
  type Action, type GameState, type PieceType, type RulesVersion, type Transition,
} from '../core'
import { MATERIAL } from './evaluate'
import { search } from './search'

const VERSIONS: readonly RulesVersion[] = ['overdrive-v1', 'overdrive-v2']
const ensure = (condition: unknown, message: string): void => { if (!condition) throw new Error(message) }
const material = (state: GameState) => state.pieces.reduce((sum, piece) => sum + (piece.side === 'white' ? 1 : -1) * MATERIAL[piece.type], 0)
const energyEvent = (result: Transition) => result.events.find(event => event.type === 'energy')
function checkedTransition(state: GameState, action: Action) {
  const before = JSON.stringify(state)
  const result = transition(state, action)
  ensure(JSON.stringify(state) === before, 'Probe mutated its input')
  ensure(validateState(result.state), 'Probe returned an invalid state')
  ensure(legalCommands(state).some(command => commandKey(command) === commandKey(action)), 'Probe action was not enumerated as legal')
  return result
}

export function runBalanceProbes() {
  const results: unknown[] = []
  for (const rulesVersion of VERSIONS) {
    const bank = energyBankSize(rulesVersion)

    // A battery captures its second blocker on d4 and checks along d4-h8.
    // Testing each victim with and without check isolates capture economics.
    for (const victim of ['pawn', 'knight', 'bishop', 'rook', 'queen'] as const satisfies readonly PieceType[]) {
      for (const withCheck of [false, true]) {
        const state = createPosition({ rulesVersion, energy: { white: bank }, pieces: [
          { id: 'wk', side: 'white', type: 'king', square: 'h1' },
          { id: 'bk', side: 'black', type: 'king', square: withCheck ? 'h8' : 'g8' },
          { id: 'wb', side: 'white', type: 'bishop', square: 'a1' },
          { id: 'wp', side: 'white', type: 'pawn', square: 'b2' },
          { id: 'victim', side: 'black', type: victim, square: 'd4' },
        ] })
        const result = checkedTransition(state, { type: 'ability', mode: 'impulse', pieceId: 'wb', targetId: 'victim' })
        ensure(isInCheck(result.state) === withCheck, 'Unexpected check in capture fixture')
        results.push({ probe: 'impulse-capture', rulesVersion, victim, withCheck, energy: energyEvent(result), netEnergy: result.state.energy.white - state.energy.white })
      }
    }

    const charged = createPosition({ rulesVersion, energy: { white: bank * 2 }, pieces: [
      { id: 'wk', side: 'white', type: 'king', square: 'h1' },
      { id: 'bk', side: 'black', type: 'king', square: 'h8' },
      { id: 'wb', side: 'white', type: 'bishop', square: 'a1' },
      { id: 'wp', side: 'white', type: 'pawn', square: 'b2' },
      { id: 'bq', side: 'black', type: 'queen', square: 'd4' },
    ] })
    const activated = checkedTransition(charged, { type: 'ability', mode: 'activate', pieceId: 'wb', targetId: 'bq' })
    ensure(activated.state.forms.white?.remainingTurns === 2, 'Activation lifetime mismatch')
    ensure(activated.state.energy.white === (rulesVersion === 'overdrive-v2' ? 6 : 3), 'Activation refund mismatch')
    results.push({ probe: 'activation-checking-queen-capture', rulesVersion, energy: energyEvent(activated), remainingOwnTurns: activated.state.forms.white?.remainingTurns, outcome: activated.state.outcome })

    // Capturing a rook can switch on another piece's battery threat. Reward
    // must be evaluated after capture energy but cannot bootstrap itself.
    const threshold = createPosition({ rulesVersion, pieces: [
      { id: 'wk', side: 'white', type: 'king', square: 'a8' },
      { id: 'bk', side: 'black', type: 'king', square: 'd4' },
      { id: 'wb', side: 'white', type: 'bishop', square: 'a1' },
      { id: 'wp', side: 'white', type: 'pawn', square: 'b2' },
      { id: 'wr', side: 'white', type: 'rook', square: 'h3' },
      { id: 'br', side: 'black', type: 'rook', square: 'h7' },
    ] })
    const unlocked = checkedTransition(threshold, { type: 'move', mode: 'normal', pieceId: 'wr', to: 'h7' })
    ensure(unlocked.state.energy.white === (rulesVersion === 'overdrive-v2' ? 5 : 1), 'Capture-triggered check mismatch')
    results.push({ probe: 'capture-unlocks-remote-check', rulesVersion, check: isInCheck(unlocked.state), energy: energyEvent(unlocked) })

    // A stored check layout remains spent even if its first reward overflowed.
    const checkInput = { rulesVersion, pieces: [
      { id: 'wk', side: 'white' as const, type: 'king' as const, square: 'h1' },
      { id: 'bk', side: 'black' as const, type: 'king' as const, square: 'h8' },
      { id: 'wr', side: 'white' as const, type: 'rook' as const, square: 'g1' },
    ] }
    const checkAction: Action = { type: 'move', mode: 'normal', pieceId: 'wr', to: 'g8' }
    const full = checkedTransition(createPosition({ ...checkInput, energy: { white: bank * 2 } }), checkAction)
    const key = checkLayoutKey(full.state, 'white')
    ensure(full.state.rewardedCheckLayouts.white.includes(key), 'Overflowed check was not recorded')
    const repeated = checkedTransition(createPosition({ ...checkInput, rewardedCheckLayouts: { white: [key] } }), checkAction)
    ensure(repeated.state.energy.white === 0, 'Repeated layout rewarded twice')
    results.push({ probe: 'overflowed-check-cannot-recharge-later', rulesVersion, recordedAtCap: true, repeatedEnergy: repeated.state.energy.white })

    const rotation = createPosition({ rulesVersion, energy: { white: bank }, pieces: [
      { id: 'wk', side: 'white', type: 'king', square: 'a1' },
      { id: 'bk', side: 'black', type: 'king', square: 'a6' },
      { id: 'wq', side: 'white', type: 'queen', square: 'g8' },
      { id: 'wp', side: 'white', type: 'pawn', square: 'g3' },
    ] })
    const promoted = checkedTransition(rotation, { type: 'ability', mode: 'impulse', pieceId: 'wq', targetId: 'wp', promotion: 'queen' })
    ensure(promoted.state.pieces.find(piece => piece.id === 'wp')?.type === 'queen', 'Forced promotion missing')
    const searched = search(rotation, { id: 4, anchor: 1000, maxDepth: 2, maxNodes: 20_000, maxTimeMs: Infinity, temperature: 0 }, { timeLimitMs: Infinity })
    const selected = searched.command && searched.command.type !== 'claimDraw' && searched.command.type !== 'resign' && searched.command.type !== 'agreeDraw' ? transition(rotation, searched.command) : null
    const selectedPromotes = selected?.events.some(event => event.type === 'promotion' && event.forced) ?? false
    ensure(selectedPromotes, 'Depth-two search did not select the forced promotion fixture')
    results.push({ probe: 'rotation-forced-promotion', rulesVersion, cost: bank, materialGain: Number((material(promoted.state) - material(rotation)).toFixed(3)), selectedPromotes, selectedAction: searched.command, search: { depth: searched.diagnostics.depth, nodes: searched.diagnostics.nodes, stopReason: searched.diagnostics.stopReason } })

    let duration = createPosition({ rulesVersion, energy: { white: bank * 2 }, pieces: [
      { id: 'wk', side: 'white', type: 'king', square: 'h1' },
      { id: 'bk', side: 'black', type: 'king', square: 'a8' },
      { id: 'wn', side: 'white', type: 'knight', square: 'e2' },
    ] })
    const actions: Action[] = [
      { type: 'move', mode: 'activate', pieceId: 'wn', to: 'f4' },
      { type: 'move', mode: 'normal', pieceId: 'bk', to: 'b8' },
      { type: 'move', mode: 'normal', pieceId: 'wk', to: 'h2' },
      { type: 'move', mode: 'normal', pieceId: 'bk', to: 'a8' },
      { type: 'move', mode: 'normal', pieceId: 'wk', to: 'h1' },
    ]
    const remainingOwnTurns: number[] = []
    for (const action of actions) {
      duration = checkedTransition(duration, action).state
      remainingOwnTurns.push(duration.forms.white?.remainingTurns ?? 0)
    }
    ensure(JSON.stringify(remainingOwnTurns) === '[2,2,1,1,0]', 'Form did not expire on the third own turn')
    results.push({ probe: 'form-expires-on-third-own-turn', rulesVersion, remainingOwnTurns })
  }
  return { method: 'Handcrafted deterministic core transitions and two depth-two tactical searches; not full games', probes: results.length, results }
}
