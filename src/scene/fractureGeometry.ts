import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'

type Point = readonly [number, number]
type Triangle = readonly [Point, Point, Point]
type Bounds = readonly [number, number, number, number]
interface TopFace {
  ids: readonly [number, number, number]
  points: Triangle
  bounds: Bounds
  signedArea: number
}

const epsilon = 1e-8
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function bounds(points: Triangle): Bounds {
  const [a, b, c] = points
  return [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]),
    Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1])]
}

/** Split the normalized Poly Haven mesh at its playable top, leaving the frame and underside intact. */
export function fractureSource(board: BufferGeometry) {
  const position = board.getAttribute('position'), normal = board.getAttribute('normal'), uv = board.getAttribute('uv')
  const index = board.index, count = index?.count ?? position.count
  const frameIds: number[] = []
  const faces: TopFace[] = []
  for (let i = 0; i < count; i += 3) {
    const a = index?.getX(i) ?? i, b = index?.getX(i + 1) ?? i + 1, c = index?.getX(i + 2) ?? i + 2
    const ids = [a, b, c] as const
    const top = ids.every(id => Math.abs(position.getY(id)) < .0001 &&
      Math.abs(position.getX(id)) <= 4.001 && Math.abs(position.getZ(id)) <= 4.001)
    if (top) {
      // Grid vertices in this normalized asset are at integer coordinates to within 3e-6.
      const read = (id: number): Point => [Math.round(position.getX(id)), Math.round(position.getZ(id))]
      const points = [read(a), read(b), read(c)] as const
      const signedArea = cross(...points)
      if (signedArea < -.0002) {
        faces.push({ ids, points, signedArea, bounds: bounds(points) })
        continue
      }
    }
    frameIds.push(a, b, c)
  }
  const frame = board.clone()
  frame.setIndex(frameIds)
  frame.clearGroups()
  return { frame, faces, position, normal, uv }
}

type FractureSource = ReturnType<typeof fractureSource>

/** Clip an original triangle against one edge of a counterclockwise shard triangle. */
function clipEdge(polygon: readonly Point[], a: Point, b: Point) {
  const result: Point[] = []
  let previous = polygon.at(-1)!
  let previousDistance = cross(a, b, previous)
  for (const point of polygon) {
    const distance = cross(a, b, point)
    if ((distance >= -epsilon) !== (previousDistance >= -epsilon)) {
      const t = Math.max(0, Math.min(1, previousDistance / (previousDistance - distance)))
      result.push([previous[0] + (point[0] - previous[0]) * t, previous[1] + (point[1] - previous[1]) * t])
    }
    if (distance >= -epsilon) result.push(point)
    previous = point
    previousDistance = distance
  }
  return result
}

