import { distance, segmentBox, wrapAngle } from './geometry';
import { floorHeight } from './level';
import type { DoorState, Floor, KnockLevel, NoiseEvent, SoundCue, Vec3 } from './types';
export interface AcousticPath { distance: number; residual: number; virtualSource: Vec3; occluded: boolean; channel: boolean; portals: string[] }

interface LocalPath { distance: number; virtualSource: Vec3; occluded: boolean }
interface ZoneGeometry {
 level: KnockLevel;
 height: number;
 points?: Vec3[];
 edges: Map<string, number>;
 routes: Map<string, LocalPath | null>;
}
// Levels are immutable authored geometry. These bounded, derived caches are
// independent of mission state; door state remains in the outer portal graph.
const geometryCache = new WeakMap<KnockLevel, Map<string, ZoneGeometry>>();
const pointKey = (p: Vec3): string => `${p.x},${p.y},${p.z}`;
function zoneGeometry(level: KnockLevel, zoneId: string, echoOnly: boolean): ZoneGeometry {
 let zones = geometryCache.get(level);
 if (!zones) { zones = new Map(); geometryCache.set(level, zones); }
 const key = `${zoneId}:${echoOnly ? 'echo' : 'sound'}`;
 let geometry = zones.get(key);
 if (!geometry) {
  geometry = { level: { ...level, floors: level.floors.filter(f => f.zoneId === zoneId), walls: level.walls.filter(w => w.zoneId === zoneId), portals: [] }, height: echoOnly ? 0.05 : 1.4, edges: new Map(), routes: new Map() };
  zones.set(key, geometry);
 }
 return geometry;
}
/** Exact projected floor coverage prevents a diagonal from crossing a void
 * between two corridor arms that happen to share the same room zone ID. */
function floorInterval(floor: Floor, from: Vec3, to: Vec3): [number, number] | null {
 let near = 0, far = 1;
 for (const axis of ['x', 'z'] as const) {
  const half = (axis === 'x' ? floor.width : floor.depth) / 2 + 0.0001;
  const delta = to[axis] - from[axis], low = floor[axis] - half, high = floor[axis] + half;
  if (Math.abs(delta) < 1e-8) { if (from[axis] < low || from[axis] > high) return null; continue; }
  const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
  near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
  if (near > far) return null;
 }
 for (const t of [near, far]) {
  const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t, y = from.y + (to.y - from.y) * t;
  if (y < floorHeight(floor, x, z) - 0.04) return null;
 }
 return [near, far];
}
function clearSegment(geometry: ZoneGeometry, from: Vec3, to: Vec3): boolean {
 // Closed doors are crossed only by explicit portal edges and charged there.
 if (geometry.level.walls.some(wall => segmentBox(from, to, wall.position, wall.size))) return false;
 const intervals = geometry.level.floors.flatMap(f => { const span = floorInterval(f, from, to); return span ? [span] : []; }).sort((a, b) => a[0] - b[0]);
 let covered = 0;
 for (const [near, far] of intervals) { if (near > covered + 1e-5) return false; covered = Math.max(covered, far); if (covered >= 1 - 1e-5) return true; }
 return false;
}
function cornerPoints(geometry: ZoneGeometry): Vec3[] {
 if (geometry.points) return geometry.points;
 const points = new Map<string, Vec3>(), level = geometry.level;
 const add = (x: number, z: number): void => {
  const floor = level.floors.find(f => x >= f.x - f.width / 2 && x <= f.x + f.width / 2 && z >= f.z - f.depth / 2 && z <= f.z + f.depth / 2);
  if (!floor) return;
  const point = { x, y: floorHeight(floor, x, z) + geometry.height, z };
  if (clearSegment(geometry, point, point)) points.set(pointKey(point), point);
 };
 const zoneId = level.floors[0]?.zoneId, zone = level.zones.find(z => z.id === zoneId);
 if (zone) add(zone.center.x, zone.center.z);
 // Ramp centers retain actual floor heights at changes in slope.
 for (const floor of level.floors.filter(f => f.corridor)) add(floor.x, floor.z);
 // Mesh/echo wall chunks overlap along straight boundaries. Their internal
 // joints are not physical corners and need not enlarge the visibility graph.
 const boxes = level.walls.map(wall => ({ left: wall.position.x - wall.size.x / 2, right: wall.position.x + wall.size.x / 2, front: wall.position.z - wall.size.z / 2, back: wall.position.z + wall.size.z / 2, bottom: wall.position.y - wall.size.y / 2, top: wall.position.y + wall.size.y / 2 }));
 const equal = (a: number, b: number) => Math.abs(a - b) < 1e-7;
 let merged = true;
 while (merged) {
  merged = false;
  for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
   const a = boxes[i], b = boxes[j];
   if (!equal(a.bottom, b.bottom) || !equal(a.top, b.top)) continue;
   const vertical = equal(a.left, b.left) && equal(a.right, b.right) && a.front <= b.back && b.front <= a.back;
   const horizontal = equal(a.front, b.front) && equal(a.back, b.back) && a.left <= b.right && b.left <= a.right;
   if (!vertical && !horizontal) continue;
   boxes[i] = { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), front: Math.min(a.front, b.front), back: Math.max(a.back, b.back), bottom: a.bottom, top: a.top };
   boxes.splice(j, 1); merged = true; break;
  }
 }
 for (const wall of boxes) for (const x of [wall.left - 0.025, wall.right + 0.025]) for (const z of [wall.front - 0.025, wall.back + 0.025]) {
  add(x, z);
 }
 geometry.points = [...points.values()]; return geometry.points;
}
/** Shortest route on the physical corner visibility graph inside one zone.
 * A direct unobstructed ray is exact and keeps the actual sound source. */
