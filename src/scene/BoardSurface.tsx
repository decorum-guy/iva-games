import { useEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace, Vector3 } from 'three'
import type { ChessAssets } from './assets'
import { squarePoint } from './types'
import type { SceneMark } from './types'

const flatRotation: [number, number, number] = [-Math.PI / 2, 0, 0]

function engraving(flipped: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const context = canvas.getContext('2d')!
  const scale = canvas.width / 9.58
  const center = canvas.width * 0.5
  context.font = '600 22px Georgia, serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  function label(text: string, x: number, z: number) {
    context.save()
    context.translate(center + x * scale, center + z * scale)
    if (flipped) context.rotate(Math.PI)
    context.fillStyle = '#171717'
    context.fillText(text, .5, .8)
    context.fillStyle = '#d2ad78'
    context.fillText(text, 0, 0)
    context.restore()
  }
  for (let i = 0; i < 8; i++) {
    label(String.fromCharCode(97 + i), i - 3.5, 4.28)
    label(String.fromCharCode(97 + i), i - 3.5, -4.28)
    label(String(i + 1), -4.28, 3.5 - i)
    label(String(i + 1), 4.28, 3.5 - i)
  }
  context.strokeStyle = 'rgba(186,146,91,.58)'
  context.lineWidth = 1
  const inset = center - 4.48 * scale
  context.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function shadowMap() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 12, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(.34, 'rgba(0,0,0,.76)')
  gradient.addColorStop(.72, 'rgba(0,0,0,.19)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  return new CanvasTexture(canvas)
}

let cachedShadow: CanvasTexture | undefined
export function getSoftShadow() {
  cachedShadow ??= shadowMap()
  return cachedShadow
}

function Plate({ size, height, y, color, metalness }: {
  size: number
  height: number
  y: number
  color: string
  metalness: number
}) {
  return (
    <mesh position={[0, y, 0]}>
      <boxGeometry args={[size, height, size]} />
      <meshStandardMaterial color={color} roughness={.55} metalness={metalness} />
    </mesh>
  )
}

function Border({ color, size, focused = false }: { color: string; size: number; focused?: boolean }) {
  const width = focused ? .024 : .035
  const arm = focused ? .19 : .23
  const length = size - arm * .5
  return [-1, 1].flatMap(x => [-1, 1].map(z => (
    <group key={x + ':' + z} position={[x * size, 0, z * size]}>
      <mesh rotation={flatRotation} position={[(length - size) * x, 0, 0]}>
        <planeGeometry args={[arm, width]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh rotation={flatRotation} position={[0, 0, (length - size) * z]}>
        <planeGeometry args={[width, arm]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )))
}

const markerStyle = {
  selected: { color: '#e1ba77', tint: .26, y: .017 },
  capture: { color: '#f7a388', tint: .15, y: .019 },
  friendly: { color: '#ee8ab0', tint: .20, y: .020 },
  check: { color: '#ff8878', tint: .25, y: .021 },
  last: { color: '#cfac69', tint: .19, y: .012 },
  lesson: { color: '#ffe3a2', tint: .16, y: .023 },
  focus: { color: '#f0e6d4', tint: .08, y: .026 },
}

function TileMark({ mark }: { mark: SceneMark }) {
  const [x, z] = squarePoint(mark.square)
  if (mark.kind === 'move') return (
    <group position={[x, .027, z]}>
      <mesh rotation={flatRotation}>
        <circleGeometry args={[.149, 24]} />
        <meshBasicMaterial color="#1a1818" transparent opacity={.78} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={flatRotation} position-y={.003}>
        <circleGeometry args={[.10, 24]} />
        <meshBasicMaterial color="#f5dc9f" toneMapped={false} />
      </mesh>
    </group>
  )
  const style = markerStyle[mark.kind]
  return (
    <group position={[x, style.y, z]}>
      <mesh rotation={flatRotation}>
        <planeGeometry args={[.987, .987]} />
        <meshBasicMaterial color={style.color} opacity={style.tint} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {mark.kind !== 'last' && (
        <group position-y={.001}>
          <Border color={style.color} size={mark.kind === 'focus' ? .462 : .43} focused={mark.kind === 'focus'} />
        </group>
      )}
      {mark.kind === 'friendly' && (
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} position={[.365, .003, .365]}>
          <planeGeometry args={[.135, .135]} />
          <meshBasicMaterial color="#fb98be" toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

function LessonLine({ from, to }: { from: string; to: string }) {
  const [x, z] = squarePoint(from)
  const [tx, tz] = squarePoint(to)
  const direction = new Vector3(tx - x, 0, tz - z)
  const length = direction.length()
  if (length < .9) return null
  direction.normalize()
  const end = new Vector3(tx, .029, tz).addScaledVector(direction, -.34)
  const start = new Vector3(x, .029, z).addScaledVector(direction, .37)
  const dashCount = Math.max(1, Math.min(17, Math.round((length - .71) / .17)))
  return (
    <group>
      {Array.from({ length: dashCount }, (_, i) => {
        const position = start.clone().lerp(end, i / dashCount)
        return (
          <mesh key={i} position={position} rotation={flatRotation}>
            <circleGeometry args={[.025 + .018 * i / dashCount, 8]} />
            <meshBasicMaterial color="#ffdda0" transparent opacity={.72} depthWrite={false} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}

export function BoardSurface({ assets, flipped, marks }: {
  assets: ChessAssets
  flipped: boolean
  marks: readonly SceneMark[]
}) {
  const letters = useMemo(() => engraving(flipped), [flipped])
  useEffect(() => () => letters.dispose(), [letters])
  const lesson = marks.filter(mark => mark.kind === 'lesson')
  return (
    <>
      <mesh rotation={flatRotation} position={[0, -.405, .08]}>
        <planeGeometry args={[14, 14]} />
        <meshBasicMaterial map={getSoftShadow()} opacity={.7} transparent depthWrite={false} />
      </mesh>
      <Plate size={9.54} height={.08} y={-.325} color="#222328" metalness={.3} />
      <Plate size={9.57} height={.017} y={-.299} color="#8c6945" metalness={.63} />
      <mesh geometry={assets.board.geometry} material={assets.board.material} receiveShadow dispose={null} />
      <mesh position-y={.004} rotation={flatRotation}>
        <planeGeometry args={[9.58, 9.58]} />
        <meshBasicMaterial map={letters} transparent opacity={.96} depthWrite={false} toneMapped={false} />
      </mesh>
      {marks.map(mark => <TileMark key={mark.square + mark.kind} mark={mark} />)}
      {lesson.length === 2 && <LessonLine from={lesson[0].square} to={lesson[1].square} />}
    </>
  )
}
