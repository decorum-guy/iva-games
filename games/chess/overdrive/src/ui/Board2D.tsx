import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { isInCheck, type GameState, type PieceType, type Side } from '../core'
import { PieceIcon } from './PieceIcon'
import { pieceName, sideName, tr, type Language } from './i18n'
import { piecePoseAt, sceneTiming, squarePoint } from './motion'
import type { BoardMotion } from './motion'

export interface Board2DProps {
  state: GameState
  selected: string | null
  targets: readonly string[]
  focusSquares: readonly string[]
  onSquare(square: string): void
  flipped: boolean
  language: Language
  accessibleOnly?: boolean
  motion?: BoardMotion | null
  reduced?: boolean
}

export interface BoardSprite {
  readonly id: string
  readonly side: Side
  readonly type: PieceType
  readonly left: number
  readonly top: number
  readonly lift: number
  readonly opacity: number
  readonly scale: number
}

/** World coordinates and CSS percentages share a1 = left/bottom before a flip. */
export function boardPercent(x: number, z: number, flipped: boolean): { left: number; top: number } {
  const direction = flipped ? -1 : 1
  return { left: (x * direction + 4) * 12.5, top: (z * direction + 4) * 12.5 }
}

/** The same event-derived pose as 3D; no second move interpolation or capture clock. */
export function boardSpritesAt(motion: BoardMotion, elapsedMs: number, flipped: boolean, reduced = false): readonly BoardSprite[] {
  const pieces = new Map([...motion.before.pieces, ...motion.after.pieces].map(piece => [piece.id, piece]))
  const result: BoardSprite[] = []
  for (const piece of pieces.values()) {
    const pose = piecePoseAt(motion, piece.id, elapsedMs, reduced)
    if (!pose?.visible) continue
    result.push({ id: piece.id, side: piece.side, type: pose.presentationType,
      ...boardPercent(pose.x, pose.z, flipped), lift: pose.lift,
      opacity: pose.opacity, scale: pose.scale })
  }
  return result
}

export interface BoardFrameClock {
  now(): number
  request(callback: () => void): number
  cancel(handle: number): void
}

/** A cancellable, finite RAF subscription, independently testable without a renderer. */
export function runBoardFrames(motion: BoardMotion, reduced: boolean, onFrame: (elapsedMs: number) => void,
  clock: BoardFrameClock = {
    now: () => performance.now(), request: callback => requestAnimationFrame(callback),
    cancel: handle => cancelAnimationFrame(handle),
  }): () => void {
  const duration = sceneTiming(motion.events, reduced).duration
  let cancelled = false
  let handle: number | null = null
  const tick = () => {
    if (cancelled) return
    const elapsed = Math.max(0, Math.min(duration, clock.now() - motion.startedAt))
    onFrame(elapsed)
    if (elapsed < duration) handle = clock.request(tick)
    else handle = null
  }
  tick()
  return () => { cancelled = true; if (handle !== null) clock.cancel(handle) }
}

function spriteStyle(sprite: BoardSprite): CSSProperties {
  return { left: `${sprite.left}%`, top: `${sprite.top}%`, opacity: sprite.opacity,
    transform: `translate(-50%, -50%) translateY(${-sprite.lift * 35}%) scale(${sprite.scale * (1 + sprite.lift * .08)})`,
    zIndex: 2 + Math.round(Math.max(0, sprite.lift) * 100) }
}

