import {
  Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import type { RootState } from '@react-three/fiber'
import { EnvironmentMap } from '@react-three/drei'
import { EquirectangularReflectionMapping, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { DirectionalLight, HemisphereLight } from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import type { GameEvent } from '../core/types'
import { BoardSurface } from './BoardSurface'
import { DepartingPiece, VisualPiece } from './Piece'
import { clearChessAssetLoad, studioHDR, useChessAssets } from './assets'
import { CAMERA_OVERSCAN, CAMERA_TRAVEL_MS, frameCamera, frameCameraOrbit, frameRoyalCamera, overscanFov, sameCameraRig, sampleCameraTravel } from './cameraFocus'
import type { CameraFrame, CameraRig } from './cameraFocus'
import { easeRange, sampleRoyal } from './royalMotion'
import type { RoyalCue } from './royalMotion'
import { RoyalEffects } from './RoyalEffects'
import { squarePoint, worldSquare } from './types'
import type { BoardSceneProps, SceneFocus, SceneMark } from './types'
import './scene.css'

export type { BoardSceneProps, SceneFocus, SceneMark, ScenePiece } from './types'

class GraphicsBoundary extends Component<{ children: ReactNode; onFailure?: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onFailure?.()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

const emptyEvents: readonly GameEvent[] = []
const emptyMarks: readonly SceneMark[] = []
const toRadians = Math.PI / 180

function Viewpoint({ flipped, preset, reduced, focus, royal, onOrbit }: {
  flipped: boolean
  preset: NonNullable<BoardSceneProps['camera']>
  reduced: boolean
  focus?: SceneFocus
  royal?: RoyalCue
  onOrbit: (active: boolean) => void
}) {
  const camera = useThree(state => state.camera) as PerspectiveCamera
  const size = useThree(state => state.size)
  const invalidate = useThree(state => state.invalidate)
  const mobile = size.width / CAMERA_OVERSCAN < 515
  const height = (preset === 'top' ? 89.98 : preset === 'tactical' ? 75 : mobile ? 67 : 58) * toRadians
  const yaw = (preset === 'studio' ? (mobile ? .6 : 3.5) : 0) * toRadians + (flipped ? Math.PI : 0)
  const rig = useRef<CameraRig | null>(null)
  const aspect = size.width / Math.max(1, size.height)
  const applied = useRef<CameraFrame | null>(null)
  const change = useRef<{ from: CameraRig; to: CameraRig; start: number; orbitFrom?: CameraFrame } | null>(null)
  const configured = useRef<CameraRig | null>(null)
  const lastRoyal = useRef<CameraFrame | null>(null)
  const returnRoyal = useRef<{ from: CameraFrame; start: number } | null>(null)

  function apply(value: CameraRig, frame = frameCamera(value, aspect, mobile)) {
    camera.fov = overscanFov(value.fov)
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    applied.current = frame
    camera.position.copy(frame.position)
    camera.lookAt(frame.target)
    camera.updateMatrixWorld()
  }

  useLayoutEffect(() => {
    const target: CameraRig = {
      elevation: height, yaw, fov: preset === 'top' ? 26 : 35,
      focusAmount: focus && !reduced ? 1 : 0,
      focusPoint: focus ? squarePoint(focus.square) : rig.current?.focusPoint ?? [0, 0],
    }
    if (!rig.current) rig.current = { ...target, focusAmount: 0 }
    if (reduced) {
      rig.current = target
      change.current = null
    } else if (!configured.current || !sameCameraRig(configured.current, target)) {
      // At overview scale the unused anchor can move without moving the camera.
      if (rig.current.focusAmount === 0) rig.current = { ...rig.current, focusPoint: target.focusPoint }
      const yawDelta = target.yaw - rig.current.yaw
      const turning = Math.abs(Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta))) > .04 ||
        Boolean(change.current?.orbitFrom)
      const orbitFrom = turning ? applied.current ?? frameCamera(rig.current, aspect, mobile) : undefined
      change.current = sameCameraRig(rig.current, target) ? null : { from: rig.current, to: target, start: performance.now(), orbitFrom }
    }
    configured.current = target
    onOrbit(Boolean(change.current?.orbitFrom))
    apply(rig.current, change.current?.orbitFrom ? applied.current ?? undefined : undefined)
    invalidate()
  }, [aspect, camera, height, yaw, invalidate, mobile, onOrbit, preset, reduced, focus?.square, focus?.key])

  useLayoutEffect(() => {
    if (!royal && lastRoyal.current && !change.current && !reduced) {
      returnRoyal.current = { from: lastRoyal.current, start: performance.now() }
    } else returnRoyal.current = null
    lastRoyal.current = null
    invalidate()
  }, [royal?.id, reduced, invalidate])

  useFrame(() => {
    if (!rig.current) return
    const now = performance.now()
    const travel = change.current
    let overview: CameraFrame | undefined
    if (travel) {
      const elapsed = now - travel.start
      rig.current = sampleCameraTravel(travel.from, travel.to, elapsed)
      overview = travel.orbitFrom
        ? frameCameraOrbit(rig.current, travel.orbitFrom, frameCamera(travel.to, aspect, mobile), elapsed)
        : frameCamera(rig.current, aspect, mobile)
      if (elapsed >= CAMERA_TRAVEL_MS) {
        change.current = null
        onOrbit(false)
      } else if (!document.hidden) invalidate()
    }
    if (royal && !royal.reduced && !reduced) {
      const shot = sampleRoyal(royal, now - royal.startedAt)
      const frame = frameRoyalCamera(rig.current, aspect, mobile, squarePoint(royal.square),
        royal.kind === 'mate', shot.camera, shot.recoil, overview)
      apply(rig.current, frame)
      lastRoyal.current = shot.camera > .001 ? frame : null
      if (!document.hidden) invalidate()
    } else if (overview) {
      apply(rig.current, overview)
    } else if (returnRoyal.current) {
      const { from, start } = returnRoyal.current
      const target = frameCamera(rig.current, aspect, mobile)
      const t = easeRange(0, 290, now - start)
      apply(rig.current, {
        position: from.position.clone().lerp(target.position, t),
        target: from.target.clone().lerp(target.target, t),
        distance: from.distance + (target.distance - from.distance) * t,
      })
      if (t === 1) returnRoyal.current = null
      else if (!document.hidden) invalidate()
    }
  })

  return null
}

function Reflections({ low }: { low: boolean }) {
  const texture = useLoader(HDRLoader, studioHDR)
  texture.mapping = EquirectangularReflectionMapping
  return <EnvironmentMap map={texture} environmentIntensity={low ? .55 : .66} environmentRotation={[0, .63, 0]} />
}

function Lighting({ low, royal }: { low: boolean; royal?: RoyalCue }) {
  const ambient = useRef<HemisphereLight>(null)
  const key = useRef<DirectionalLight>(null)
  const fill = useRef<DirectionalLight>(null)
  useFrame(() => {
    const shade = royal ? sampleRoyal(royal, performance.now() - royal.startedAt).dusk : 0
    if (ambient.current) ambient.current.intensity = .44 - shade * .11
    if (key.current) key.current.intensity = 1.70 - shade * .64
    if (fill.current) fill.current.intensity = 1.12 - shade * .32
  })
  return (
    <>
      <hemisphereLight ref={ambient} color="#f1eee8" groundColor="#4b5870" intensity={.44} />
      <directionalLight
        ref={key} castShadow={!low} position={[-3.8, 9.4, 5.7]} color="#fff1dc" intensity={1.70}
        shadow-mapSize-width={1536} shadow-mapSize-height={1536}
        shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7}
        shadow-camera-near={.5} shadow-camera-far={24} shadow-normalBias={.022} shadow-bias={-.00016} shadow-radius={2.8}
      />
      <directionalLight ref={fill} position={[4.5, 5, -5.8]} color="#b9d3ff" intensity={1.12} />
      <directionalLight position={[4.9, 4.5, 1.5]} color="#fff4e3" intensity={.24} />
      <GraphicsBoundary>
        <Suspense fallback={null}>
          <Reflections low={low} />
        </Suspense>
      </GraphicsBoundary>
    </>
  )
}

