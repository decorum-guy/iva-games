import { floorAt, floorHeight, PLAYER_RADIUS } from './level';
import type { Battery, DoorState, KnockLevel, Vec3 } from './types';

export const distance = (a:Vec3,b:Vec3) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export const distanceXZ = (a:Vec3,b:Vec3) => Math.hypot(a.x-b.x,a.z-b.z);
export const copy = (p:Vec3):Vec3 => ({x:p.x,y:p.y,z:p.z});
export const clamp = (n:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,n));
export function normalize(x:number,z:number):{x:number;z:number} {const l=Math.hypot(x,z);return l>0.00001?{x:x/l,z:z/l}:{x:0,z:0};}
export function wrapAngle(a:number):number {return Math.atan2(Math.sin(a),Math.cos(a));}
export function approachAngle(current:number,target:number,maxDelta:number):number {return current+clamp(wrapAngle(target-current),-maxDelta,maxDelta);}
export function batteryHandlePositions(battery:Pick<Battery,'position'|'yaw'>,foot=false):[Vec3,Vec3] {
 const d=foot?0.93:0.62,c=Math.cos(battery.yaw),s=Math.sin(battery.yaw);
 return [-1,1].map(sign=>({x:battery.position.x+sign*d*c,y:battery.position.y+(foot?0:0.65),z:battery.position.z-sign*d*s})) as [Vec3,Vec3];
}
function inDoor(level:KnockLevel,doors:DoorState[],p:Vec3,radius:number):boolean {
 for(const d of doors){if(d.open&&!d.moving)continue;const door=level.portals.find(v=>v.id===d.id);if(!door)continue;
  const dx=p.x-door.position.x,dz=p.z-door.position.z;const along=dx*Math.cos(door.yaw)-dz*Math.sin(door.yaw),across=dx*Math.sin(door.yaw)+dz*Math.cos(door.yaw);
  if(Math.abs(along)<door.width/2+radius&&Math.abs(across)<0.18+radius&&p.y<door.position.y+3.0&&p.y+1.72>door.position.y)return true;
 }return false;
}
export function canOccupy(level:KnockLevel,doors:DoorState[],p:Vec3,radius=PLAYER_RADIUS):boolean {
 const center=floorAt(level,p.x,p.z);if(!center)return false;const cy=floorHeight(center,p.x,p.z);
 for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[0.707,0.707],[-0.707,0.707],[0.707,-0.707],[-0.707,-0.707]]){
  const f=floorAt(level,p.x+dx*radius,p.z+dz*radius);if(!f)return false;
  if(Math.abs(floorHeight(f,p.x+dx*radius,p.z+dz*radius)-cy)>0.24)return false;
 }
 for(const w of level.walls){if(cy+1.72<=w.position.y-w.size.y/2||cy>=w.position.y+w.size.y/2)continue;const dx=Math.max(Math.abs(p.x-w.position.x)-w.size.x/2,0),dz=Math.max(Math.abs(p.z-w.position.z)-w.size.z/2,0);if(dx*dx+dz*dz<radius*radius-1e-8)return false;}
 return !inDoor(level,doors,{...p,y:cy},radius);
}
export function snapToFloor(level:KnockLevel,p:Vec3):Vec3|null {const floor=floorAt(level,p.x,p.z);return floor?{x:p.x,y:floorHeight(floor,p.x,p.z),z:p.z}:null;}
export function moveCapsule(level:KnockLevel,doors:DoorState[],from:Vec3,dx:number,dz:number,radius=PLAYER_RADIUS):Vec3 {
 const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/0.12));let at=copy(from);
 for(let i=0;i<steps;i++){
  const full=snapToFloor(level,{x:at.x+dx/steps,y:at.y,z:at.z+dz/steps});
  if(full&&Math.abs(full.y-at.y)<=0.24&&canOccupy(level,doors,full,radius)){at=full;continue;}
  const px=snapToFloor(level,{x:at.x+dx/steps,y:at.y,z:at.z});if(px&&Math.abs(px.y-at.y)<=0.24&&canOccupy(level,doors,px,radius))at=px;
  const pz=snapToFloor(level,{x:at.x,y:at.y,z:at.z+dz/steps});if(pz&&Math.abs(pz.y-at.y)<=0.24&&canOccupy(level,doors,pz,radius))at=pz;
 }return at;
}
export function batteryFits(level:KnockLevel,doors:DoorState[],position:Vec3,yaw:number,holders:[string|null,string|null]):boolean {
 const center=snapToFloor(level,position);if(!center)return false;const c=Math.cos(yaw),s=Math.sin(yaw);
 for(const [x,z] of [[0,0],[-0.475,-0.275],[-0.475,0.275],[0.475,-0.275],[0.475,0.275],[0.475,0],[-0.475,0],[0,0.275],[0,-0.275]]){
  const p={x:center.x+x*c+z*s,y:center.y,z:center.z-x*s+z*c};if(!canOccupy(level,doors,p,0.035))return false;
 }
 const feet=batteryHandlePositions({position:center,yaw},true);
 return holders.every((id,index)=>id===null||canOccupy(level,doors,feet[index]));
}
export function sweepBattery(level:KnockLevel,doors:DoorState[],battery:Battery,to:Vec3,targetYaw:number):{position:Vec3;yaw:number;blocked:boolean} {
 const steps=Math.max(1,Math.ceil(distanceXZ(battery.position,to)/0.08),Math.ceil(Math.abs(wrapAngle(targetYaw-battery.yaw))/0.06));let position=copy(battery.position),yaw=battery.yaw;
 for(let i=1;i<=steps;i++){const t=i/steps;const next=snapToFloor(level,{x:battery.position.x+(to.x-battery.position.x)*t,y:battery.position.y,z:battery.position.z+(to.z-battery.position.z)*t});const angle=battery.yaw+wrapAngle(targetYaw-battery.yaw)*t;if(!next||Math.abs(next.y-position.y)>0.24||!batteryFits(level,doors,next,angle,battery.holders))return {position,yaw,blocked:true};position=next;yaw=angle;}
 return {position,yaw,blocked:false};
}
export function segmentBox(from:Vec3,to:Vec3,center:Vec3,size:Vec3):boolean {
 let near=0,far=1;for(const axis of ['x','y','z'] as const){const delta=to[axis]-from[axis],min=center[axis]-size[axis]/2,max=center[axis]+size[axis]/2;
  if(Math.abs(delta)<1e-8){if(from[axis]<min||from[axis]>max)return false;continue;}
  let a=(min-from[axis])/delta,b=(max-from[axis])/delta;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return false;
 }return far>0.002&&near<0.998;
}
export function lineOfSight(level:KnockLevel,doors:DoorState[],from:Vec3,to:Vec3,ignoredWallIds:string[]=[]):boolean {
 for(const wall of level.walls)if(!ignoredWallIds.includes(wall.id)&&segmentBox(from,to,wall.position,wall.size))return false;
 for(const d of doors){if(d.open&&!d.moving)continue;const p=level.portals.find(p=>p.id===d.id);if(p&&segmentBox(from,to,{x:p.position.x,y:p.position.y+1.5,z:p.position.z},{x:p.yaw?0.32:p.width,y:3,z:p.yaw?p.width:0.32}))return false;}
 const n=Math.ceil(distance(from,to)/0.5);for(let i=1;i<n;i++){const t=i/n,x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t,y=from.y+(to.y-from.y)*t;const f=floorAt(level,x,z);if(f&&y<floorHeight(f,x,z)-0.04)return false;}
 return true;
}
export function pointInLift(level:KnockLevel,p:Vec3):boolean {const z=level.zones.find(z=>z.safe)!;return Math.abs(p.x-z.center.x)<=z.width/2-0.3&&Math.abs(p.z-z.center.z)<=z.depth/2-0.3&&Math.abs(p.y-z.center.y)<0.5;}
/** Grid graph waypoints have physical floor/portal transforms; never use a channel for movement. */
export function navigationPath(level:KnockLevel,from:Vec3,to:Vec3,options:{allowClosed?:boolean;doors?:DoorState[];knownZones?:string[];avoidLift?:boolean}={}):Vec3[] {
 const startFloor=floorAt(level,from.x,from.z),endFloor=floorAt(level,to.x,to.z);const start=startFloor?.zoneId,end=endFloor?.zoneId;if(!start||!end)return [];
 const corridorPortal=(floor:typeof startFloor)=>floor?.corridor?level.portals.find(p=>floor.id.startsWith(`corridor-${p.id}-`))?.id:null;
 if(start===end){if((startFloor?.corridor||endFloor?.corridor)&&corridorPortal(startFloor)!==corridorPortal(endFloor))return [copy(level.zones.find(z=>z.id===start)!.center),copy(to)];return [copy(to)];}
 const costs:Record<string,number>={[start]:0};const previous:Record<string,{zone:string;portal:string}>={};const pending=new Set([start]);
 while(pending.size){const current=[...pending].sort((a,b)=>costs[a]-costs[b])[0];pending.delete(current);if(current===end)break;for(const p of level.portals){if(p.channel)continue;const next:string|null=p.a===current?p.b:p.b===current?p.a:null;if(!next)continue;if(options.avoidLift&&next===level.safeZoneId)continue;if(options.knownZones&&!options.knownZones.includes(next)&&next!==end)continue;if(!options.allowClosed&&options.doors?.some(d=>d.id===p.id&&(!d.open||d.moving)))continue;const a=level.zones.find(z=>z.id===current)!,b=level.zones.find(z=>z.id===next)!;const cost=costs[current]+distance(a.center,b.center);if(cost<(costs[next]??Infinity)){costs[next]=cost;previous[next]={zone:current,portal:p.id};pending.add(next);}}}
 if(!previous[end])return [];const route:{zone:string;portal:string}[]=[];let zone=end;while(zone!==start){const p=previous[zone];if(!p)return [];route.unshift({zone,portal:p.portal});zone=p.zone;}
 const points:Vec3[]=[];if(startFloor?.corridor&&corridorPortal(startFloor)!==route[0]?.portal)points.push(copy(level.zones.find(z=>z.id===start)!.center));for(const item of route){const p=level.portals.find(p=>p.id===item.portal)!;const entering=p.b===item.zone;points.push(copy(entering?p.aPoint:p.bPoint),copy(p.position),copy(entering?p.bPoint:p.aPoint));if(item.zone!==end||endFloor?.corridor&&corridorPortal(endFloor)!==item.portal)points.push(copy(level.zones.find(z=>z.id===item.zone)!.center));}points.push(copy(to));return points;
}