export function Board2D({ state, selected, targets, focusSquares, onSquare, flipped, language,
  accessibleOnly = false, motion = null, reduced = false }: Board2DProps) {
  const [frame, setFrame] = useState<{ id: number; elapsed: number } | null>(null)
  useEffect(() => {
    if (!motion) return
    return runBoardFrames(motion, reduced, elapsed => setFrame({ id: motion.id, elapsed }))
  }, [motion, reduced])
  const elapsed = motion ? frame?.id === motion.id ? frame.elapsed : Math.max(0, performance.now() - motion.startedAt) : 0
  const timing = motion ? sceneTiming(motion.events, reduced) : null
  const animating = !!motion && !!timing && elapsed < timing.duration
  const castling = animating && !reduced && !!motion?.events.some(event => event.type === 'move' &&
    event.pieceType === 'king' && Math.abs(event.to.charCodeAt(0) - event.from.charCodeAt(0)) === 2)
  const sprites = animating ? boardSpritesAt(motion!, elapsed, flipped, reduced) : []
  const visibleForms = motion && timing ? (elapsed >= timing.contact ? motion.after.forms : motion.before.forms) : state.forms
  const captured = motion?.events.find(event => event.type === 'capture')
  const ability = motion?.events.find(event => event.type === 'ability')
  const promotion = motion?.events.find(event => event.type === 'promotion')
  const impactSquare = captured?.victim.square ?? ability?.to ?? promotion?.square
  const impactPoint = impactSquare ? squarePoint(impactSquare) : null
  const impact = impactPoint ? boardPercent(impactPoint.x, impactPoint.z, flipped) : null
  const impactProgress = timing ? Math.max(0, Math.min(1, (elapsed - timing.contact) / Math.max(1, timing.effectEnd - timing.contact))) : 1
  const checkedSquare = isInCheck(state, state.side) ? state.pieces.find(piece => piece.side === state.side && piece.type === 'king')?.square : undefined
  const cells = Array.from({ length: 64 }, (_, i) => {
    const x = flipped ? 7 - i % 8 : i % 8, y = flipped ? Math.floor(i / 8) : 7 - Math.floor(i / 8)
    return { square: String.fromCharCode(97 + x) + (y + 1), x, y }
  })
  return <div className={accessibleOnly ? 'od-board-accessible' : 'od-board-2d'} data-animating={animating} data-castling={castling}
    role="grid" aria-label={tr(language, 'Шахматная доска', 'Chessboard')}>
    {cells.map(({ square, x, y }, i) => {
      const piece = state.pieces.find(p => p.square === square), chosen = piece?.id === selected
      const target = targets.includes(square), focus = focusSquares.includes(square)
      return <button key={square} type="button" role="gridcell" data-square={square} data-selected={chosen}
        data-target={target} data-focus={focus} data-check={square === checkedSquare} className={`od-cell ${(x + y) % 2 ? 'light' : 'dark'}`}
        aria-label={`${square}${piece ? `, ${sideName(piece.side, language)}, ${pieceName(piece.type, language)}` : ''}${target ? tr(language, ', доступный ход', ', available move') : ''}`}
        aria-selected={chosen} onClick={() => onSquare(square)} onKeyDown={event => {
          const direction = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 } as Record<string, number>)[event.key]
          if (direction !== undefined) {
            event.preventDefault()
            const next = Math.max(0, Math.min(63, i + direction))
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
          }
        }}>
        {i % 8 === 0 && <span className="od-rank">{y + 1}</span>}{i >= 56 && <span className="od-file">{String.fromCharCode(97 + x)}</span>}
        {piece && <PieceIcon type={piece.type} side={piece.side} size={60} />}
        {piece && state.forms[piece.side]?.pieceId === piece.id && <span className="od-form-counter">{state.forms[piece.side]?.remainingTurns}</span>}
        {target && <span className="od-target" />}
      </button>
    })}
    {animating && <div className="od-motion-layer" aria-hidden="true">
      {sprites.map(sprite => <span key={sprite.id} className="od-motion-piece" data-piece-id={sprite.id}
        data-presentation-type={sprite.type} style={spriteStyle(sprite)}>
        <PieceIcon type={sprite.type} side={sprite.side} size={60} />
        {visibleForms[sprite.side]?.pieceId === sprite.id && <span className="od-motion-form-counter">{visibleForms[sprite.side]?.remainingTurns}</span>}
      </span>)}
      {impact && timing && elapsed >= timing.contact && elapsed < timing.effectEnd && <span className="od-motion-impact"
        style={{ left: `${impact.left}%`, top: `${impact.top}%`, opacity: .65 * (1 - impactProgress),
          transform: `translate(-50%, -50%) scale(${reduced ? 1 : .65 + impactProgress * 1.4})` }} />}
    </div>}
  </div>
}
