import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CanvasTexture, Group, Mesh, MeshBasicMaterial, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three'
import type { GameEvent, Piece } from '../core/types'
import type { ChessAssets } from './assets'
import { getSoftShadow } from './BoardSurface'
import {
  COUNTER_FOCUS_DELAY_MS, COUNTER_FOCUS_MS, COUNTER_OFFSET, FOCUS_EMPHASIS_MS,
  sampleCounterEmphasis, sampleFigureEmphasis,
} from './cameraFocus'
import { conditionCode, setArmySurface, stoneMaterial } from './stone'
import { squarePoint, stateColors } from './types'
import type { SceneFocus, ScenePiece } from './types'

const restHeight = .005
const flatRotation: [number, number, number] = [-Math.PI / 2, 0, 0]
const ghostDelay = [.055, .109, .166]
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp = (t: number) => Math.max(0, Math.min(1, t))

type PieceModel = Pick<ScenePiece, 'side' | 'kind'>

interface Travel {
  from: Vector3
  to: Vector3
  start: number
  lift: number
  duration: number
}

interface Change {
  from: ScenePiece
  to: ScenePiece
  start: number
  modelChanged: boolean
  modelSwapped: boolean
  cure: boolean
  shame: boolean
  impulse: boolean
  reaction: ScenePiece['affliction'] | null
  duration: number
}

function seed(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return (hash % 2483) / 217
}

function moveDuration(length: number) {
  return Math.min(380, 232 + 26 * length)
}

function positionAlong(travel: Travel, p: number, target: Vector3) {
  const t = smooth(clamp(p))
  const bump = Math.sin(Math.PI * t)
  target.lerpVectors(travel.from, travel.to, t)
  target.y += bump * travel.lift
}

