/**
 * Deterministic tactical positions and one exact opening replay for the audit.
 * Handcrafted fixtures do not establish reachability or game prevalence.
 * These probes are not self-play evidence or human strength measurements.
 */
import {
  checkLayoutKey, commandKey, createInitialState, createPosition, energyBankSize, isInCheck,
  legalActions, legalCommands, transition, validateState,
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

/**
 * Reproduces a trap imposed by an orthodox opening tape. Enumeration proves
 * only mate in one after each eighth ply, not a forced win from the opening.
 */
function sicilianOpeningProbe(rulesVersion: RulesVersion) {
  let state = createPosition({ rulesVersion, pieces: createInitialState().pieces })
  const firstSeven = 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4'.split(' ')
  for (const coordinates of firstSeven) {
    const piece = state.pieces.find(piece => piece.square === coordinates.slice(0, 2))
    ensure(piece, `Missing opening piece at ${coordinates}`)
    state = checkedTransition(state, { type: 'move', mode: 'normal', pieceId: piece!.id, to: coordinates.slice(2, 4) }).state
  }
  const beforeEighthPly = state
  const imposedEighthPly: Action = { type: 'move', mode: 'normal', pieceId: 'black-knight-6', to: 'f6' }
  const bishopCheck: Action = { type: 'move', mode: 'normal', pieceId: 'white-bishop-5', to: 'b5' }
  const afterEighthPly = checkedTransition(beforeEighthPly, imposedEighthPly).state
  const afterBishopCheck = checkedTransition(afterEighthPly, bishopCheck)
  // Clear only the terminal marker to enumerate the underlying board's replies
  // independently of legalActions' early return for completed games.
  const legalReplies = legalActions({ ...afterBishopCheck.state, outcome: null }).map(commandKey)
  ensure(afterBishopCheck.state.energy.white === 3, 'Sicilian checking-move energy mismatch')
  ensure(legalReplies.length === (rulesVersion === 'overdrive-v2' ? 0 : 5), 'Sicilian reply count mismatch')
  ensure(rulesVersion === 'overdrive-v2'
    ? afterBishopCheck.state.outcome?.winner === 'white' && afterBishopCheck.state.outcome.reason === 'checkmate'
    : afterBishopCheck.state.outcome === null, 'Sicilian trap outcome mismatch')

  const alternatives = legalActions(beforeEighthPly).map(action => {
    const next = checkedTransition(beforeEighthPly, action).state
    const whiteMatesInOne = legalActions(next).filter(reply => {
      const outcome = transition(next, reply).state.outcome
      return outcome?.reason === 'checkmate' && outcome.winner === 'white'
    }).map(commandKey)
    return { command: commandKey(action), whiteMatesInOne }
  })
  const alternativesAvoidingImmediateMate = alternatives.filter(alternative => alternative.whiteMatesInOne.length === 0)
  ensure(alternatives.length === 28, 'Sicilian alternative count mismatch')
  ensure(alternativesAvoidingImmediateMate.length === (rulesVersion === 'overdrive-v2' ? 13 : 28), 'Sicilian mate-avoidance count mismatch')

  const searched = search(beforeEighthPly, {
    id: 0, anchor: 0, maxDepth: 3, maxNodes: 1_400, maxTimeMs: Infinity, temperature: .1,
  }, { timeLimitMs: Infinity, random: () => .5 })
  const chosenAlternative = alternatives.find(alternative => searched.command && alternative.command === commandKey(searched.command))
  ensure(chosenAlternative && chosenAlternative.whiteMatesInOne.length === 0, 'Search selected an avoidable immediate mate')
  return {
    probe: 'imposed-sicilian-opening-trap', rulesVersion,
    method: 'Exact opening replay; exhaustive immediate replies for all 28 black alternatives; not a forced-mate proof from the initial position',
    opening: `${firstSeven.join(' ')} g8f6 f1b5`,
    energyBeforeCheck: afterEighthPly.energy, energyAfterCheck: afterBishopCheck.state.energy,
    outcome: afterBishopCheck.state.outcome, legalReplies,
    alternatives, alternativesAvoidingImmediateMate: alternativesAvoidingImmediateMate.map(alternative => alternative.command),
    searchedAlternative: searched.command,
    search: { depth: searched.diagnostics.depth, nodes: searched.diagnostics.nodes, stopReason: searched.diagnostics.stopReason },
  }
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
    results.push(sicilianOpeningProbe(rulesVersion))
  }
  return { method: 'Deterministic core probes, exhaustive opening-trap replies and four tactical SDK searches; not full games', probes: results.length, results }
}