function localPath(level: KnockLevel, zoneId: string, from: Vec3, to: Vec3, echoOnly: boolean): LocalPath | null {
 const geometry = zoneGeometry(level, zoneId, echoOnly), key = `${pointKey(from)}>${pointKey(to)}`;
 if (geometry.routes.has(key)) return geometry.routes.get(key)!;
 let result: LocalPath | null = null;
 if (clearSegment(geometry, from, to)) result = { distance: distance(from, to), virtualSource: from, occluded: false };
 else {
  const points = cornerPoints(geometry), costs = points.map(point => clearSegment(geometry, from, point) ? distance(from, point) : Infinity), visited = new Set<number>();
  while (visited.size < points.length) {
   let index = -1, cost = Infinity;
   for (let i = 0; i < points.length; i++) if (!visited.has(i) && costs[i] < cost) { index = i; cost = costs[i]; }
   if (index < 0 || (result && cost >= result.distance)) break;
   visited.add(index); const point = points[index];
   if (clearSegment(geometry, point, to)) {
    const total = cost + distance(point, to);
    if (!result || total < result.distance) result = { distance: total, virtualSource: point, occluded: true };
   }
   for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    const edgeKey = index < i ? `${index}:${i}` : `${i}:${index}`;
    let length = geometry.edges.get(edgeKey);
    if (length === undefined) { length = clearSegment(geometry, point, points[i]) ? distance(point, points[i]) : Infinity; geometry.edges.set(edgeKey, length); }
    if (cost + length < costs[i]) costs[i] = cost + length;
   }
  }
 }
 if (geometry.routes.size >= 256) geometry.routes.delete(geometry.routes.keys().next().value!);
 geometry.routes.set(key, result); return result;
}
/** Portal-state Dijkstra: distance is measured between actual portal transforms, never room centres. */
export function acousticPath(level:KnockLevel,doors:DoorState[],source:Vec3,sourceZone:string,target:Vec3,targetZone:string,power:number,echoOnly=false):AcousticPath|null {
 type Node={key:string;zone:string;point:Vec3;cost:number;via:string[];channel:boolean;occluded:boolean};
 const queue:Node[]=[{key:`start:${sourceZone}`,zone:sourceZone,point:source,cost:0,via:[],channel:false,occluded:false}];const best=new Map<string,number>();let result:AcousticPath|null=null;
 while(queue.length){queue.sort((a,b)=>a.cost-b.cost);const current=queue.shift()!;if(current.cost>(best.get(current.key)??Infinity))continue;if(result&&current.cost>=result.distance)continue;
  if(current.zone===targetZone){const route=localPath(level,current.zone,current.point,target,echoOnly);if(route){const cost=current.cost+route.distance;if(!result||cost<result.distance)result={distance:cost,residual:power-4*cost,virtualSource:route.occluded?route.virtualSource:current.via.length?current.point:source,occluded:current.occluded||route.occluded||current.via.length>0,channel:current.channel,portals:current.via};}}
  for(const p of level.portals){const next=p.a===current.zone?p.b:p.b===current.zone?p.a:null;if(!next)continue;const door=doors.find(d=>d.id===p.id);const closed=p.door&&(!door?.open||door.moving);if(echoOnly&&(closed||p.channel))continue;
   const center={...p.position,y:p.position.y+(echoOnly?0:1.4)};const here=p.channel?(p.a===current.zone?p.aPoint:p.bPoint):center;const there=p.channel?(p.a===current.zone?p.bPoint:p.aPoint):center;
   const passage=p.channel?4+p.channelLength:echoOnly?0:p.door?(closed?7:1.5):0;
   if(result&&current.cost+distance(current.point,here)+passage>=result.distance)continue;
   const route=localPath(level,current.zone,current.point,here,echoOnly);if(!route)continue;
   const cost=current.cost+route.distance+passage;const key=`${next}:${p.id}`;if(cost>=(best.get(key)??Infinity))continue;best.set(key,cost);queue.push({key,zone:next,point:there,cost,via:[...current.via,p.id],channel:current.channel||p.channel,occluded:current.occluded||route.occluded||Boolean(closed)||p.channel});
  }
 }return result;
}
export function cueForNoise(level:KnockLevel,doors:DoorState[],noise:NoiseEvent,observer:{position:Vec3;zoneId:string;yaw:number}):SoundCue|null {
 const ear={...observer.position,y:observer.position.y+1.4};
 // Physical paths and authored channels cannot beat straight-line distance.
 if(noise.power-4*distance(noise.position,ear)<8)return null;
 const path=acousticPath(level,doors,noise.position,noise.zoneId,ear,observer.zoneId,noise.power);if(!path||path.residual<8)return null;
 const dx=path.virtualSource.x-observer.position.x,dz=path.virtualSource.z-observer.position.z;const bearing=Math.atan2(-dx,-dz);const relative=wrapAngle(bearing-observer.yaw);const direction=Math.abs(relative)<Math.PI/4?'ahead':Math.abs(relative)>3*Math.PI/4?'behind':relative>0?'left':'right';
 const dy=path.virtualSource.y-observer.position.y-1.4;
 return {id:noise.id,tick:noise.tick,at:noise.at,type:noise.type,position:{...path.virtualSource},strength:path.residual>=40?'loud':path.residual>=22?'medium':'soft',residual:path.residual>=40?44:path.residual>=22?28:12,occluded:path.occluded,channel:path.channel,direction,elevation:dy>1?'above':dy< -1?'below':'level'};
}
