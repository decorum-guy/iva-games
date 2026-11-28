import { VISION } from './constants'
import { distance, distanceSquared, segmentCircle, segmentRect, segmentSegment } from './geometry'
import { getMap } from './maps'
import type { Building, GameEvent, Point, Rect, Team, Unit, World } from './types'

interface VisibilitySnapshot {
  visible: (team: Team, point: Point, targetId?: string) => boolean
  clear: (from: Point, to: Point, fromId?: string, targetId?: string, ignoreSmoke?: boolean) => boolean
}
const snapshots = new WeakMap<World, VisibilitySnapshot>()
/** A scoped, derived query cache. Callers must not move entities or change occluders inside the scope. */
export function withVisibilitySnapshot<T>(w: World, read: () => T): T {
  if (snapshots.has(w)) return read()
  const map = getMap(w.mapId), pads = new Map(map.pads.map(p => [p.id, p.rect]))
  const solids: { id?: string; rect: Rect }[] = w.walls.filter(r => !r.destructible || r.hp > 0).map(rect => ({ id: rect.id, rect }))
  for (const b of w.buildings) if (b.kind !== 'bridge') solids.push({ id: b.id, rect: pads.get(b.padId)! })
  const observers = { A: [] as (Point & { id?: string; range2: number })[], B: [] as (Point & { id?: string; range2: number })[] }
  for (const team of ['A', 'B'] as Team[]) observers[team].push({ ...map.bases[w.teams[team].side], range2: VISION.base ** 2 })
  for (const u of w.units) if (u.hp > 0) observers[u.team].push({ x: u.x, z: u.z, id: u.id, range2: VISION[u.kind] ** 2 })
  for (const t of w.transports) observers[t.team].push({ x: t.x, z: t.z, id: t.id, range2: VISION.transport ** 2 })
  for (const b of w.buildings) observers[b.team].push({ x: b.x, z: b.z, id: b.id, range2: (b.powered ? VISION.building : VISION.inactiveBuilding) ** 2 })
  const clear: VisibilitySnapshot['clear'] = (from, to, fromId, targetId, ignoreSmoke = false) => {
    if (!ignoreSmoke && distanceSquared(from, to) > 2.25) for (const smoke of w.smokes) if (smoke.id !== targetId && segmentCircle(from, to, smoke, smoke.radius) !== null) return false
    for (const solid of solids) if ((!solid.id || (solid.id !== fromId && solid.id !== targetId)) && segmentRect(from, to, solid.rect) !== null) return false
    return true
  }
  const cache = { A: new Map<string, boolean>(), B: new Map<string, boolean>() }
  const visible: VisibilitySnapshot['visible'] = (team, point, targetId) => {
    // Actual entities repeat across target selection, effects and history. Tracer samples do not;
    // avoid allocating coordinate strings for those short-lived points.
    const key = targetId && 'id' in point && point.id === targetId ? targetId : undefined
    const existing = key ? cache[team].get(key) : undefined
    if (existing !== undefined) return existing
    let result = false
    for (const observer of observers[team]) if (distanceSquared(observer, point) <= observer.range2 && clear(observer, point, observer.id, targetId)) { result = true; break }
    if (key) cache[team].set(key, result)
    return result
  }
  snapshots.set(w, { visible, clear })
  try { return read() } finally { snapshots.delete(w) }
}

