import {
  BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3,
} from 'three'

type Vertex = { p: Vector3; n: Vector3; uv: Vector2; uv1: Vector2 }
type Face = { vertices: Vertex[]; interior: boolean }
type Cut = { axis: Vector3; offset: number; bottom: number; top: number; planar?: boolean; notch?: { height: number; slope: number; above?: number } }

function cut(x: number, y: number, z: number, offset: number, bottom = -1, top = 2): Cut {
  const axis = new Vector3(x, y, z)
  return { offset: offset / axis.length(), axis: axis.normalize(), bottom, top }
}

// The height bands end in the narrow turned sections of the original king. Each
// plane intersects only the ornament it breaks, even when the foot is wider.
const cuts = [
  cut(1.05, 1, .34, 1.552, 1.40),
  { ...cut(-.78, 0, .63, .083, 1.122, 1.400), notch: { height: 1.319, slope: .56 } },
  { ...cut(.89, 0, -.46, .082, 1.122, 1.400), notch: { height: 1.310, slope: .50 } },
  cut(.47, .025, .88, .161, .84, 1.143),
  cut(-.78, .05, -.63, .184, .84, 1.143),
  cut(.74, -.32, .67, .035, -1, .53),
  cut(-.74, -.29, -.67, .046, -1, .53),
  { ...cut(-.82, -.27, .57, .135, -1, .53), planar: true },
  { ...cut(.75, 0, .66, .026), notch: { height: .724, slope: .76 } },
  { ...cut(-.48, 0, -.88, .032), notch: { height: .596, slope: .92 } },
  { ...cut(-.90, 0, .43, .033), notch: { height: .888, slope: 1.04, above: 3.4 } },
]

function interpolate(a: Vertex, b: Vertex, t: number): Vertex {
  return { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(),
    uv: a.uv.clone().lerp(b.uv, t), uv1: a.uv1.clone().lerp(b.uv1, t) }
}

function pack(faces: Face[], origin = new Vector3()) {
  const geometry = new BufferGeometry()
  const p: number[] = [], n: number[] = [], uv: number[] = [], uv1: number[] = []
  for (const interior of [false, true]) {
    const start = p.length / 3
    for (const face of faces) {
      if (face.interior !== interior) continue
      for (let k = 1; k < face.vertices.length - 1; k++) {
        for (const v of [face.vertices[0], face.vertices[k], face.vertices[k + 1]]) {
          p.push(v.p.x - origin.x, v.p.y - origin.y, v.p.z - origin.z)
          n.push(v.n.x, v.n.y, v.n.z)
          uv.push(v.uv.x, v.uv.y); uv1.push(v.uv1.x, v.uv1.y)
        }
      }
    }
    geometry.addGroup(start, p.length / 3 - start, Number(interior))
  }
  geometry.setAttribute('position', new Float32BufferAttribute(p, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(n, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setAttribute('uv1', new Float32BufferAttribute(uv1, 2))
  geometry.computeBoundingSphere()
  return geometry
}

const pointKey = (p: Vector3) => [p.x, p.y, p.z].map(v => Math.round(v * 1e6)).join('/')

function closeCut(segments: Vector3[][], axis: Vector3, stone: Face[], chip: Face[]) {
  const nodes = new Map<string, { point: Vector3; neighbors: Set<string> }>()
  for (const [a, b] of segments) {
    const ka = pointKey(a), kb = pointKey(b)
    if (ka === kb) continue
    if (!nodes.has(ka)) nodes.set(ka, { point: a, neighbors: new Set() })
    if (!nodes.has(kb)) nodes.set(kb, { point: b, neighbors: new Set() })
    nodes.get(ka)!.neighbors.add(kb); nodes.get(kb)!.neighbors.add(ka)
  }
  const u = new Vector3().crossVectors(axis, new Vector3(0, 1, 0)).normalize()
  const v = new Vector3().crossVectors(axis, u)
  const visited = new Set<string>()
  for (const [start] of nodes) {
    if (visited.has(start)) continue
    const ring: Vector3[] = []
    let current: string | undefined = start
    while (current !== undefined && !visited.has(current)) {
      visited.add(current)
      const node: { point: Vector3; neighbors: Set<string> } = nodes.get(current)!
      ring.push(node.point)
      current = [...node.neighbors].find(key => !visited.has(key))
    }
    if (ring.length < 3) continue
    const flat = ring.map(p => new Vector2(p.dot(u), p.dot(v)))
    function roughen(p: Vector3) {
      const x = p.dot(u), y = p.dot(v)
      let edge = Infinity
      for (let i = 0; i < flat.length; i++) {
        const a = flat[i], b = flat[(i + 1) % flat.length]
        const dx = b.x - a.x, dy = b.y - a.y
        const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)))
        edge = Math.min(edge, Math.hypot(x - a.x - t * dx, y - a.y - t * dy))
      }
      const grain = .68 + .19 * Math.sin(95 * x + 43 * y)
      return p.addScaledVector(axis, -Math.min(.050, edge * grain))
    }
    for (const tri of ShapeUtils.triangulateShape(flat, [])) {
      const [a, b, c] = tri.map(i => ring[i])
      const middle = roughen(a.clone().add(b).add(c).multiplyScalar(1 / 3))
      const outline: Vector3[] = []
      for (let i = 0; i < 3; i++) {
        const first = tri[i], second = tri[(i + 1) % 3]
        outline.push(ring[first])
        const distance = Math.abs(first - second)
        if (distance > 1 && distance < ring.length - 1) {
          outline.push(roughen(ring[first].clone().lerp(ring[second], .5)))
        }
      }
      for (let i = 0; i < outline.length; i++) {
        const first = outline[i], second = outline[(i + 1) % outline.length]
        const normal = second.clone().sub(first).cross(middle.clone().sub(first)).normalize()
        const points = normal.dot(axis) >= 0 ? [first, second, middle] : [second, first, middle]
        if (normal.dot(axis) < 0) normal.negate()
        const surface = (p: Vector3, n: Vector3) => ({ p, n, uv: new Vector2(p.dot(u), p.dot(v)), uv1: new Vector2() })
        stone.push({ vertices: points.map(p => surface(p, normal)), interior: true })
        chip.push({ vertices: points.toReversed().map(p => surface(p, normal.clone().negate())), interior: true })
      }
    }
  }
}

