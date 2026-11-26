import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  CanvasTexture, CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, OrthographicCamera, Quaternion, RingGeometry, Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { DieFace } from '../core/types'
import {
  createDieMotion, DIE_CAMERA_POSITION, DIE_EDGE_RADIUS, DIE_FACE_NORMALS,
  DIE_PIPS, frameDieThrow, getDiePresentationClock, sampleDieMotion,
} from './diceMotion'
import type { DieMotionPlan } from './diceMotion'
import './dieThrow.css'

export interface DieThrowProps {
  readonly face: DieFace
  readonly rollKey: string
  readonly reduced: boolean
  readonly quality?: 'high' | 'low'
  /** Cabinet presentation epoch in performance.now() milliseconds. */
  readonly startedAt?: number
}

class DieBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function DieFallback({ face, phase }: { face: DieFace; phase: 'throwing' | 'settled' }) {
  return <div className="remorse-die-throw__fallback" data-die-renderer="fallback">
    <svg viewBox="0 0 100 100" focusable="false" aria-hidden="true">
      <rect x="5" y="5" width="90" height="90" rx="18" fill="#e9ddc4" stroke="#b6a181" strokeWidth="3" />
      <rect x="10" y="10" width="80" height="80" rx="14" fill="none" stroke="#fff3d9" strokeWidth="1.4" />
      {phase === 'settled' && DIE_PIPS[face].map(([x, y], i) => <circle key={i} cx={50 + x * 110} cy={50 - y * 110} r="7" fill="#20252b" />)}
    </svg>
  </div>
}

function shadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 96
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(48, 48, 5, 48, 48, 48)
  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(.35, 'rgba(0,0,0,.72)')
  gradient.addColorStop(.75, 'rgba(0,0,0,.16)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 96, 96)
  return new CanvasTexture(canvas)
}

function ThrowCamera({ plan }: { plan: DieMotionPlan }) {
  const camera = useThree(state => state.camera) as OrthographicCamera
  const size = useThree(state => state.size)
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    const frame = frameDieThrow(plan, size.width / size.height)
    camera.zoom = size.height / frame.height
    camera.position.copy(frame.position)
    camera.lookAt(frame.target)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    invalidate()
  }, [camera, size.width, size.height, plan, invalidate])
  return null
}

function ContextGuard({ onFailure }: { onFailure: () => void }) {
  const { gl, invalidate } = useThree()
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onFailure() }
    const wake = () => { if (!document.hidden) invalidate() }
    gl.domElement.addEventListener('webglcontextlost', lost)
    document.addEventListener('visibilitychange', wake)
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', lost)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [gl, invalidate, onFailure])
  return null
}