export function sightClear(w: World, from: Point, to: Point, fromId?: string, targetId?: string, ignoreSmoke = false): boolean {
  const snapshot = snapshots.get(w)
  if (snapshot) return snapshot.clear(from, to, fromId, targetId, ignoreSmoke)
  const map = getMap(w.mapId)
  if (!ignoreSmoke && distanceSquared(from, to) > 2.25 && w.smokes.some(s => s.id !== targetId && segmentCircle(from, to, s, s.radius) !== null)) return false
  if (w.walls.some(r => r.id !== targetId && (!r.destructible || r.hp > 0) && segmentRect(from, to, r) !== null)) return false
  if (w.buildings.some(b => b.kind !== 'bridge' && b.id !== fromId && b.id !== targetId && segmentRect(from, to, map.pads.find(p => p.id === b.padId)!.rect) !== null)) return false
  return true
}
export function isPointVisible(w: World, team: Team, point: Point, targetId?: string): boolean {
  const snapshot = snapshots.get(w)
  if (snapshot) return snapshot.visible(team, point, targetId)
  const map = getMap(w.mapId), base = map.bases[w.teams[team].side]
  if (distanceSquared(base, point) <= VISION.base ** 2 && sightClear(w, base, point, undefined, targetId)) return true
  for (const u of w.units) if (u.team === team && u.hp > 0 && distanceSquared(u, point) <= VISION[u.kind] ** 2 && sightClear(w, u, point, u.id, targetId)) return true
  for (const t of w.transports) if (t.team === team && distanceSquared(t, point) <= VISION.transport ** 2 && sightClear(w, t, point, t.id, targetId)) return true
  for (const b of w.buildings) if (b.team === team && distanceSquared(b, point) <= (b.powered ? VISION.building : VISION.inactiveBuilding) ** 2 && sightClear(w, b, point, b.id, targetId)) return true
  return false
}
export const entityVisible = (w: World, team: Team, entity: Unit | Building): boolean => entity.team === team || isPointVisible(w, team, entity, entity.id)
export function visibleEnemyIds(w: World, team: Team): Set<string> {
  return withVisibilitySnapshot(w, () => new Set([...w.units, ...w.buildings].filter(e => e.team !== team && entityVisible(w, team, e)).map(e => e.id)))
}
export function visibleEnemyBuildingIds(w: World, team: Team): Set<string> {
  return withVisibilitySnapshot(w, () => new Set(w.buildings.filter(e => e.team !== team && entityVisible(w, team, e)).map(e => e.id)))
}
export function updateMemories(w: World): void {
  for (const team of ['A', 'B'] as Team[]) {
    for (const b of w.buildings) if (b.team !== team && entityVisible(w, team, b)) {
      w.memories[team][b.id] = { id: b.id, kind: b.kind, team: b.team, ownerId: b.ownerId, padId: b.padId, x: b.x, z: b.z, hp: b.hp, maxHp: b.maxHp, seenTick: w.tick, stale: true }
    }
    for (const [id, memory] of Object.entries(w.memories[team])) if (!w.buildings.some(b => b.id === id) && isPointVisible(w, team, memory, id)) delete w.memories[team][id]
  }
}
function append(w: World, viewerId: string, event: Omit<GameEvent, 'seq' | 'tick'>): void {
  const list = w.events[viewerId] ?? (w.events[viewerId] = [])
  list.push({ ...event, seq: (w.eventSeq[viewerId] = (w.eventSeq[viewerId] ?? 0) + 1), tick: w.tick })
  // 4 s of ephemeral presentation; durable gameplay comes from the world's state.
  while (list.length && (list[0].tick < w.tick - 120 || list.length > 160)) list.shift()
}
export function publicEvent(w: World, event: Omit<GameEvent, 'seq' | 'tick'>): void { for (const p of w.participants) append(w, p.id, event) }
export function teamEvent(w: World, team: Team, event: Omit<GameEvent, 'seq' | 'tick'>): void { for (const p of w.participants) if (p.team === team) append(w, p.id, event) }
export function ownEvent(w: World, ownerId: string, event: Omit<GameEvent, 'seq' | 'tick'>): void { append(w, ownerId, event) }
export function spatialEvent(w: World, point: Point, type: string, actorId?: string, audibleRadius = 0, publicSource = false): void {
  for (const p of w.participants) {
    if (publicSource || isPointVisible(w, p.team, point, actorId)) append(w, p.id, { type, point: { x: point.x, z: point.z }, ...(actorId ? { actorId } : {}) })
    else if (audibleRadius) {
      const listener = w.units.find(u => u.ownerId === p.id && u.kind === 'fighter')
      if (listener && distance(listener, point) <= audibleRadius) {
        const angle = Math.atan2(point.z - listener.z, point.x - listener.x)
        const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8
        append(w, p.id, { type: `sound:${type}`, sector, proximity: distance(listener, point) <= 8 ? 'near' : 'far', muffled: !sightClear(w, listener, point, listener.id, actorId, true) })
      }
    }
  }
}
export function shotEvent(w: World, source: Point & { id: string }, end: Point, label: string): void {
  for (const team of ['A', 'B'] as Team[]) {
    const map = getMap(w.mapId)
    let fraction = 1
    const knownBlockers = [...w.walls.filter(r => !r.destructible || r.hp > 0), ...w.buildings.filter(b => b.id !== source.id && b.kind !== 'bridge' && entityVisible(w, team, b)).map(b => map.pads.find(pad => pad.id === b.padId)!.rect)]
    for (const r of knownBlockers) { const t = segmentRect(source, end, r); if (t !== null) fraction = Math.min(fraction, t) }
    for (const b of w.barriers) if (isPointVisible(w, team, b.a) || isPointVisible(w, team, b.b)) { const t = segmentSegment(source, end, b.a, b.b); if (t !== null) fraction = Math.min(fraction, t) }
    const visibleEnd = { x: source.x + (end.x - source.x) * fraction, z: source.z + (end.z - source.z) * fraction }
    const steps = Math.max(1, Math.ceil(distance(source, visibleEnd) / 0.5)), segments: { a: Point; b: Point }[] = []
    let start: Point | null = null, previous: Point = { x: source.x, z: source.z }
    for (let i = 0; i <= steps; i++) {
      const point = { x: source.x + (visibleEnd.x - source.x) * i / steps, z: source.z + (visibleEnd.z - source.z) * i / steps }
      const visible = isPointVisible(w, team, point, source.id)
      if (visible && !start) start = point
      if (!visible && start) { if (distance(start, previous) > 0.02) segments.push({ a: start, b: previous }); start = null }
      previous = point
    }
    if (start && distance(start, visibleEnd) > 0.02) segments.push({ a: start, b: visibleEnd })
    for (const p of w.participants) if (p.team === team) {
      for (const s of segments) append(w, p.id, { type: 'shot', point: s.a, end: s.b, label })
      if (isPointVisible(w, team, source, source.id)) append(w, p.id, { type: 'muzzle', point: { x: source.x, z: source.z }, actorId: source.id, label })
    }
  }
  spatialEvent(w, source, `weapon:${label}`, source.id, 16)
}