function surface(source: FractureSource, triangles: readonly Triangle[], center: Point) {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = []
  function vertex(point: Point, face: TopFace) {
    const [a, b, c] = face.points
    const wa = cross(b, c, point) / face.signedArea, wb = cross(c, a, point) / face.signedArea, wc = 1 - wa - wb
    const [i, j, k] = face.ids
    const y = source.position.getY(i) * wa + source.position.getY(j) * wb + source.position.getY(k) * wc
    positions.push(point[0] - center[0], y, point[1] - center[1])
    const attr = source.normal
    const nx = attr.getX(i) * wa + attr.getX(j) * wb + attr.getX(k) * wc
    const ny = attr.getY(i) * wa + attr.getY(j) * wb + attr.getY(k) * wc
    const nz = attr.getZ(i) * wa + attr.getZ(j) * wb + attr.getZ(k) * wc
    const length = Math.hypot(nx, ny, nz) || 1
    normals.push(nx / length, ny / length, nz / length)
    const uv = source.uv
    uvs.push(uv.getX(i) * wa + uv.getX(j) * wb + uv.getX(k) * wc,
      uv.getY(i) * wa + uv.getY(j) * wb + uv.getY(k) * wc)
  }
  for (const triangle of triangles) {
    const [minX, minZ, maxX, maxZ] = bounds(triangle)
    for (const face of source.faces) {
      const [left, back, right, front] = face.bounds
      if (left >= maxX || right <= minX || back >= maxZ || front <= minZ) continue
      let polygon: readonly Point[] = face.points
      for (let k = 0; k < 3 && polygon.length; k++) polygon = clipEdge(polygon, triangle[k], triangle[(k + 1) % 3])
      for (let k = 1; k + 1 < polygon.length; k++) {
        if (cross(polygon[0], polygon[k], polygon[k + 1]) >= -epsilon) continue
        vertex(polygon[0], face); vertex(polygon[k], face); vertex(polygon[k + 1], face)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  return geometry
}

function prism(outline: readonly Point[], triangles: readonly Triangle[], center: Point, depth: number, seed: number) {
  const positions: number[] = [], colors: number[] = []
  function vertex(p: Point, y: number, shade: number) {
    positions.push(p[0] - center[0], y, p[1] - center[1])
    colors.push(shade, shade * .94, shade * .91)
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length]
    const breaks = [0, 1]
    for (const axis of [0, 1] as const) {
      const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis])
      for (let grid = Math.floor(lo) + 1; grid < hi; grid++) breaks.push((grid - a[axis]) / (b[axis] - a[axis]))
    }
    breaks.sort((x, y) => x - y)
    const along = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    for (let j = 1; j < breaks.length; j++) {
      if (breaks[j] - breaks[j - 1] < epsilon) continue
      const left = along(breaks[j - 1]), right = along(breaks[j]), mid = along((breaks[j - 1] + breaks[j]) / 2)
      const light = (Math.floor(mid[0] + 4) + Math.floor(mid[1] + 4)) % 2 === 0
      const grain = Math.sin(seed + i * 31.7 + j * 13.9) * .5 + .5
      const rim = (light ? .45 : .18) * (.82 + grain * .18)
      const middle = rim * (.49 + grain * .18), bottom = rim * .27
      const ledge = -depth * (.24 + grain * .18)
      function band(top: number, base: number, upper: number, lower: number) {
        vertex(left, top, upper); vertex(right, top, upper); vertex(right, base, lower)
        vertex(left, top, upper); vertex(right, base, lower); vertex(left, base, lower)
      }
      band(0, ledge, rim, middle)
      band(ledge, -depth, middle, bottom)
    }
  }
  // The triangulation is counterclockwise in XZ, giving the base a downward normal.
  for (const triangle of triangles) for (const p of triangle) vertex(p, -depth, .045)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Build a rigid, closed marble shard. Its simple outline may be concave and use either winding. */
export function fractureShard(source: FractureSource, outline: readonly Point[], depth: number, rimSeed: number) {
  const different = (a: Point, b: Point) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > epsilon
  const loop = outline.filter((point, i) => i === 0 || different(point, outline[i - 1]))
  if (loop.length > 1 && !different(loop[0], loop.at(-1)!)) loop.pop()
  let area = 0, cx = 0, cz = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length]
    const weight = a[0] * b[1] - b[0] * a[1]
    area += weight; cx += (a[0] + b[0]) * weight; cz += (a[1] + b[1]) * weight
  }
  if (loop.length < 3 || Math.abs(area) < epsilon || !(depth > 0)) throw new Error('A marble shard requires a simple outline with area and positive depth')
  const center: Point = [cx / (3 * area), cz / (3 * area)]
  if (area < 0) loop.reverse()
  const indices = ShapeUtils.triangulateShape(loop.map(([x, z]) => new Vector2(x, z)), [])
  const triangles: Triangle[] = indices.map(([i, j, k]) => cross(loop[i], loop[j], loop[k]) >= 0
    ? [loop[i], loop[j], loop[k]] : [loop[i], loop[k], loop[j]])
  return { top: surface(source, triangles, center), sides: prism(loop, triangles, center, depth, rimSeed), center }
}
