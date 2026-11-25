import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CanvasTexture, Color, InstancedMesh, MeshBasicMaterial, Object3D, PointLight,
} from 'three'
import { easeRange, sampleRoyal } from './royalMotion'
import type { RoyalCue } from './royalMotion'
import { samplePromotion } from './promotionMotion'
import type { PromotionCue } from './promotionMotion'
import { squarePoint } from './types'

const sparkCount = 48
const dustCount = 17
const sparkColors = ['#ffd08f', '#f09352', '#c95443', '#ffe0a8']

function unit(index: number, salt: number) {
  const value = Math.sin(index * 44.67 + salt * 28.39 + .46) * 43758.5453
  return value - Math.floor(value)
}

const sparks = Array.from({ length: sparkCount }, (_, i) => ({
  angle: i * 2.399963 + unit(i, 1) * .35,
  height: unit(i, 2),
  distance: .14 + .25 * unit(i, 3),
  speed: 1.34 + 1.79 * unit(i, 4),
  lift: .70 + 1.73 * unit(i, 5),
  size: .013 + unit(i, 6) ** .75 * .018,
  spin: (unit(i, 7) - .5) * 11,
  life: .38 + .64 * unit(i, 8),
  lag: unit(i, 9) * .095,
}))

let mist: CanvasTexture | undefined
function dustTexture() {
  if (mist) return mist
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 48
  const context = canvas.getContext('2d')!
  const haze = context.createRadialGradient(24, 24, 1, 24, 24, 24)
  haze.addColorStop(0, '#fff')
  haze.addColorStop(.35, 'rgba(255,255,255,.38)')
  haze.addColorStop(.76, 'rgba(255,255,255,.085)')
  haze.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = haze
  context.fillRect(0, 0, 48, 48)
  mist = new CanvasTexture(canvas)
  return mist
}

