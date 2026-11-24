import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { clampUnit, easeRange } from '../scene/royalMotion'
import { fractureLayout } from '../scene/fractureLayout'
import { fractureBanks, promotionFamily, promotionTiming, samplePromotion, sceneRandom } from '../scene/promotionMotion'
import type { FloorPoint, PromotionCue } from '../scene/promotionMotion'
import { squarePoint } from '../scene/types'

const point = ([x, z]: FloorPoint) => `${x.toFixed(3)} ${z.toFixed(3)}`
const outline = (points: readonly FloorPoint[]) => 'M' + points.map(point).join('L')
const styling = ['--forge-lift', '--forge-grow', '--forge-light', '--forge-recoil', '--forge-air']

export function FlatPromotion({ cue, board, flipped, reduced }: {
  cue: PromotionCue; board: RefObject<HTMLDivElement | null>; flipped: boolean; reduced: boolean
}) {
  const key = useId()
  const wave = useRef<SVGCircleElement>(null)
  const trailing = useRef<SVGCircleElement>(null)
  const touch = useRef<SVGCircleElement>(null)
  const mask = useRef<(SVGPathElement | null)[]>([])
  const forkGroup = useRef<SVGGElement>(null)
  const arcGroup = useRef<SVGGElement>(null)
  const chipGroup = useRef<SVGGElement>(null)
  const origin = useMemo(() => squarePoint(cue.square), [cue.square])
  const [x, z] = origin
  const family = promotionFamily(cue.kind)
  const queen = family === 'queen'
  const casting = family === 'formation'
  const limitMotion = reduced || cue.reduced
  const cracks = useMemo(() => queen ? fractureLayout(origin, cue.id).seams.map(path => {
    const banks = fractureBanks(path)
    return {
      path: outline(path.map(entry => entry.position)), start: path[0].at, end: Math.min(.98, path.at(-1)!.at),
      slabs: [0, 1, 2].map(index => outline(banks.map(row => row[index]).concat(banks.map(row => row[index + 1]).reverse())) + 'Z'),
    }
  }) : [], [origin, cue.id, queen])
  const decoration = useMemo(() => {
    const random = sceneRandom(cue.id + '/flat')
    const arcs = Array.from({ length: 5 }, (_, i) => {
      const dx = (i % 2 === 0 ? -1 : 1) * (.55 + random() * 1.2)
      const dz = (z < 0 ? 1 : -1) * (.6 + random() * 1.7)
      const inside = (n: number) => Math.max(-3.99, Math.min(3.99, n))
      return outline(Array.from({ length: 9 }, (_, j): FloorPoint => {
        const t = j / 8
        const jitter = j === 0 || j === 8 ? 0 : (random() - .5) * .25
        return [inside(x + dx * t + jitter), inside(z + dz * t + jitter * .66)]
      }))
    })
    const chips = Array.from({ length: casting ? 9 : queen ? 27 : 16 }, (_, i) => ({
      angle: i * 2.399963, speed: .68 + random() * 1.64, lag: random() * .15, lift: .30 + random() * .70,
      size: .026 + random() * (queen ? .056 : .032),
    }))
    return { arcs, chips }
  }, [casting, cue.id, queen, x, z])

  useLayoutEffect(() => {
    const host = board.current
    if (!host) return
    let frame = 0
    const direction = (flipped ? -1 : 1) * (z < 0 ? 1 : -1)
    function draw() {
      if (!host) return
      const elapsed = performance.now() - cue.startedAt
      const pulse = samplePromotion(cue, elapsed, limitMotion)
      host.style.setProperty('--forge-lift', (pulse.height * .55 * direction).toFixed(4))
      host.style.setProperty('--forge-grow', pulse.reveal.toFixed(4))
      host.style.setProperty('--forge-light', (pulse.contact * .62 + pulse.arc * .66).toFixed(4))
      host.style.setProperty('--forge-recoil', pulse.recoil.toFixed(4))
      host.style.setProperty('--forge-air', pulse.airLight.toFixed(4))
      const radius = .24 + pulse.wave * (queen ? 5.1 : casting ? 1.28 : 3.6)
      touch.current?.setAttribute('opacity', String(.69 * pulse.contact))
      wave.current?.setAttribute('r', String(radius))
      wave.current?.setAttribute('opacity', String(pulse.waveLight * (casting ? .46 : queen ? .71 : .87)))
      trailing.current?.setAttribute('r', String(Math.max(.04, radius - .135)))
      trailing.current?.setAttribute('opacity', String(pulse.waveLight * .43))
      forkGroup.current?.setAttribute('opacity', String(pulse.crackAlpha))
      arcGroup.current?.setAttribute('opacity', String(pulse.arc * .92))
      cracks.forEach(({ start, end }, index) => {
        const reach = clampUnit((pulse.crackReach - start) / Math.max(.04, end - start))
        mask.current[index]?.setAttribute('stroke-dasharray', `${reach.toFixed(4)} 1.2`)
      })
      if (!limitMotion) decoration.chips.forEach((chip, i) => {
        const node = chipGroup.current?.children.item(i)
        const t = Math.max(0, pulse.flight - chip.lag)
        const angle = chip.angle
        const gather = easeRange(.12, .92, pulse.charge - chip.lag * .56)
        const radius = casting ? .21 + (.72 + chip.speed * .10) * (1 - gather) : .27 + chip.speed * t
        const air = casting ? chip.lift * gather * .41 : Math.max(0, chip.lift * t * 2 - 3.4 * t * t)
        const opacity = casting ? easeRange(0, .26, gather) * (1 - easeRange(.61, .99, gather))
          : easeRange(0, .04, pulse.flight - chip.lag) * (1 - easeRange(.22, .62, t))
        node?.setAttribute('opacity', String(opacity))
        node?.setAttribute('transform', `translate(${x + Math.cos(angle) * radius} ${z + Math.sin(angle) * radius - air}) rotate(${i * 21 + t * 430}) scale(${chip.size})`)
      })
      if (elapsed < promotionTiming(cue.kind, cue.reduced).duration) frame = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      for (const property of styling) host.style.removeProperty(property)
    }
  }, [board, casting, cracks, cue, decoration, flipped, limitMotion, queen, x, z])

  return <svg className="flat-promotion" viewBox="-4 -4 8 8" aria-hidden="true" data-testid="flat-promotion">
    <defs>
      <radialGradient id={key + 'heat'}>
        <stop offset="0" stopColor="#ffedc5" stopOpacity=".60" />
        <stop offset=".50" stopColor="#cc743b" stopOpacity=".64" />
        <stop offset="1" stopColor="#733f34" stopOpacity="0" />
      </radialGradient>
      {cracks.map((crack, index) => <mask key={index} id={key + 'f' + index}
        x="-4" y="-4" width="8" height="8" maskUnits="userSpaceOnUse">
        <path ref={node => { mask.current[index] = node }} d={crack.path} pathLength="1" fill="none"
          stroke="white" strokeWidth=".36" strokeDasharray="0 1.2" />
      </mask>)}
    </defs>
    <g transform={flipped ? 'rotate(180)' : undefined}>
      <circle ref={touch} cx={x} cy={z} r={queen ? 2.23 : casting ? .83 : 1.5} fill={`url(#${key}heat)`} opacity="0" />
      <circle ref={trailing} cx={x} cy={z} r=".2" fill="none" stroke="#bb6c43" strokeWidth=".14" opacity="0" />
      <circle ref={wave} cx={x} cy={z} r=".24" fill="none" stroke="#ffcf91" strokeWidth={queen ? '.075' : '.060'}
        strokeDasharray={queen ? '1.2 .10 .71 .18' : undefined} opacity="0" />
      <g ref={forkGroup} opacity="0">{cracks.map((crack, index) => <g key={index} mask={`url(#${key}f${index})`}>
        <path d={crack.slabs[0]} fill="#d19262" stroke="#723d2d" strokeWidth=".013" />
        <path d={crack.slabs[1]} fill="#221317" stroke="#4a241c" strokeWidth=".016" />
        <path d={crack.slabs[2]} fill="#704635" stroke="#995b3c" strokeWidth=".009" />
      </g>)}</g>
      {queen && !limitMotion && <g ref={arcGroup} opacity="0">{decoration.arcs.map((arc, i) =>
        <g key={arc}><path d={arc} fill="none" stroke="#96b4e5" strokeWidth=".068" opacity=".43" />
          <path d={arc} fill="none" stroke="#fff4e3" strokeWidth={i < 2 ? '.034' : '.021'} /></g>)}</g>}
      {!limitMotion && <g ref={chipGroup}>{decoration.chips.map((_, i) => <path key={i} opacity="0"
        d={i % 3 ? 'M0 -1.28 1.15 -.24 .47 1.1 -1 .61Z' : 'M-.99 -.4 .34 -1.2 1.23 .81 -.05 1.1Z'}
        fill={['#edbb88', '#a46646', '#d0b9a5', '#605060'][i % 4]} stroke="#56332e" strokeWidth=".18" />)}</g>}
    </g>
  </svg>
}
