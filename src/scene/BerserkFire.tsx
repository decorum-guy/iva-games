import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BufferAttribute, BufferGeometry, CanvasTexture, DynamicDrawUsage, MeshBasicMaterial, SRGBColorSpace,
} from 'three'
import { fireOpacity } from './fireMotion'
import type { FireBurst } from './fireMotion'

const layers = 9
const columns = 4
const sectors = 16
const bands = 24
const tau = 2 * Math.PI
let map: CanvasTexture | undefined

// Each sheet carries a luminous interior, a detached edge and a transparent envelope.
// Soft alpha matters where thin tongues are smaller than a pixel in the overview.
function flameMap() {
  if (map) return map
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 96
  const context = canvas.getContext('2d')!
  const pixels = context.createImageData(64, 96)
  const saturate = (n: number) => Math.min(1, Math.max(0, n))
  for (let row = 0; row < 96; row++) {
    const h = 1 - (row + .5) / 96
    for (let col = 0; col < 64; col++) {
      const x = (col + .5) / 32 - 1
      const spine = .19 * Math.sin(h * 6.8 - .5) * h
      const width = .76 * (1 - h) ** .72 * (.48 + .52 * Math.sin(Math.min(1, h * 3.8) * Math.PI / 2))
      const main = 1 - Math.abs(x - spine) / width
      const fork = 1 - Math.abs(x + .24 + h * .49 - .07 * Math.sin(h * 11)) / Math.max(.002, (.65 - h) * .47)
      const density = Math.max(main, fork * .82)
      const hot = saturate(density * 1.40 - h * .9 - .21)
      const i = (row * 64 + col) * 4
      pixels.data[i] = 250 + hot * 5
      pixels.data[i + 1] = 60 + 152 * hot
      pixels.data[i + 2] = 14 + 105 * hot ** 2
      pixels.data[i + 3] = 244 * saturate(density * 2.3 + .18) * saturate(h * 11) * saturate((1 - h) * 12)
    }
  }
  context.putImageData(pixels, 0, 0)
  map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  return map
}

const hulls = new WeakMap<BufferGeometry, { height: number; radii: Float32Array }>()
function surfaceProfile(model: BufferGeometry) {
  const cached = hulls.get(model)
  if (cached) return cached
  const height = model.boundingBox!.max.y
  const vertices = model.getAttribute('position')
  const bins = new Float32Array(sectors * bands)
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), z = vertices.getZ(i)
    const angle = (Math.atan2(z, x) / tau + 1) % 1
    const band = Math.min(bands - 1, Math.max(0, Math.round(vertices.getY(i) / height * (bands - 1))))
    const cell = band * sectors + Math.round(angle * sectors) % sectors
    bins[cell] = Math.max(bins[cell], Math.hypot(x, z))
  }
  const radii = bins.slice()
  for (let i = 0; i < bins.length; i++) {
    if (bins[i]) continue
    const azimuth = i % sectors
    const level = Math.floor(i / sectors)
    let distance = Infinity
    for (let j = 0; j < bins.length; j++) {
      if (!bins[j]) continue
      const delta = Math.abs(azimuth - j % sectors)
      const cost = 2 * Math.abs(level - Math.floor(j / sectors)) + Math.min(delta, sectors - delta)
      if (cost < distance) { radii[i] = bins[j]; distance = cost }
    }
  }
  const profile = { height, radii }
  hulls.set(model, profile)
  return profile
}

function fireSheets(model: BufferGeometry, seed: number, low: boolean) {
  const { height, radii } = surfaceProfile(model)
  const count = low ? 6 : 10
  const stride = columns + 1
  const position = new BufferAttribute(new Float32Array(count * (layers + 1) * stride * 3), 3)
  position.setUsage(DynamicDrawUsage)
  const uv: number[] = []
  const indices: number[] = []
  const flames = Array.from({ length: count }, (_, i) => {
    const angle = seed + i * 2.39996
    const root = height * ([.08, .31, .57, .18, .74, .44, .12, .61, .27, .83][i])
    const rise = Math.min(.54, height * (.35 + .12 * Math.sin(angle * 3.79)))
    const width = (.103 + .027 * Math.cos(angle * 1.9)) * (.72 + height * .24)
    const sector = (Math.round(angle / tau * sectors) % sectors + sectors) % sectors
    for (let j = 0; j <= layers; j++) for (let k = 0; k <= columns; k++) {
      uv.push(k / columns, j / layers)
      if (j === layers || k === columns) continue
      const a = (i * (layers + 1) + j) * stride + k
      const b = a + stride
      indices.push(a, b, a + 1, a + 1, b, b + 1)
      indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
    return { angle, root, rise, width, sector }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', position)
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setIndex(indices)
  function pose(time: number, spread = 1) {
    let vertex = 0
    for (const { angle, root, rise, width, sector } of flames) {
      const phase = time * 4.1 + angle * 2.7
      const lift = rise * (.56 + .44 * spread) * (1 + .16 * Math.sin(phase) + .08 * Math.sin(phase * 1.71))
      for (let row = 0; row <= layers; row++) {
        const v = row / layers
        const y = root + v * lift
        const band = Math.min(bands - 1, y / height * (bands - 1))
        const lo = Math.floor(band), hi = Math.min(bands - 1, lo + 1)
        const radius = radii[lo * sectors + sector] * (1 - band + lo) + radii[hi * sectors + sector] * (band - lo)
        const curl = angle + v * (.21 * Math.sin(phase - v * 4.4) + .16 * Math.sin(phase * .67 - 5 * v))
        const outer = radius + .012 + (.046 * Math.sin(v * Math.PI) + .026 * v) * spread
        for (let k = 0; k <= columns; k++) {
          const arc = curl + (k / columns * 2 - 1) * width / Math.max(.09, outer)
          position.setXYZ(vertex++, Math.cos(arc) * outer, y, Math.sin(arc) * outer)
        }
      }
    }
    position.needsUpdate = true
  }
  pose(0)
  return { geometry, pose }
}

export function BerserkFire({ model, seed, low, reduced, burst }: {
  model: BufferGeometry; seed: number; low: boolean; reduced: boolean
  burst: FireBurst
}) {
  const material = useRef<MeshBasicMaterial>(null)
  const sheets = useMemo(() => fireSheets(model, seed, low), [model, seed, low])
  const texture = useMemo(flameMap, [])
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    sheets.pose(0)
    const wait = Math.max(0, burst.startedAt - performance.now())
    const wake = window.setTimeout(invalidate, wait)
    if (material.current) material.current.opacity = 0
    invalidate()
    return () => window.clearTimeout(wake)
  }, [burst, invalidate, sheets])
  useEffect(() => () => sheets.geometry.dispose(), [sheets])
  useFrame(() => {
    const elapsed = performance.now() - burst.startedAt
    if (elapsed < 0) return
    const strength = fireOpacity(burst, elapsed)
    if (material.current) material.current.opacity = .90 * strength
    if (!reduced) sheets.pose(elapsed * .001, burst.kind === 'ignite' ? strength : 1)
    if (elapsed < burst.duration && !document.hidden) invalidate()
  })
  return <mesh name="berserk-fire" geometry={sheets.geometry} renderOrder={1} frustumCulled={false}>
    <meshBasicMaterial ref={material} map={texture} transparent opacity={0} depthWrite={false} toneMapped={false} />
  </mesh>
}
