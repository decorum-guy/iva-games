import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending, CanvasTexture, Color, CurvePath, LineCurve3, MeshBasicMaterial, Object3D, TubeGeometry, Vector3,
} from 'three'
import type { Group, InstancedMesh, Sprite, SpriteMaterial } from 'three'
import { easeRange } from './royalMotion'
import { promotionFamily, promotionTiming, samplePromotion, sceneRandom } from './promotionMotion'
import { boltReach, queenLightning } from './queenLightning'
import type { FloorPoint, PromotionCue } from './promotionMotion'
import { squarePoint } from './types'

const arcSides = 5

function taperedChannel(path: CurvePath<Vector3>, steps: number, radius: number) {
  const tube = new TubeGeometry(path, steps, radius, arcSides, false)
  const vertices = tube.getAttribute('position')
  const vertex = new Vector3()
  for (let ring = 0; ring <= steps; ring++) {
    const fraction = ring / steps
    const point = path.getPointAt(fraction)
    const width = 1 - .67 * fraction ** 1.26
    for (let side = 0; side <= arcSides; side++) {
      const index = ring * (arcSides + 1) + side
      vertex.fromBufferAttribute(vertices, index).lerp(point, 1 - width)
      vertices.setXYZ(index, vertex.x, vertex.y, vertex.z)
    }
  }
  tube.setDrawRange(0, 0)
  return tube
}

function ElectricalArcs({ origin, cue, low }: { origin: FloorPoint; cue: PromotionCue; low: boolean }) {
  const arcs = useMemo(() => queenLightning(origin, cue.id, low).map(bolt => {
    const path = new CurvePath<Vector3>()
    const points = bolt.points.map(point => new Vector3(...point))
    for (let index = 1; index < points.length; index++) path.add(new LineCurve3(points[index - 1], points[index]))
    const steps = (points.length - 1) * 4
    const core = taperedChannel(path, steps, bolt.leader ? .024 : .013)
    const glow = taperedChannel(path, steps, bolt.leader ? .057 : .031)
    return { bolt, steps, core, glow }
  }), [origin, cue.id, low])
  const [beam, haze] = useMemo(() => [
    new MeshBasicMaterial({ color: '#fff5ea', toneMapped: false, transparent: true, opacity: 0, depthWrite: false }),
    new MeshBasicMaterial({ color: '#8ca7f3', blending: AdditiveBlending, toneMapped: false,
      transparent: true, opacity: 0, depthWrite: false }),
  ], [])
  const group = useRef<Group>(null)
  useEffect(() => () => arcs.forEach(({ core, glow }) => { core.dispose(); glow.dispose() }), [arcs])
  useEffect(() => () => { beam.dispose(); haze.dispose() }, [beam, haze])
  useFrame(() => {
    const elapsed = performance.now() - cue.startedAt
    const after = elapsed - promotionTiming('queen', cue.reduced).impact
    const { arc } = samplePromotion(cue, elapsed)
    if (group.current) group.current.visible = arc > .003
    beam.opacity = arc * .94
    haze.opacity = arc * .30
    if (arc <= .003) return
    for (const { bolt, steps, core, glow } of arcs) {
      const count = Math.floor(steps * boltReach(bolt, after)) * arcSides * 6
      core.setDrawRange(0, count)
      glow.setDrawRange(0, count)
    }
  })
  return <group ref={group} visible={false} name="queen-lightning">
    {arcs.map(({ core, glow }, index) => <group key={index}>
      <mesh geometry={glow} material={haze} renderOrder={3} dispose={null} />
      <mesh geometry={core} material={beam} renderOrder={4} dispose={null} />
    </group>)}
  </group>
}

const colors = ['#a56a50', '#5c4952', '#e3a878', '#b49a83', '#7594aa', '#ebd5ac']

let powderMap: CanvasTexture | undefined