export function RoyalEffects({ cue, promotion, low, reduced }: {
  cue?: RoyalCue; promotion?: PromotionCue; low: boolean; reduced: boolean
}) {
  const warm = useRef<PointLight>(null)
  const rim = useRef<PointLight>(null)
  const flecks = useRef<InstancedMesh>(null)
  const powder = useRef<InstancedMesh>(null)
  const object = useMemo(() => new Object3D(), [])
  const dust = useMemo(dustTexture, [])
  const invalidate = useThree(state => state.invalidate)
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)

  useLayoutEffect(() => {
    const mesh = flecks.current
    if (mesh) {
      for (let i = 0; i < sparkCount; i++) mesh.setColorAt(i, new Color(sparkColors[i % sparkColors.length]))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    // Three compiles mesh materials regardless of visibility. Warm the
    // fragment pools against the same light rig they will use in the shot.
    void gl.compileAsync(scene, camera).catch(() => undefined)
    invalidate()
  }, [camera, gl, invalidate, scene])
  useLayoutEffect(() => { invalidate() }, [cue?.id, invalidate])

  useFrame(({ camera }) => {
    const light = warm.current, edge = rim.current
    const embers = flecks.current, dustMesh = powder.current
    if (!light || !edge || !embers || !dustMesh) return
    const elapsed = cue ? performance.now() - cue.startedAt : 0
    const pulse = cue ? sampleRoyal(cue, elapsed) : null
    const mate = cue?.kind === 'mate'
    const subject = cue ?? promotion
    const [x, z] = subject ? squarePoint(subject.square) : [0, 0]
    // Keep the number of scene lights constant. Adding one at impact would
    // invalidate every lit material program, including the marble and figures.
    if (promotion && !cue) {
      const birth = samplePromotion(promotion, performance.now() - promotion.startedAt, promotion.reduced || reduced)
      const queen = birth.family === 'queen'
      light.color.set(queen ? '#ffc087' : '#e9d9af')
      light.intensity = birth.lampLight * (queen ? 11.8 : birth.family === 'formation' ? 3.2 : 8.1)
      light.distance = queen ? 4.8 : 3
      light.position.set(x, .67, z)
      edge.color.set('#9aafff')
      edge.intensity = birth.arc * 4.5
      edge.distance = 3.8
      edge.position.set(x, .88, z)
    } else {
      light.color.set('#ff6a3b')
      light.intensity = pulse ? pulse.contact * (mate ? 11.1 : 6.9) : 0
      light.distance = 4.8
      light.position.set(x + .62, .52 + (pulse?.sweep ?? 0) * .79, z + .45)
      edge.color.set('#a2c0f2')
      edge.intensity = pulse ? pulse.surface * (mate ? 2.85 : 1.83) : 0
      edge.distance = 3.6
      edge.position.set(x - .77, 1.46, z - .83)
    }
    const airborne = pulse?.flight ?? -1
    const launched = airborne >= 0 && airborne < 1.38
    embers.visible = launched && (mate || airborne < .64)
    dustMesh.visible = Boolean(mate && airborne >= .07 && airborne < 1.30)

    if (embers.visible) {
      embers.count = mate ? (low ? Math.floor(sparks.length * .54) : sparks.length) : low ? 9 : 16
      const flightScale = mate ? 1 : .66
      const inward = Math.atan2(-z, -x)
      for (let i = 0; i < embers.count; i++) {
        const shard = sparks[i]
        const t = Math.max(0, airborne - shard.lag)
        const angle = shard.angle + inward
        const trajectory = shard.distance + shard.speed * t * flightScale
        const originHeight = mate ? .08 + .27 * shard.height : .47 + 1.06 * shard.height
        const grounded = originHeight + shard.lift * t - 3.75 * t * t
        const life = (mate ? 1 : .49) * shard.life
        const fade = easeRange(0, .045, airborne - shard.lag) * (1 - easeRange(life * .62, life, t))
        const y = grounded >= .021 ? grounded : .021 + .095 * Math.sin(Math.min(1, (t / life)) * Math.PI) ** 2
        object.position.set(x + Math.cos(angle) * trajectory, y, z + Math.sin(angle) * trajectory)
        object.rotation.set(.55 + shard.spin * t, angle + t * (i % 2 ? 4.3 : -3.6), shard.spin * t + .5)
        const size = Math.max(.0001, fade * shard.size * (mate ? 1 : .88))
        object.scale.set(size * .81, size * 3.3, size * .47)
        object.updateMatrix()
        embers.setMatrixAt(i, object.matrix)
      }
      embers.instanceMatrix.needsUpdate = true
    }

    if (dustMesh.visible) {
      dustMesh.count = low ? 8 : dustCount
      const age = airborne - .07
      const material = dustMesh.material as MeshBasicMaterial
      material.opacity = .24 * easeRange(0, .13, age) * (1 - easeRange(.10, 1.15, age))
      for (let i = 0; i < dustMesh.count; i++) {
        const angle = i * 2.399963
        const distance = .36 + age * (.62 + unit(i, 10) * 1.32)
        object.position.set(x + Math.cos(angle) * distance, .055 + unit(i, 11) * .13 + age * .20, z + Math.sin(angle) * distance)
        object.quaternion.copy(camera.quaternion)
        const size = .22 + unit(i, 12) * .16 + age * .59
        object.scale.set(size * 1.52, size, 1)
        object.updateMatrix()
        dustMesh.setMatrixAt(i, object.matrix)
      }
      dustMesh.instanceMatrix.needsUpdate = true
    }
    if (cue && !document.hidden) invalidate()
  })
  return <>
    <pointLight ref={warm} color="#ff6a3b" intensity={0} distance={4.8} decay={2} />
    <pointLight ref={rim} color="#a2c0f2" intensity={0} distance={3.6} decay={2} />
    <instancedMesh ref={flecks} args={[undefined, undefined, sparkCount]} frustumCulled={false} visible={false}>
      <tetrahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#ffd6a0" />
    </instancedMesh>
    <instancedMesh ref={powder} args={[undefined, undefined, dustCount]} frustumCulled={false} visible={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="#be8e76" map={dust} transparent depthWrite={false} opacity={0} />
    </instancedMesh>
  </>
}
