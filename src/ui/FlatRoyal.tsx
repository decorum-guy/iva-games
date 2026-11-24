import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { fileOf, rankOf } from '../core'
import { easeRange, royalTiming, sampleMateFall, sampleRoyal } from '../scene/royalMotion'
import type { RoyalCue } from '../scene/royalMotion'

const flakes = Array.from({ length: 34 }, (_, i) => ({
  angle: i * 2.399963,
  speed: .95 + ((i * 7) % 9) * .171,
  lag: ((i * 3) % 9) / 90,
  size: .020 + ((i * 5) % 8) * .0064,
  life: .51 + ((i * 7) % 8) * .080,
}))

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
  const count = cue.reduced ? 0 : mate ? flakes.length : 13
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
        const life = flake.life * (mate ? 1.38 : .67)
        const distance = .19 + flake.speed * t * (mate ? 1.25 : .69)
        const lift = Math.sin(Math.min(1, t / life) * Math.PI) * (mate ? .61 : .23)
        const alpha = easeRange(0, .055, sample.flight - flake.lag) * (1 - easeRange(life * .57, life, t))
        const size = flake.size * (mate ? (i % 4 === 0 ? 2.75 : 1.83) : .90)
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
        {mate && <path d="M0 -1.08.65 .38 .16 .71Z" fill={i % 3 ? '#f6d4a5' : '#6e3e45'} opacity=".76" />}
      </g>)}</g>
  </svg>
}