function getPowderMap() {
  if (powderMap) return powderMap
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 96
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(48, 48, 3, 48, 48, 48)
  gradient.addColorStop(0, 'rgba(255,255,255,.76)')
  gradient.addColorStop(.36, 'rgba(255,255,255,.41)')
  gradient.addColorStop(.72, 'rgba(255,255,255,.14)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 96, 96)
  powderMap = new CanvasTexture(canvas)
  return powderMap
}

export function PromotionEffects({ cue, low, reduced }: { cue: PromotionCue; low: boolean; reduced: boolean }) {
  const origin = useMemo(() => squarePoint(cue.square), [cue.square])
  const [x, z] = origin
  const family = promotionFamily(cue.kind)
  const queen = family === 'queen'
  const formation = family === 'formation'
  const limitMotion = cue.reduced || reduced
  const count = limitMotion ? 0 : queen ? low ? 22 : 38 : formation ? 11 : low ? 15 : 24
  const debris = useRef<InstancedMesh>(null)
  const dust = useRef<(Sprite | null)[]>([])
  const scratch = useMemo(() => new Object3D(), [])
  const invalidate = useThree(state => state.invalidate)
  const chips = useMemo(() => {
    const random = sceneRandom(cue.id + '/chips')
    return Array.from({ length: count }, (_, index) => ({
      angle: index * 2.399963, thrust: .48 + random() * 2.17, lift: .38 + random() * 1.64,
      scale: .028 + random() * (queen || formation ? .062 : .035), lag: random() * .15,
      color: new Color(colors[index % colors.length]),
    }))
  }, [count, cue.id, queen])
  useLayoutEffect(() => {
    const mesh = debris.current
    if (mesh) {
      scratch.scale.setScalar(0)
      scratch.updateMatrix()
      chips.forEach((chip, index) => {
        mesh.setMatrixAt(index, scratch.matrix)
        mesh.setColorAt(index, chip.color)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
    invalidate()
  }, [chips, invalidate, scratch])

  useFrame(() => {
    const elapsed = performance.now() - cue.startedAt
    const sample = samplePromotion(cue, elapsed, limitMotion)
    const spread = easeRange(0, .56, sample.flight)
    const dustAlpha = easeRange(-.025, .095, sample.flight) * (1 - easeRange(.14, .62, sample.flight))
    for (const [index, cloud] of dust.current.entries()) {
      if (!cloud) continue
      const angle = index * 2.39 + .71
      const distance = .23 + spread * (queen ? .98 : .57)
      cloud.position.set(x + Math.cos(angle) * distance, .12 + .24 * spread, z + Math.sin(angle) * distance)
      cloud.scale.set(.4 + spread * (queen ? 1.32 : .84), .29 + .32 * spread, 1)
      ;(cloud.material as SpriteMaterial).opacity = dustAlpha * (queen ? .18 : .16)
    }
    const mesh = debris.current
    if (mesh) {
      for (const [index, chip] of chips.entries()) {
        const t = sample.flight - chip.lag
        const gather = easeRange(.12, .92, sample.charge - chip.lag * .56)
        const arc = formation ? (.34 + chip.lift * .52) * gather : chip.lift * t - 2.95 * t * t
        const range = formation ? .24 + (.52 + chip.thrust * .24) * (1 - gather) : .43 + Math.max(0, t) * chip.thrust
        const wake = formation ? easeRange(0, .27, gather) * (1 - easeRange(.64, .99, gather))
          : (1 - easeRange(.18, .70, t)) * easeRange(0, .042, t)
        const angle = chip.angle + (formation ? gather * 1.36 : 0)
        const px = x + Math.cos(angle) * range
        const pz = z + Math.sin(angle) * range
        const size = Math.abs(px) < 4.05 && Math.abs(pz) < 4.05 ? chip.scale * wake : 0
        scratch.position.set(px, .035 + Math.max(0, arc), pz)
        scratch.rotation.set(index * .9 + t * 3.8, t * 4.5 + index, t * -5.9)
        scratch.scale.set(size, size * (.67 + index % 3 * .28), size * 1.29)
        scratch.updateMatrix()
        mesh.setMatrixAt(index, scratch.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    if (!document.hidden) invalidate()
  })

  return <>
    {queen && !limitMotion && <ElectricalArcs origin={origin} cue={cue} low={low} />}
    {!limitMotion && !formation && Array.from({ length: low ? 2 : 3 }, (_, index) => <sprite key={index}
      ref={node => { dust.current[index] = node }} renderOrder={2}>
      <spriteMaterial map={getPowderMap()} color="#bb947c" transparent opacity={0} depthWrite={false} toneMapped={false} />
    </sprite>)}
    {count > 0 && <instancedMesh key={count} ref={debris} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={.74} metalness={.11} emissive="#432013" emissiveIntensity={.21} />
    </instancedMesh>}
  </>
}