function ThrowModel({ plan, startedAt, low }: { plan: DieMotionPlan; startedAt: number; low: boolean }) {
  const die = useRef<Group>(null)
  const shadow = useRef<Mesh>(null)
  const invalidate = useThree(state => state.invalidate)
  const resources = useMemo(() => {
    const body = new RoundedBoxGeometry(1, 1, 1, low ? 3 : 5, DIE_EDGE_RADIUS)
    const pip = new CircleGeometry(.067, low ? 16 : 24)
    const rim = new RingGeometry(.067, .080, low ? 16 : 24)
    const ivory = new MeshPhysicalMaterial({
      color: '#f0e4ce', roughness: .32, metalness: .035,
      clearcoat: .48, clearcoatRoughness: .23,
    })
    const ink = new MeshStandardMaterial({ color: '#171e27', roughness: .48, metalness: .12 })
    const inset = new MeshStandardMaterial({ color: '#9e8e75', roughness: .67, metalness: .09 })
    const texture = shadowTexture()
    return { body, pip, rim, ivory, ink, inset, texture }
  }, [low])
  useEffect(() => () => Object.values(resources).forEach(resource => resource.dispose()), [resources])
  useLayoutEffect(() => { invalidate() }, [plan, startedAt, invalidate])

  useFrame(() => {
    if (!die.current || !shadow.current) return
    const sample = sampleDieMotion(plan, getDiePresentationClock(plan.reduced, startedAt, performance.now()).elapsedMs)
    die.current.position.set(...sample.position)
    die.current.quaternion.set(...sample.quaternion)
    shadow.current.position.set(sample.position[0], .002, sample.position[2])
    shadow.current.scale.setScalar(sample.shadowScale)
    ;(shadow.current.material as MeshBasicMaterial).opacity = sample.shadowOpacity
    if (sample.phase === 'throwing' && !document.hidden) invalidate()
  })

  return <>
    {!low && <mesh rotation={[-Math.PI / 2, 0, 0]} position-y={-.004} receiveShadow>
      <planeGeometry args={[5, 4]} />
      <shadowMaterial transparent opacity={.20} depthWrite={false} />
    </mesh>}
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.9, 1.55]} />
      <meshBasicMaterial map={resources.texture} transparent opacity={.2} depthWrite={false} toneMapped={false} />
    </mesh>
    <group ref={die} dispose={null}>
      <mesh geometry={resources.body} material={resources.ivory} castShadow={!low} receiveShadow={!low} />
      {([1, 2, 3, 4, 5, 6] as const).map(face => {
        const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...DIE_FACE_NORMALS[face]))
        return <group key={face} quaternion={rotation}>
          {DIE_PIPS[face].map(([x, y], index) => <group key={index} position={[x, y, .501]}>
            <mesh geometry={resources.rim} material={resources.inset} />
            <mesh geometry={resources.pip} material={resources.ink} position-z={.0005} />
          </group>)}
        </group>
      })}
    </group>
  </>
}

function DieThrowRun({ face, rollKey, reduced, quality, startedAt: suppliedStart }: DieThrowProps) {
  const [mountedAt] = useState(() => performance.now())
  const startedAt = suppliedStart !== undefined && Number.isFinite(suppliedStart) ? suppliedStart : mountedAt
  const [phase, setPhase] = useState(() => getDiePresentationClock(reduced, startedAt, performance.now()).phase)
  const [failed, setFailed] = useState(false)
  const low = quality === 'low'
  const plan = useMemo(() => createDieMotion(face, rollKey, reduced), [face, rollKey, reduced])
  useLayoutEffect(() => {
    const clock = getDiePresentationClock(reduced, startedAt, performance.now())
    setPhase(clock.phase)
    if (clock.remainingMs === 0) return
    const timer = window.setTimeout(() => setPhase('settled'), clock.remainingMs)
    return () => window.clearTimeout(timer)
  }, [startedAt, reduced])
  const fallback = <DieFallback face={face} phase={phase} />

  return <div className="remorse-die-throw" data-testid="die-throw" data-face={face}
    data-phase={phase} aria-hidden="true">
    {failed ? fallback : <DieBoundary fallback={fallback}>
      <Canvas orthographic frameloop="demand" dpr={low ? [1, 1.25] : [1, 1.75]}
        camera={{ near: .1, far: 24, position: [...DIE_CAMERA_POSITION] }}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        shadows={low ? false : 'percentage'} onCreated={({ gl }) => { gl.toneMappingExposure = .96 }}>
        <ThrowCamera plan={plan} />
        <ContextGuard onFailure={() => setFailed(true)} />
        <hemisphereLight color="#fff3de" groundColor="#53667f" intensity={.80} />
        <directionalLight color="#fff2d9" intensity={2.2} position={[-3.2, 5.5, 4.5]} castShadow={!low}
          shadow-mapSize-width={512} shadow-mapSize-height={512}
          shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-3}
          shadow-camera-near={.5} shadow-camera-far={16} shadow-normalBias={.015} shadow-bias={-.0001} />
        <directionalLight color="#b9d5ff" intensity={.95} position={[3, 3.5, -3]} />
        <ThrowModel plan={plan} startedAt={startedAt} low={low} />
      </Canvas>
    </DieBoundary>}
  </div>
}

/** A cosmetic reveal of an already committed face; the parent owns its lifetime. */
export function DieThrow(props: DieThrowProps) {
  return <DieThrowRun key={`${props.rollKey}:${props.face}`} {...props} />
}

export default DieThrow