function ContextLifecycle({ onFailure }: { onFailure: () => void }) {
  const { gl, invalidate } = useThree()
  useEffect(() => {
    const canvas = gl.domElement
    const contextLost = (event: Event) => {
      event.preventDefault()
      onFailure()
    }
    const refresh = () => { if (!document.hidden) invalidate() }
    canvas.addEventListener('webglcontextlost', contextLost)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      canvas.removeEventListener('webglcontextlost', contextLost)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [gl, invalidate, onFailure])
  return null
}

function eventPieceId(event: GameEvent) {
  if ('piece' in event) return event.piece.id
  if (event.type === 'capture') return event.capturer.id
  return null
}

function MarbleSet({ pieces, marks, events, flipped, low, reduced, focus, royal, onReady }: {
  pieces: BoardSceneProps['pieces']
  marks: readonly SceneMark[]
  events: readonly GameEvent[]
  flipped: boolean
  low: boolean
  reduced: boolean
  focus?: SceneFocus
  royal?: RoyalCue
  onReady: () => void
}) {
  const assets = useChessAssets()
  const initialEvent = useRef(events.at(-1)?.id)
  const currentEvents = events.at(-1)?.id === initialEvent.current ? emptyEvents : events
  const eventsById = useMemo(() => {
    const map = new Map<string, GameEvent[]>()
    for (const event of currentEvents) {
      const key = eventPieceId(event)
      if (!key) continue
      const list = map.get(key)
      if (list) list.push(event)
      else map.set(key, [event])
    }
    return map
  }, [currentEvents])

  useEffect(onReady, [onReady])
  return (
    <>
      <BoardSurface assets={assets} marks={marks} flipped={flipped} royal={royal} />
      <group name="remorse-pieces">
        {pieces.map(piece => (
          <VisualPiece
            key={piece.id} piece={piece} assets={assets} events={eventsById.get(piece.id) ?? emptyEvents}
            low={low} flipped={flipped} reduced={reduced}
            focus={piece.square === focus?.square ? focus : undefined}
            threatened={piece.kind === 'king' && marks.some(mark => mark.kind === 'check' && mark.square === piece.square)}
            royal={piece.id === royal?.pieceId ? royal : undefined}
          />
        ))}
      </group>
      {!reduced && currentEvents.map(event =>
        event.type === 'capture' || event.type === 'remove'
          ? <DepartingPiece key={event.id} snapshot={event.type === 'capture' ? event.victim : event.piece} capture={event.type === 'capture'} events={currentEvents} assets={assets} />
          : null,
      )}
    </>
  )
}

function useReducedMotion(force: boolean) {
  const query = '(prefers-reduced-motion: reduce)'
  const [system, setSystem] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const change = () => setSystem(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return force || system
}

interface PointerOrigin {
  id: number
  square: string | null
  x: number
  y: number
}

export default function BoardScene({
  pieces, marks = emptyMarks, events = emptyEvents, flipped = false,
  camera = 'studio', quality, reducedMotion = false, motionKey,
  focus, royal, onSquare, onDragSquare, onFailure, loadingLabel,
}: BoardSceneProps) {
  const reduced = useReducedMotion(reducedMotion)
  const pointer = useRef<PointerOrigin>(null)
  const scene = useRef<RootState>(null)
  const [ready, setReady] = useState(false)
  const [compact, setCompact] = useState(() => window.innerWidth < 650)
  const [dragTarget, setDragTarget] = useState<string | null>(null)
  const low = quality ? quality === 'low' : compact
  const board = useRef<HTMLDivElement>(null)
  const legal = new Set(marks.filter(mark => ['move', 'capture', 'friendly'].includes(mark.kind)).map(mark => mark.square))
  const picking = useMemo(() => ({
    point: new Vector2(),
    point3: new Vector3(),
    plane: new Plane(new Vector3(0, 1, 0), -.006),
    ray: new Raycaster(),
  }), [])
  const onReady = useCallback(() => setReady(true), [])
  const onOrbit = useCallback((active: boolean) => {
    board.current?.toggleAttribute('data-camera-orbit', active)
  }, [])
  const activeFocus = ready && focus && pieces.some(piece => piece.square === focus.square) ? focus : undefined
  const shownMarks: readonly SceneMark[] = dragTarget && !marks.some(mark => mark.square === dragTarget && mark.kind === 'focus')
    ? [...marks, { square: dragTarget, kind: 'focus' }]
    : marks
  const focusedMarks: readonly SceneMark[] = activeFocus && !shownMarks.some(mark => mark.square === activeFocus.square && mark.kind === 'focus')
    ? [...shownMarks, { square: activeFocus.square, kind: 'focus' }]
    : shownMarks

  useEffect(() => {
    const element = board.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      if (entries[0]) setCompact(entries[0].contentRect.width < 515)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function pick(event: PointerEvent<HTMLDivElement>, preference: 'piece' | 'board' = 'piece') {
    const current = scene.current?.get()
    if (!current || !ready) return null
    const rect = current.gl.domElement.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    if (px < 0 || px > 1 || py < 0 || py > 1) return null
    picking.point.set(px * 2 - 1, 1 - py * 2)
    picking.ray.setFromCamera(picking.point, current.camera)
    const point = picking.ray.ray.intersectPlane(picking.plane, picking.point3)
    const base = point ? worldSquare(point.x, point.z) : null
    // Exact square centers and marked destinations stay selectable when a tall
    // neighboring piece crosses the sightline. Elsewhere the visible figure wins.
    if (preference === 'board') return base
    if (base && point) {
      const [x, z] = squarePoint(base)
      if (legal.has(base) || Math.max(Math.abs(point.x - x), Math.abs(point.z - z)) <= .24) return base
    }
    const pieces = current.scene.getObjectByName('remorse-pieces')
    if (!pieces) return base
    const model = picking.ray.intersectObjects(pieces.children, true)
      .find(hit => typeof hit.object.userData.square === 'string')
    return (model?.object.userData.square as string | undefined) ?? base
  }

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || board.current?.hasAttribute('data-camera-orbit')) return
    pointer.current = { id: event.pointerId, square: pick(event), x: event.clientX, y: event.clientY }
    if (event.pointerType === 'mouse' && onDragSquare) event.currentTarget.setPointerCapture(event.pointerId)
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const origin = pointer.current
    if (!onDragSquare || event.pointerType !== 'mouse' || origin?.id !== event.pointerId ||
      !origin.square || !pieces.some(piece => piece.square === origin.square) ||
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 8) return
    setDragTarget(pick(event, 'board'))
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    const origin = pointer.current
    if (origin?.id !== event.pointerId) return
    pointer.current = null
    setDragTarget(null)
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= 10) {
      if (origin.square && onDragSquare && event.pointerType === 'mouse') {
        const destination = pick(event, 'board')
        if (destination && destination !== origin.square) onDragSquare(origin.square, destination)
      }
      return
    }
    const square = origin.square ?? pick(event)
    if (square) onSquare(square)
  }

  return (
    <div
      ref={board} className="remorse-scene" data-renderer="3d" data-scene-ready={ready ? 'true' : 'false'}
      data-camera-focus={activeFocus?.square ?? 'none'} data-focus-subject={activeFocus?.subject ?? 'none'}
      onPointerDown={startPointer} onPointerUp={finishPointer} onPointerMove={movePointer}
      onPointerCancel={() => { pointer.current = null; setDragTarget(null) }}
    >
      <GraphicsBoundary onFailure={() => { clearChessAssetLoad(); onFailure() }}>
        <Canvas
          style={{ position: 'absolute', inset: `${(1 - CAMERA_OVERSCAN) * 50}%`,
            width: `${CAMERA_OVERSCAN * 100}%`, height: `${CAMERA_OVERSCAN * 100}%`, pointerEvents: 'none' }}
          frameloop="demand" dpr={low ? [1, 1.5] : [1, 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ near: .18, far: 60, position: [1, 15, 10], fov: 35 }}
          shadows={low ? false : 'percentage'}
          onCreated={state => { scene.current = state; state.gl.toneMappingExposure = .97 }}
        >
          <Viewpoint flipped={flipped} preset={camera} reduced={reduced} focus={activeFocus} royal={royal} onOrbit={onOrbit} />
          <ContextLifecycle onFailure={onFailure} />
          <Lighting low={low} royal={royal} />
          <RoyalEffects cue={royal} low={low} />
          <Suspense fallback={null}>
            <MarbleSet
              key={motionKey ?? 'marble-set'} pieces={pieces} marks={focusedMarks} events={events}
              flipped={flipped} low={low} reduced={reduced} focus={activeFocus} royal={royal} onReady={onReady}
            />
          </Suspense>
        </Canvas>
      </GraphicsBoundary>
      {!ready && loadingLabel && <div className="remorse-scene__loader" role="status">{loadingLabel}</div>}
    </div>
  )
}