function cutDistance({ axis, offset, notch, planar }: Cut, p: Vector3) {
  const lateral = p.x * axis.z - p.z * axis.x
  const splinter = planar ? 0 : .010 * Math.sin(47 * p.y + 28 * lateral) + .006 * Math.sin(74 * lateral - 33 * p.y)
  return axis.dot(p) - offset + splinter - (notch ? (p.y > notch.height ? notch.above ?? notch.slope : notch.slope) * Math.abs(p.y - notch.height) : 0)
}

function rotateCuts(angle: number) {
  const vertical = new Vector3(0, 1, 0)
  return cuts.map(tool => ({ ...tool, axis: tool.axis.clone().applyAxisAngle(vertical, angle) }))
}

function fracture(source: BufferGeometry, tools: Cut[]) {
  const pos = source.getAttribute('position'), normals = source.getAttribute('normal')
  const tex = source.getAttribute('uv'), tex1 = source.getAttribute('uv1') ?? tex
  const vertices = Array.from({ length: pos.count }, (_, i) => ({
    p: new Vector3().fromBufferAttribute(pos, i), n: new Vector3().fromBufferAttribute(normals, i),
    uv: new Vector2(tex.getX(i), tex.getY(i)), uv1: new Vector2(tex1.getX(i), tex1.getY(i)),
  }))
  let faces: Face[] = []
  const index = source.index
  for (let i = 0; i < (index?.count ?? pos.count); i += 3) {
    faces.push({ vertices: [0, 1, 2].map(k => vertices[index ? index.getX(i + k) : i + k]), interior: false })
  }
  const chips = tools.map(tool => {
    const { axis, bottom, top } = tool
    const stone: Face[] = [], chip: Face[] = [], segments: Vector3[][] = []
    for (const face of faces) {
      const loop = face.vertices
      const h = loop.reduce((sum, v) => sum + v.p.y, 0) / loop.length
      if (h < bottom || h > top) { stone.push(face); continue }
      const distances = loop.map(({ p }) => cutDistance(tool, p))
      if (distances.every(d => d <= 0)) { stone.push(face); continue }
      if (distances.every(d => d > 0)) { chip.push(face); continue }
      const keep: Vertex[] = [], lose: Vertex[] = [], seam: Vector3[] = []
      for (let i = 0; i < loop.length; i++) {
        const j = (i + 1) % loop.length
        ;(distances[i] > 0 ? lose : keep).push(loop[i])
        if ((distances[i] > 0) === (distances[j] > 0)) continue
        const split = interpolate(loop[i], loop[j], distances[i] / (distances[i] - distances[j]))
        keep.push(split); lose.push(split); seam.push(split.p)
      }
      stone.push({ ...face, vertices: keep }); chip.push({ ...face, vertices: lose })
      segments.push(seam)
    }
    closeCut(segments, axis, stone, chip)
    faces = stone
    const center = new Vector3()
    let count = 0
    for (const f of chip) for (const v of f.vertices) { center.add(v.p); count++ }
    center.divideScalar(Math.max(1, count))
    return { geometry: pack(chip, center), center, direction: axis }
  })
  return { body: pack(faces), chips }
}

const cache = new WeakMap<BufferGeometry, Map<string, ReturnType<typeof fracture>>>()

/** Keep the original foot and crown contact patches under the settled model.
 * Rotate the strikes around the intact king, leaving its pose and UVs fixed. */
export function kingFracture(source: BufferGeometry, fall?: { dx: number; dz: number; angle: number }) {
  let angle = 0
  const contacts: Vector3[] = []
  if (fall) {
    const positions = source.getAttribute('position')
    contacts.push(new Vector3(), new Vector3())
    const heights = [Infinity, Infinity]
    const p = new Vector3(), sin = Math.sin(fall.angle), cos = Math.cos(fall.angle)
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i)
      const zone = Number(p.y > .8)
      const height = p.y * cos - (p.x * fall.dx + p.z * fall.dz) * sin
      if (height < heights[zone]) { heights[zone] = height; contacts[zone].copy(p) }
    }
    let best = -Infinity
    for (let i = 0; i < 32; i++) {
      const candidate = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 16
      const tools = rotateCuts(candidate)
      let clearance = Infinity
      for (const contact of contacts) for (const tool of tools) {
        if (contact.y >= tool.bottom && contact.y <= tool.top) clearance = Math.min(clearance, -cutDistance(tool, contact))
      }
      if (clearance > best) { best = clearance; angle = candidate }
      if (clearance >= .012) break
    }
  }
  const tools = rotateCuts(angle)
  for (const tool of tools) {
    let guard = 0
    for (const contact of contacts) {
      if (contact.y >= tool.bottom && contact.y <= tool.top) {
        guard = Math.max(guard, cutDistance(tool, contact) + .008)
      }
    }
    tool.offset += Math.ceil(guard * 1000) / 1000
  }
  const key = [angle, ...tools.map(tool => tool.offset)].join('/')
  let variants = cache.get(source)
  if (!variants) { variants = new Map(); cache.set(source, variants) }
  let result = variants.get(key)
  if (!result) {
    result = fracture(source, tools)
    variants.set(key, result)
  }
  return result
}
