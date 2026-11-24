import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { fileOf, rankOf } from '../core'
import type { Piece } from '../core'
import { clampUnit, easeRange, mateGroundContact, royalTiming, sampleMateFall, sampleRoyal } from '../scene/royalMotion'
import type { RoyalCue } from '../scene/royalMotion'

const flakes = Array.from({ length: 13 }, (_, i) => ({
  angle: i * 2.399963,
  speed: .95 + ((i * 7) % 9) * .171,
  lag: ((i * 3) % 9) / 90,
  size: .020 + ((i * 5) % 8) * .0064,
  life: .51 + ((i * 7) % 8) * .080,
}))

/** The flat view projects a small, deterministic scatter on the mated board. */
export function FlatMateDebris({ piece, pieces, flipped, reduced, cue }: {
  piece: Piece; pieces: readonly Piece[]; flipped: boolean; reduced: boolean; cue?: RoyalCue
}) {
  const scatter = useRef<SVGGElement>(null)
  const layout = useMemo(() => {
    const file = fileOf(piece.square) + .5
    const rank = 7.5 - rankOf(piece.square)
    const x = file + (file < 4 ? .29 : -.29)
    const inward = Math.atan2(4 - rank, 4 - x)
    const neighbors = pieces.filter(other => other.id !== piece.id)
      .map(other => [fileOf(other.square) + .5, 7.5 - rankOf(other.square)] as const)
    return flakes.slice(0, 11).map((flake, index) => {
      const angle = inward + (index - 5) * .24
      const distance = .65 + index % 4 * .32
      const endX = Math.max(.14, Math.min(7.86, x + Math.cos(angle) * distance))
      const endY = Math.max(.14, Math.min(7.86, rank + Math.sin(angle) * distance))
      const dx = endX - x
      const dy = endY - rank
      const collision = neighbors.find(([cx, cy]) => {
        const projection = clampUnit(((cx - x) * dx + (cy - rank) * dy) / Math.max(.001, dx * dx + dy * dy))
        return Math.hypot(x + dx * projection - cx, rank + dy * projection - cy) < .34
      })
      const travel = collision ? .36 : 1
      return { x, y: rank, dx: dx * travel, dy: dy * travel, size: flake.size * 1.68, angle: index * 41 }
    })
  }, [piece.id, piece.square, pieces])
  useLayoutEffect(() => {
    let frame = 0
    const still = reduced || cue?.reduced
    function draw() {
      const elapsed = cue ? performance.now() - cue.startedAt - mateGroundContact(cue) : Infinity
      const visible = elapsed >= 0
      const settled = visible && (still || elapsed >= 1080)
      if (scatter.current) scatter.current.style.visibility = visible ? 'visible' : 'hidden'
      scatter.current?.setAttribute('data-settled', String(settled))
      if (visible) {
        const progress = still ? 1 : clampUnit(elapsed / 1080)
        const travel = 1 - (1 - progress) ** 3
        const lift = .19 * Math.abs(Math.sin(progress * 3 * Math.PI)) * (1 - progress) ** 2.6
        for (const [index, chip] of layout.entries()) {
          const x = chip.x + chip.dx * travel
          const y = chip.y + chip.dy * travel
          const screenX = flipped ? 8 - x : x
          const screenY = Math.max(.09, Math.min(7.91, (flipped ? 8 - y : y) - lift))
          scatter.current?.children.item(index)?.setAttribute('transform',
            `translate(${screenX} ${screenY}) rotate(${chip.angle + travel * 185}) scale(${chip.size})`)
        }
      }
      if (elapsed < (still ? 0 : 1080)) frame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [cue, flipped, layout, reduced])
  return <svg className="flat-royal" viewBox="0 0 8 8" aria-hidden="true" data-testid="flat-mate-debris">
    <g ref={scatter} style={{ visibility: 'hidden' }}>{layout.map((_, index) => <path key={index}
      d={index % 2 ? 'M-1 -.6 L.45 -1.14 1.15 .27 .03 .85Z' : 'M-.85 -1.15 L.92 -.33 .56 .95 -.74 .49Z'}
      fill={piece.side === 'white' ? '#bda897' : '#4e4c54'} stroke="#342d2c" strokeWidth=".11" />)}</g>
  </svg>
}

/** Board-local coordinates follow the same square through any orientation or resize. */
export function FlatRoyal({ cue, flipped, board }: {
  cue: RoyalCue; flipped: boolean; board: RefObject<HTMLDivElement | null>
}) {
  const glow = useId()
  const wave = useRef<SVGCircleElement>(null)
  const wake = useRef<SVGCircleElement>(null)
  const contact = useRef<SVGCircleElement>(null)
  const fragments = useRef<SVGGElement>(null)
  const reflections = useRef<SVGGElement>(null)
  const file = fileOf(cue.square)
  const rank = rankOf(cue.square)
  const x = (flipped ? 7 - file : file) + .5
  const y = (flipped ? rank : 7 - rank) + .5
  const mate = cue.kind === 'mate'
  const count = cue.reduced || mate ? 0 : 13
  const tiles = useMemo(() => Array.from({ length: 64 }, (_, i) => ({ left: i % 8, top: i >> 3 }))
    .filter(tile => Math.hypot(tile.left + .5 - x, tile.top + .5 - y) <= 2.9), [x, y])

  useLayoutEffect(() => {
    const host = board.current
    if (!host) return
    let frame: number
    function draw() {
      if (!host) return
      const elapsed = performance.now() - cue.startedAt
      const sample = sampleRoyal(cue, elapsed)
      host.style.setProperty('--crown-pressure', (sample.surface * .87).toFixed(4))
      host.style.setProperty('--crown-sweep', sample.sweep.toFixed(4))
      host.style.setProperty('--crown-dusk', (sample.dusk * .34).toFixed(4))
      host.style.setProperty('--crown-stress', (mate ? sample.camera * .25 + sample.recoil * .07 : sample.camera * .10).toFixed(4))
      if (mate) host.style.setProperty('--crown-fall', sampleMateFall(cue, elapsed).toFixed(4))
      host.style.setProperty('--crown-release', sample.discharge.toFixed(4))
      const radius = .22 + sample.wave * (mate ? 4.65 : 2.55)
      contact.current?.setAttribute('opacity', String(sample.contact * (mate ? .71 : .53)))
      wave.current?.setAttribute('r', String(radius))
      wave.current?.setAttribute('opacity', String(sample.waveStrength * (mate ? .95 : .62)))
      wake.current?.setAttribute('r', String(Math.max(.04, radius - .12)))
      wake.current?.setAttribute('opacity', String(sample.waveStrength * .48))
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i]
        const distance = Math.hypot(tile.left + .5 - x, tile.top + .5 - y)
        const step = (1 - easeRange(.14, 1.03, Math.abs(distance - radius))) * sample.waveStrength
        const storedLight = Math.exp(-distance * 1.16) * sample.contact
        reflections.current?.children.item(i)?.setAttribute('opacity', String(.57 * step + .62 * storedLight))
      }
      for (let i = 0; i < count; i++) {
        const child = fragments.current?.children.item(i)
        if (!child) continue
        const flake = flakes[i]
        const t = Math.max(0, sample.flight - flake.lag)
        const direction = flake.angle + (flipped ? Math.PI : 0)
        const life = flake.life * .67
        const distance = .19 + flake.speed * t * .69
        const lift = Math.sin(Math.min(1, t / life) * Math.PI) * .23
        const alpha = easeRange(0, .055, sample.flight - flake.lag) * (1 - easeRange(life * .57, life, t))
        const size = flake.size * .90
        child.setAttribute('opacity', String(alpha))
        child.setAttribute('transform', `translate(${x + Math.cos(direction) * distance} ${y + Math.sin(direction) * distance - lift}) rotate(${i * 35 + t * 430}) scale(${size})`)
      }
      if (elapsed < royalTiming(cue).duration) frame = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      for (const name of ['--crown-pressure', '--crown-sweep', '--crown-dusk', '--crown-stress', '--crown-release', '--crown-fall']) host.style.removeProperty(name)
    }
  }, [board, cue, count, flipped, mate, tiles, x, y])

  return <svg className="flat-royal" viewBox="0 0 8 8" aria-hidden="true" data-testid="flat-royal">
    <defs>
      <radialGradient id={glow}>
        <stop offset="0%" stopColor="#ffbe81" stopOpacity=".35" />
        <stop offset="42%" stopColor="#bd4c3a" stopOpacity=".71" />
        <stop offset="82%" stopColor="#b52c33" stopOpacity=".18" />
        <stop offset="100%" stopColor="#a5202d" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle ref={contact} cx={x} cy={y} r={mate ? 2.35 : 1.26} fill={`url(#${glow})`} opacity="0" />
    <g ref={reflections}>{tiles.map(({ left, top }, i) => <path key={`${left}/${top}`}
      d={`M${left + .05} ${top + .06}h.89v.89H${left + .76}L${left + .36} ${top + .57}H${left + .05}Z`}
      fill={i % 3 ? '#e8a065' : '#c38f88'} opacity="0" />)}</g>
    {mate && <circle ref={wake} cx={x} cy={y} r=".1" fill="none" stroke="#ac473b" strokeWidth=".17" opacity="0" />}
    <circle ref={wave} cx={x} cy={y} r=".22" fill="none" stroke="#ffd49a" strokeWidth={mate ? '.079' : '.054'}
      strokeDasharray={mate ? '1.18 .10 .21 .075' : undefined} opacity="0" />
    <g ref={fragments}>{flakes.slice(0, count).map((_, i) =>
      <g key={i} opacity="0">
        <path d={i % 3 ? 'M0 -1.9 1.06 .38 .27 1.1 -.84 .6Z' : 'M-.9 -.64 .34 -1.2 1.21 .24 .04 1.31Z'}
          fill={['#f7d5a1', '#aa4a3b', '#f4a36d', '#bbc9d8'][i % 4]} stroke="#65353c" strokeWidth=".16" />
      </g>)}</g>
  </svg>
}
