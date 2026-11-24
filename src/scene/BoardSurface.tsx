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

function Border({ color, size, focused = false, strong = false }: {
  color: string; size: number; focused?: boolean; strong?: boolean
}) {
  const width = focused ? .036 : strong ? .068 : .055
  const arm = focused ? .23 : strong ? .31 : .27
  const length = size - arm * .5
  return [-1, 1].flatMap(x => [-1, 1].map(z => (
    <group key={x + ':' + z} position={[x * size, 0, z * size]}>
      <mesh rotation={flatRotation} position={[(length - size) * x, 0, 0]}>
        <planeGeometry args={[arm + .052, width + .052]} />
        <meshBasicMaterial color="#111a24" toneMapped={false} />
      </mesh>
      <mesh rotation={flatRotation} position={[0, 0, (length - size) * z]}>
        <planeGeometry args={[width + .052, arm + .052]} />
        <meshBasicMaterial color="#111a24" toneMapped={false} />
      </mesh>
      <mesh rotation={flatRotation} position={[(length - size) * x, .002, 0]}>
        <planeGeometry args={[arm, width]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh rotation={flatRotation} position={[0, .002, (length - size) * z]}>
        <planeGeometry args={[width, arm]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )))
}

const markerStyle = {
  selected: { color: '#ffdf9b', tint: .22, y: .017 },
  capture: { color: '#ffb29a', tint: .18, y: .019 },
  friendly: { color: '#ffa5ca', tint: .20, y: .020 },
  check: { color: '#ff9589', tint: .27, y: .021 },
  last: { color: '#c6bb97', tint: .22, y: .012 },
  lesson: { color: '#fff0bb', tint: .18, y: .023 },
  focus: { color: '#eff5fc', tint: .08, y: .026 },
}

function TileMark({ mark }: { mark: SceneMark }) {
  const [x, z] = squarePoint(mark.square)
  if (mark.kind === 'move') return (
    <group position={[x, .027, z]}>
      <mesh rotation={flatRotation}>
        <circleGeometry args={[.205, 32]} />
        <meshBasicMaterial color="#111a24" toneMapped={false} />
      </mesh>
      <mesh rotation={flatRotation} position-y={.003}>
        <circleGeometry args={[.132, 32]} />
        <meshBasicMaterial color="#ffe4ac" toneMapped={false} />
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
          <Border color={style.color} size={mark.kind === 'focus' ? .462 : .43}
            focused={mark.kind === 'focus'} strong={mark.kind === 'lesson' || mark.kind === 'check'} />
        </group>
      )}
      {mark.kind === 'friendly' && (
        <group position={[.34, .005, .34]}>
          <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
            <planeGeometry args={[.23, .23]} />
            <meshBasicMaterial color="#111a24" toneMapped={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} position-y={.002}>
            <planeGeometry args={[.15, .15]} />
            <meshBasicMaterial color="#ffa5ca" toneMapped={false} />
          </mesh>
        </group>
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
  const end = new Vector3(tx, .035, tz).addScaledVector(direction, -.34)
  const start = new Vector3(x, .035, z).addScaledVector(direction, .39)
  const dashCount = Math.max(1, Math.min(17, Math.round((length - .73) / .22)))
  const arrowRotation: [number, number, number] = [-Math.PI / 2, 0, Math.atan2(-direction.x, -direction.z)]
  return (
    <group>
      {Array.from({ length: dashCount }, (_, i) => {
        const position = start.clone().lerp(end, i / dashCount)
        return (
          <group key={i} position={position}>
            <mesh rotation={flatRotation}>
              <circleGeometry args={[.076 + .015 * i / dashCount, 12]} />
              <meshBasicMaterial color="#111a24" toneMapped={false} />
            </mesh>
            <mesh rotation={flatRotation} position-y={.002}>
              <circleGeometry args={[.047 + .015 * i / dashCount, 12]} />
              <meshBasicMaterial color="#fff0bb" toneMapped={false} />
            </mesh>
          </group>
        )
      })}
      <group position={end}>
        <mesh rotation={arrowRotation}>
          <circleGeometry args={[.24, 3, Math.PI / 2]} />
          <meshBasicMaterial color="#111a24" toneMapped={false} />
        </mesh>
        <mesh rotation={arrowRotation} position-y={.002}>
          <circleGeometry args={[.17, 3, Math.PI / 2]} />
          <meshBasicMaterial color="#fff0bb" toneMapped={false} />
        </mesh>
      </group>
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
  const boardMaterial = useMemo(() => {
    const material = assets.board.material.clone()
    // Cool, lower-value stone separates the warm ivory army and gold targets
    // without changing the licensed board geometry or replacing its marble map.
    material.color.set('#a5afb5')
    material.roughness = .95
    material.envMapIntensity = .38
    return material
  }, [assets])
  useEffect(() => () => boardMaterial.dispose(), [boardMaterial])
  const lesson = marks.filter(mark => mark.kind === 'lesson')
  return (
    <>
      <mesh rotation={flatRotation} position={[0, -.405, .08]}>
        <planeGeometry args={[14, 14]} />
        <meshBasicMaterial map={getSoftShadow()} opacity={.7} transparent depthWrite={false} />
      </mesh>
      <Plate size={9.54} height={.08} y={-.325} color="#222328" metalness={.3} />
      <Plate size={9.57} height={.017} y={-.299} color="#8c6945" metalness={.63} />
      <mesh geometry={assets.board.geometry} material={boardMaterial} receiveShadow dispose={null} />
      <mesh position-y={.004} rotation={flatRotation}>
        <planeGeometry args={[9.58, 9.58]} />
        <meshBasicMaterial map={letters} transparent opacity={.96} depthWrite={false} toneMapped={false} />
      </mesh>
      {marks.map(mark => <TileMark key={mark.square + mark.kind} mark={mark} />)}
      {lesson.length === 2 && <LessonLine from={lesson[0].square} to={lesson[1].square} />}
    </>
  )
}