const badgeCache = new Map<string, CanvasTexture>()
function badgeTexture(key: string) {
  const previous = badgeCache.get(key)
  if (previous) return previous
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 72
  const context = canvas.getContext('2d')!
  const color = key === 'shame' ? '#f0cc87'
    : key === 'cure' ? '#c8e3d6'
    : /\d/.test(key) ? '#c6ddf4'
    : stateColors[key as keyof typeof stateColors]
  context.fillStyle = 'rgba(17,20,25,0.91)'
  context.beginPath()
  context.arc(36, 36, 31, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = color
  context.lineWidth = 3.5
  context.stroke()
  context.fillStyle = color
  context.strokeStyle = color
  context.lineWidth = 4.5
  context.lineJoin = 'round'
  context.lineCap = 'round'

  if (/\d/.test(key)) {
    context.font = '700 40px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(key, 36, 38)
  } else if (key === 'guilt') {
    for (const arc of [[.12, 1.05], [1.25, 1.83]]) {
      context.beginPath()
      context.arc(36, 36, 13, arc[0] * Math.PI, arc[1] * Math.PI)
      context.stroke()
    }
  } else if (key === 'berserk') {
    for (const x of [24, 36]) {
      context.beginPath()
      context.moveTo(x, 25)
      context.lineTo(x + 11, 36)
      context.lineTo(x, 47)
      context.stroke()
    }
  } else if (key === 'bloodlust') {
    context.beginPath()
    context.moveTo(36, 20)
    context.bezierCurveTo(43, 28, 47, 34, 47, 40)
    context.bezierCurveTo(47, 53, 25, 55, 25, 40)
    context.bezierCurveTo(25, 33, 31, 25, 36, 20)
    context.fill()
  } else {
    context.beginPath()
    context.moveTo(36, 21)
    context.lineTo(49, 44)
    context.lineTo(23, 44)
    context.closePath()
    context.stroke()
    if (key === 'cure') {
      context.beginPath()
      context.moveTo(31, 38)
      context.lineTo(41, 38)
      context.moveTo(36, 33)
      context.lineTo(36, 43)
      context.stroke()
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  badgeCache.set(key, texture)
  return texture
}

function counterFrameTexture() {
  const cached = badgeCache.get('counter-frame')
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 96
  const context = canvas.getContext('2d')!
  context.lineJoin = 'round'
  context.lineCap = 'round'
  for (const [color, width] of [['#0a1521', 9], ['#e1f3ff', 3.5]] as const) {
    context.strokeStyle = color
    context.lineWidth = width
    for (const [x, y] of [[7, 7], [89, 7], [7, 89], [89, 89]]) {
      const dx = x < 48 ? 1 : -1
      const dy = y < 48 ? 1 : -1
      context.beginPath()
      context.moveTo(x + 21 * dx, y)
      context.lineTo(x, y)
      context.lineTo(x, y + 21 * dy)
      context.stroke()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  badgeCache.set('counter-frame', texture)
  return texture
}

function PieceBadge({ piece, flipped, low, reduced, focus }: {
  piece: ScenePiece; flipped: boolean; low: boolean; reduced: boolean; focus?: SceneFocus
}) {
  const badge = useRef<Group>(null)
  const frame = useRef<Sprite>(null)
  const started = useRef(0)
  const invalidate = useThree(state => state.invalidate)
  const emphasized = focus?.subject === 'countdown'
  const size = low ? .42 : .35
  const sign = flipped ? -1 : 1
  const right = useMemo(() => new Vector3(), [])
  useLayoutEffect(() => {
    started.current = performance.now()
    invalidate()
    if (!emphasized || reduced) return
    // Demand rendering can rest during the short pause after camera arrival.
    const wake = window.setTimeout(invalidate, COUNTER_FOCUS_DELAY_MS)
    return () => window.clearTimeout(wake)
  }, [focus?.key, emphasized, reduced, invalidate])
  useFrame(({ camera }) => {
    if (!badge.current || !frame.current) return
    const elapsed = performance.now() - started.current
    const amount = emphasized ? sampleCounterEmphasis(elapsed, reduced) : 0
    badge.current.scale.set(size * (1 + .60 * amount), size * (1 + .60 * amount), 1)
    right.setFromMatrixColumn(camera.matrixWorld, 0)
    badge.current.position.set(-.30 * sign * (1 - amount), .18, .32 * sign * (1 - amount))
      .addScaledVector(right, -COUNTER_OFFSET * amount)
    frame.current.visible = amount > 0
    ;(frame.current.material as SpriteMaterial).opacity = amount
    if (emphasized && !reduced && elapsed >= COUNTER_FOCUS_DELAY_MS
      && elapsed < COUNTER_FOCUS_DELAY_MS + COUNTER_FOCUS_MS && !document.hidden) invalidate()
  })
  const { affliction, countdown, exposed, curePending } = piece
  const key = affliction === 'devastated' ? String(countdown ?? 3)
    : affliction !== 'neutral' ? affliction : exposed ? 'shame' : curePending ? 'cure' : null
  if (!key) return null
  const [x, z] = squarePoint(piece.square)
  return (
    <group position={[x, .029, z]}>
      {affliction === 'devastated' && <>
        <mesh rotation={flatRotation}>
          <ringGeometry args={[.367, .445, 48]} />
          <meshBasicMaterial color="#101923" transparent opacity={.94} depthWrite={false} toneMapped={false} />
        </mesh>
        {[0, 1, 2].map(i => (
          <mesh key={i} rotation={flatRotation} position-y={.002}>
            <ringGeometry args={[.388, .426, 16, 1, i * (Math.PI * 2 / 3), 1.6]} />
            <meshBasicMaterial
              color="#b6e0fa" transparent opacity={i < (countdown ?? 3) ? 1 : .24}
              depthWrite={false} toneMapped={false}
            />
          </mesh>
        ))}
      </>}
      <group ref={badge} position={[-.30 * sign, .18, .32 * sign]} scale={[size, size, 1]}>
        <sprite renderOrder={emphasized ? 8 : 2}>
          <spriteMaterial map={badgeTexture(key)} transparent depthWrite={false} depthTest={!emphasized} toneMapped={false} />
        </sprite>
        <sprite ref={frame} scale={[1.2, 1.2, 1]} visible={false} renderOrder={9}>
          <spriteMaterial map={counterFrameTexture()} transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} />
        </sprite>
      </group>
    </group>
  )
}

export function VisualPiece({ piece, assets, events, flipped, low, reduced, focus }: {
  piece: ScenePiece
  assets: ChessAssets
  events: readonly GameEvent[]
  flipped: boolean
  low: boolean
  reduced: boolean
  focus?: SceneFocus
}) {
  const mesh = useRef<Mesh>(null)
  const body = useRef<Group>(null)
  const shadow = useRef<Mesh>(null)
  const trail = useRef<(Mesh | null)[]>([])
  const move = useRef<Travel | null>(null)
  const change = useRef<Change | null>(null)
  const focusStart = useRef<number | null>(null)
  const previous = useRef<{ piece: ScenePiece; eventId?: string }>(null)
  const invalidate = useThree(state => state.invalidate)
  const asset = assets.pieces[piece.side][piece.kind]
  const { material, values } = useMemo(
    () => stoneMaterial(assets.pieces.white.pawn.material, 'white', seed(piece.id)),
    [assets, piece.id],
  )
  useEffect(() => () => material.dispose(), [material])
  useLayoutEffect(() => {
    focusStart.current = focus ? performance.now() : null
    values.uFocus.value = focus && reduced ? sampleFigureEmphasis(0, true) : 0
    invalidate()
  }, [focus?.key, focus?.subject, reduced, values, invalidate])

  function stoneState(affliction: ScenePiece['affliction'], amount: number) {
    values.uCondition.value = conditionCode[affliction]
    values.uWear.value = affliction === 'neutral' ? 0 : amount
    values.uTincture.value.set(stateColors[affliction])
  }

  function applyModel(model: PieceModel) {
    const spec = assets.pieces[model.side][model.kind]
    if (mesh.current) mesh.current.geometry = spec.geometry
    setArmySurface(material, spec.material, model.side)
  }

  useLayoutEffect(() => {
    if (!mesh.current || !body.current || !shadow.current) return
    const last = previous.current
    const eventId = events.at(-1)?.id
    previous.current = { piece, eventId }
    const [x, z] = squarePoint(piece.square)
    const now = performance.now()
    const changedSquare = !!last && last.piece.square !== piece.square
    if (!last || reduced) {
      move.current = null
      change.current = null
      body.current.position.set(x, restHeight, z)
      body.current.rotation.y = 0
      shadow.current.position.set(x, .01, z)
      for (const ghost of trail.current) if (ghost) ghost.visible = false
      values.uEmber.value = values.uFade.value = 0
      values.uMend.value = -1
      applyModel(piece)
      stoneState(piece.affliction, 1)
      invalidate()
      return
    }

    if (changedSquare) {
      const to = new Vector3(x, restHeight, z)
      const from = body.current.position.clone()
      const length = Math.hypot(to.x - from.x, to.z - from.z)
      const knight = last.piece.kind === 'knight'
      move.current = { from, to, start: now, duration: moveDuration(length), lift: knight ? .61 : .12 + .024 * length }
    }

    const cue = eventId !== last.eventId ? events : []
    const reaction = cue.find(event => event.type === 'reaction')
    const cueReaction = reaction?.type === 'reaction' ? reaction.affliction : null
    const cure = cue.some(event => event.type === 'cure')
    const shame = cue.some(event => event.type === 'affliction' && event.cause === 'shame')
    const impulse = cue.some(event => event.type === 'capture' || event.type === 'reaction' || event.type === 'affliction')
    const modelChanged = last.piece.side !== piece.side || last.piece.kind !== piece.kind
    const stateChanged = last.piece.affliction !== piece.affliction
    if (modelChanged || stateChanged || cure || impulse) {
      // Restart at the corner of contact rather than while the piece is airborne.
      const delay = changedSquare ? (move.current?.duration ?? 0) * .77 : 60
      change.current = {
        from: last.piece, to: piece, start: now + delay, modelChanged, modelSwapped: false,
        cure, shame, impulse, reaction: cueReaction,
        duration: modelChanged ? 520 : cure ? 470 : 350,
      }
      invalidate()
    }
    if (changedSquare) invalidate()
  })

  useFrame(() => {
    if (!body.current || !shadow.current || !mesh.current) return
    let active = false
    const now = performance.now()
    const travel = move.current
    if (travel) {
      const elapsed = now - travel.start
      const t = clamp(elapsed / travel.duration)
      positionAlong(travel, t, body.current.position)
      const bump = Math.sin(Math.PI * t)
      body.current.rotation.y = Math.sign(travel.to.x - travel.from.x || 1) * .18 * bump
      shadow.current.position.set(body.current.position.x, .011, body.current.position.z)
      const shadowMaterial = shadow.current.material as MeshBasicMaterial
      shadowMaterial.opacity = (low ? .61 : .38) * (1 - .52 * bump)
      const fadeTail = 1 - smooth(clamp((elapsed - travel.duration) / 229))
      for (const [i, ghost] of trail.current.entries()) {
        if (!ghost) continue
        ghost.visible = elapsed > ghostDelay[i] * 1000 && fadeTail > .003
        if (!ghost.visible) continue
        ghost.geometry = mesh.current.geometry
        positionAlong(travel, (elapsed - ghostDelay[i] * 1000) / travel.duration, ghost.position)
        const ghostMaterial = ghost.material as MeshBasicMaterial
        const hot = piece.affliction === 'berserk' || piece.affliction === 'bloodlust'
        ghostMaterial.opacity = (hot ? .27 : .203) * fadeTail * (1 - i * .19) * smooth(clamp(elapsed / 110))
        ghost.rotation.y = body.current.rotation.y * .65
      }
      if (elapsed < travel.duration + 229) active = true
      else move.current = null
    }

    const effect = change.current
    if (effect) {
      const p = clamp((now - effect.start) / effect.duration)
      if (p > 0) {
        const target = effect.to.affliction
        if (effect.modelChanged) {
          if (p >= .5 && !effect.modelSwapped) {
            applyModel(effect.to)
            effect.modelSwapped = true
          }
          values.uFade.value = Math.sin(Math.PI * p) * .85
          stoneState(p >= .5 ? target : effect.from.affliction, 1)
          // Pale quartz lights the eroded edge of a conversion or metamorphosis.
          values.uTincture.value.set(effect.from.side !== effect.to.side ? '#d8c396' : '#ece1c7')
        } else if (effect.cure || (effect.reaction && target === 'neutral')) {
          const old = effect.reaction ?? effect.from.affliction
          stoneState(old, 1 - smooth(p))
          values.uSweepTint.value.set('#b4dbca')
          values.uMend.value = p
        } else {
          stoneState(target, smooth(p))
          if (effect.shame) {
            values.uSweepTint.value.set('#b3aacb')
            values.uMend.value = 1 - p
          }
        }
        values.uEmber.value = effect.impulse ? Math.sin(Math.PI * p) : 0
      }
      if (p < 1) active = true
      else {
        applyModel(effect.to)
        stoneState(effect.to.affliction, 1)
        values.uFade.value = values.uEmber.value = 0
        values.uMend.value = -1
        change.current = null
      }
    }

    if (focusStart.current !== null) {
      const elapsed = now - focusStart.current
      values.uFocus.value = sampleFigureEmphasis(elapsed, reduced)
      if (!reduced && elapsed < FOCUS_EMPHASIS_MS) active = true
    }
    if (active && !document.hidden) invalidate()
  })

  const trailColor = piece.affliction === 'neutral' ? (piece.side === 'white' ? '#eee4c8' : '#7c90b0') : stateColors[piece.affliction]

  return (
    <>
      <mesh ref={shadow} rotation={flatRotation}>
        <planeGeometry args={[.90, .86]} />
        <meshBasicMaterial map={getSoftShadow()} opacity={low ? .61 : .38} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={body}>
        <mesh ref={mesh} material={material} userData={{ square: piece.square }} castShadow={!low} receiveShadow={!low} dispose={null} />
      </group>
      {!reduced && ghostDelay.slice(0, low ? 2 : 3).map((_, i) => (
        <mesh
          key={i} ref={node => { trail.current[i] = node }}
          geometry={asset.geometry} visible={false} dispose={null}
        >
          <meshBasicMaterial color={trailColor} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <PieceBadge piece={piece} flipped={flipped} low={low} reduced={reduced} focus={focus} />
    </>
  )
}

export function DepartingPiece({ events, snapshot, assets, capture }: {
  events: readonly GameEvent[]
  snapshot: Piece
  assets: ChessAssets
  capture: boolean
}) {
  const [x, z] = squarePoint(snapshot.square)
  const mesh = useRef<Mesh>(null)
  const start = useRef(0)
  const invalidate = useThree(state => state.invalidate)
  const asset = assets.pieces[snapshot.side][snapshot.type]
  const { material, values } = useMemo(
    () => stoneMaterial(asset.material, snapshot.side, seed(snapshot.id)),
    [asset, snapshot.side, snapshot.id],
  )
  const action = events.find(event => event.type === 'move')
  let delay = 60
  if (capture && action?.type === 'move') {
    const [fx, fz] = squarePoint(action.from)
    const [tx, tz] = squarePoint(action.to)
    delay = moveDuration(Math.hypot(tx - fx, tz - fz)) * .56
  }

  useLayoutEffect(() => {
    start.current = performance.now()
    values.uCondition.value = conditionCode[snapshot.affliction]
    values.uWear.value = snapshot.affliction === 'neutral' ? 0 : 1
    values.uTincture.value.set(capture ? '#d2b17f' : '#b1c7e0')
    invalidate()
  }, [capture, invalidate, snapshot.affliction, values])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    if (!mesh.current || !mesh.current.visible) return
    const t = clamp((performance.now() - start.current - delay) / (capture ? 290 : 460))
    values.uFade.value = smooth(t) * .98
    mesh.current.position.y = restHeight + t * (capture ? .12 : .29)
    mesh.current.scale.setScalar(1 - t * .08)
    if (t >= 1) mesh.current.visible = false
    else if (!document.hidden) invalidate()
  })

  return <mesh ref={mesh} geometry={asset.geometry} material={material} position={[x, restHeight, z]} dispose={null} />
}
