import type { CSSProperties } from 'react'
import './scene.css'

const faces = [
  { pips: [5], turn: 'translateZ(var(--die-half))', reveal: 'rotateY(0deg)' },
  { pips: [1, 9], turn: 'rotateX(90deg) translateZ(var(--die-half))', reveal: 'rotateX(-90deg)' },
  { pips: [1, 5, 9], turn: 'rotateY(90deg) translateZ(var(--die-half))', reveal: 'rotateY(-90deg)' },
  { pips: [1, 3, 7, 9], turn: 'rotateY(-90deg) translateZ(var(--die-half))', reveal: 'rotateY(90deg)' },
  { pips: [1, 3, 5, 7, 9], turn: 'rotateX(-90deg) translateZ(var(--die-half))', reveal: 'rotateX(90deg)' },
  { pips: [1, 3, 4, 6, 7, 9], turn: 'rotateY(180deg) translateZ(var(--die-half))', reveal: 'rotateY(180deg)' },
] as const

export function ReactionDie({ face, rollKey, reducedMotion = false, label }: {
  face: number
  rollKey: string
  reducedMotion?: boolean
  label?: string
}) {
  const focus = faces[face - 1]
  if (!focus) return null
  return (
    <div className="remorse-die" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <div className="remorse-die__shadow" />
      <div
        key={rollKey} className={reducedMotion ? 'remorse-die__cube' : 'remorse-die__cube remorse-die__cube--roll'}
        style={{ '--die-reveal': focus.reveal } as CSSProperties}
      >
        {faces.map(({ pips, turn }, i) => (
          <div key={i} className="remorse-die__face" style={{ transform: turn }}>
            {pips.map(pip => <i key={pip} style={{ gridColumn: (pip - 1) % 3 + 1, gridRow: Math.ceil(pip / 3) }} />)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default ReactionDie
