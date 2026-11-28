import type { EchoCluster, Floor, KnockLevel, Portal, RouteId, Vec3, Wall, Zone } from './types';

export const TICK_RATE = 30;
export const STEP_SECONDS = 1 / TICK_RATE;
export const BATTERY_SIZE = { x: 0.95, y: 0.43, z: 0.55 };
export const PLAYER_RADIUS = 0.28;
export const PLAYER_HEIGHT = 1.72;
export const DIFFICULTIES = {
  calm: { hearing: 22, chaseSpeed: 3.3, charges: 3, downedSeconds: 32 },
  normal: { hearing: 16, chaseSpeed: 3.65, charges: 2, downedSeconds: 25 },
  tense: { hearing: 12, chaseSpeed: 3.95, charges: 2, downedSeconds: 21 },
} as const;

type RoomSeed = [string, number, number, number?, Floor['material']?];
interface Plan { id: KnockLevel['id']; name: Zone['name']; rooms: RoomSeed[]; edges: string[]; closed: string[]; resonators: string[]; pedestals: [string[],string[]]; patrol: string[]; channel?: [string,string] }
const pairKey = (a: string,b: string) => [a,b].sort().join('-');
const plans: Plan[] = [
  { id:'archive',name:{ru:'Затопленный архив',en:'Flooded Archive'}, rooms:[['L',1,3],['H',1,2],['T',0,2],['C',0,1],['A',0,0],['P',2,2,0,'metal'],['W',2,1,0,'water'],['B',2,0],['X',1,1,0,'metal'],['I',1,0]],edges:['L-H','H-T','H-P','H-X','T-C','C-A','C-X','P-W','W-B','W-X','A-I','B-I','I-X'],closed:['C-X','W-X'],resonators:['P','I','X'],pedestals:[['A','C'],['B','W']],patrol:['I','A','C','X','W','B','I'] },
  { id:'pump',name:{ru:'Насосный узел',en:'Pump Station'},rooms:[['L',0,3],['D',0,2],['H',1,2],['R',1,1,2.6,'metal'],['A',1,0,2.6],['S',0,1,2.6],['K',0,0,2.6],['W',2,2,0,'water'],['C',2,1,0,'water'],['B',2,0],['T',1,3],['U',2,3,0,'metal']],edges:['L-D','L-T','D-H','D-S','H-T','H-W','H-R','R-A','R-C','R-S','S-K','K-A','W-U','W-C','U-T','C-B'],closed:['L-T'],resonators:['W','R','U'],pedestals:[['A','S'],['B','W']],patrol:['C','W','H','R','C'] },
  { id:'relay',name:{ru:'Релейное крыло',en:'Relay Wing'},rooms:[['L',1,3],['H',1,2],['G',1,1,0,'metal'],['A',1,0],['S',0,2,2.2,'metal'],['C',0,1],['D',0,0],['W',2,2,0,'water'],['P',2,1],['B',2,0]],edges:['L-H','H-G','H-S','H-W','G-A','G-C','G-P','C-D','C-S','D-A','W-P','P-B','B-A'],closed:['B-A'],resonators:['G','S','B'],pedestals:[['A','D'],['B','P']],patrol:['D','C','G','P','B','A','D'],channel:['S','P'] },
  { id:'tutorial',name:{ru:'Учебный отсек',en:'Training Annex'},rooms:[['L',0,1],['H',0,0],['T',1,0]],edges:['L-H','H-T'],closed:['H-T'],resonators:['L','H'],pedestals:[['H'],['T']],patrol:['T','H','T'] },
];
const names: Record<string,Zone['name']> = {
 L:{ru:'Лифт',en:'Lift'}, H:{ru:'Развилка',en:'Junction'}, T:{ru:'Сухой обход',en:'Dry Bypass'}, C:{ru:'Каталог',en:'Catalogue'}, A:{ru:'Северный архив',en:'North Archive'}, B:{ru:'Восточный архив',en:'East Archive'}, P:{ru:'Трубный переход',en:'Pipe Passage'}, W:{ru:'Мокрая галерея',en:'Wet Gallery'}, X:{ru:'Поперечный переход',en:'Cross Passage'}, I:{ru:'Хранилище пломб',en:'Seal Storage'}, D:{ru:'Сухой шлюз',en:'Dry Airlock'}, R:{ru:'Верхняя площадка',en:'Upper Landing'}, S:{ru:'Смотровой помост',en:'Observation Deck'}, K:{ru:'Инструментальная',en:'Tool Store'}, U:{ru:'Нижний тоннель',en:'Lower Tunnel'}, G:{ru:'Релейная галерея',en:'Relay Gallery'},
};
const v = (x:number,y:number,z:number):Vec3 => ({x,y,z});
function buildLevel(plan:Plan):KnockLevel {
 const zones:Zone[] = plan.rooms.map(([id,c,r,y=0,material='concrete']) => ({id,name:names[id],center:v(c*18,y,r*18),width:10,depth:10,material,safe:id==='L',lightRadius:id==='L'?7:2.0}));
 const zone=(id:string)=>zones.find(z=>z.id===id)!;
 const portals:Portal[]=plan.edges.map(edge=>{
   const [a,b]=edge.split('-'); const pa=zone(a).center,pb=zone(b).center; const dx=Math.sign(pb.x-pa.x),dz=Math.sign(pb.z-pa.z);
   const aPoint=v(pa.x+dx*5,pa.y,pa.z+dz*5),bPoint=v(pb.x-dx*5,pb.y,pb.z-dz*5);
   return {id:pairKey(a,b),a,b,aPoint,bPoint,position:v((pa.x+pb.x)/2,(pa.y+pb.y)/2,(pa.z+pb.z)/2),width:3,yaw:dx?Math.PI/2:0,door:plan.closed.some(e=>pairKey(...e.split('-') as [string,string])===pairKey(a,b)),initiallyClosed:plan.closed.some(e=>pairKey(...e.split('-') as [string,string])===pairKey(a,b)),channel:false,channelLength:0};
 });
 if(plan.channel){const [a,b]=plan.channel;const pa=zone(a).center,pb=zone(b).center;portals.push({id:`vent-${pairKey(a,b)}`,a,b,aPoint:v(pa.x+4.6,pa.y+2.4,pa.z),bPoint:v(pb.x-4.6,pb.y+2.4,pb.z),position:v((pa.x+pb.x)/2,(pa.y+pb.y)/2+2.4,(pa.z+pb.z)/2),width:0.35,yaw:Math.PI/2,door:false,initiallyClosed:false,channel:true,channelLength:Math.hypot(pb.x-pa.x,pb.y-pa.y,pb.z-pa.z)});}
 const floors:Floor[]=[];const walls:Wall[]=[];
 // Finite compact floor/edge clusters allow the renderer to reveal actual nearby geometry.
 for(const z of zones){for(let ix=0;ix<4;ix++)for(let iz=0;iz<4;iz++)floors.push({id:`floor-${z.id}-${ix}-${iz}`,zoneId:z.id,x:z.center.x-3.75+ix*2.5,z:z.center.z-3.75+iz*2.5,width:2.5,depth:2.5,y:z.center.y,slopeX:0,slopeZ:0,material:z.material,corridor:false});
   const openings=portals.filter(p=>!p.channel&&(p.a===z.id||p.b===z.id)).map(p=>p.a===z.id?p.aPoint:p.bPoint);
   for(const side of ['n','s','w','e']){
     const horizontal=side==='n'||side==='s';const sign=side==='n'||side==='w'?-1:1;
     const open=openings.some(p=>horizontal?Math.abs(p.z-(z.center.z+sign*5))<0.1:Math.abs(p.x-(z.center.x+sign*5))<0.1);
     const ranges=open?[[-5,-1.5],[1.5,5]]:[[-5,5]];
     for(const [start,end] of ranges){const n=Math.ceil((end-start)/2.5);for(let i=0;i<n;i++){const length=(end-start)/n;const center=start+(i+0.5)*length;walls.push({id:`wall-${z.id}-${side}-${start}-${i}`,zoneId:z.id,position:v(z.center.x+(horizontal?center:sign*5.12),z.center.y+1.65,z.center.z+(horizontal?sign*5.12:center)),size:v(horizontal?length+0.02:0.24,3.3,horizontal?0.24:length+0.02),yaw:0,material:plan.id==='archive'?'archive':plan.id==='pump'?'metal':'concrete'});}}
   }
 }
 for(const p of portals.filter(p=>!p.channel)){
  const dx=p.bPoint.x-p.aPoint.x,dz=p.bPoint.z-p.aPoint.z,dy=p.bPoint.y-p.aPoint.y;const horizontal=Math.abs(dx)>Math.abs(dz);const length=Math.hypot(dx,dz);const n=Math.ceil(length/2.5);
  for(let i=0;i<n;i++){const t=(i+0.5)/n;const center=v(p.aPoint.x+dx*t,p.aPoint.y+dy*t,p.aPoint.z+dz*t);floors.push({id:`corridor-${p.id}-${i}`,zoneId:t<0.5?p.a:p.b,x:center.x,z:center.z,width:horizontal?length/n:3,depth:horizontal?3:length/n,y:center.y,slopeX:horizontal?dy/dx:0,slopeZ:horizontal?0:dy/dz,material:Math.abs(dy)>0?'metal':zone(t<0.5?p.a:p.b).material,corridor:true});
   for(const side of [-1,1])walls.push({id:`corridor-wall-${p.id}-${i}-${side}`,zoneId:t<0.5?p.a:p.b,position:v(center.x+(horizontal?0:side*1.62),center.y+1.65,center.z+(horizontal?side*1.62:0)),size:v(horizontal?length/n+0.03:0.24,3.3+Math.abs(dy)/n,horizontal?0.24:length/n+0.03),yaw:0,material:'concrete'});
  }
 }
 for(const z of zones.filter(z=>!z.safe))for(const side of [-1,1])walls.push({id:`prop-shelf-${z.id}-${side<0?0:1}`,zoneId:z.id,position:v(z.center.x+side*4.35,z.center.y+(z.material==='water'?0.885:1.175),z.center.z+3.4),size:z.material==='water'?v(0.62,1.77,1.85):v(0.65,2.35,2),yaw:0,material:'archive'});
 const safe=zone('L').center;
 const resonators=plan.resonators.map((id,index)=>({id:`resonator-${id}`,zoneId:id,position:v(zone(id).center.x+(plan.id==='tutorial'&&index===0?1.6:4.7),zone(id).center.y+1.05,zone(id).center.z+(plan.id==='tutorial'&&index===0?-1.2:2.1)),normal:v(-1,0,0)}));
 walls.push({id:'prop-cabinet-L',zoneId:'L',position:v(safe.x-4.1,safe.y+0.65,safe.z+1.5),size:v(0.78,1.3,0.405),yaw:0,material:'metal'});
 for(const r of resonators)walls.push({id:`prop-resonator-${r.id}`,zoneId:r.zoneId,position:v(r.position.x,r.position.y-1.05+1.325,r.position.z),size:v(0.55,2.65,0.32),yaw:0,material:'metal'});
 const pedestals=plan.pedestals.flatMap((ids,group)=>ids.map(id=>({id:`pedestal-${group}-${id}`,zoneId:id,position:v(zone(id).center.x+1.2,zone(id).center.y,zone(id).center.z-1.2),group:group as 0|1})));
 const echoClusters:EchoCluster[]=floors.map(f=>({id:`echo-${f.id}`,zoneId:f.zoneId,center:v(f.x,f.y+0.05,f.z),floorIds:[f.id],wallIds:walls.filter(w=>w.zoneId===f.zoneId&&Math.abs(w.position.x-f.x)<=f.width/2+1.5&&Math.abs(w.position.z-f.z)<=f.depth/2+1.5).map(w=>w.id)}));
 return {id:plan.id,name:plan.name,zones,portals,floors,walls,resonators,pedestals,sockets:[v(safe.x-2.1,safe.y,safe.z+3.3),v(safe.x+2.1,safe.y,safe.z+3.3)],cabinet:v(safe.x-4.1,safe.y,safe.z+1.5),spawns:[v(safe.x,safe.y,safe.z+1.5),v(safe.x-1.4,safe.y,safe.z+1.8),v(safe.x+1.4,safe.y,safe.z+1.8),v(safe.x-2.6,safe.y,safe.z+2.1),v(safe.x+2.6,safe.y,safe.z+2.1)],patrol:plan.patrol,echoClusters,safeZoneId:'L'};
}
const levels=Object.fromEntries(plans.map(p=>[p.id,buildLevel(p)])) as Record<RouteId|'tutorial',KnockLevel>;
export const ROUTES = (['archive','pump','relay'] as const).map(id=>({id,name:levels[id].name}));
export function getLevel(id: RouteId | 'tutorial'):KnockLevel { return levels[id] ?? levels.archive; }
export function levelForMission(settings:{route:RouteId;tutorial:boolean}):KnockLevel {return getLevel(settings.tutorial?'tutorial':settings.route);}
export function zoneById(level:KnockLevel,id:string):Zone {const z=level.zones.find(z=>z.id===id);if(!z)throw new Error(`Unknown zone ${id}`);return z;}
export function floorAt(level:KnockLevel,x:number,z:number):Floor | null {
 return level.floors.find(f=>x>=f.x-f.width/2-0.0001&&x<=f.x+f.width/2+0.0001&&z>=f.z-f.depth/2-0.0001&&z<=f.z+f.depth/2+0.0001)??null;
}
export function floorHeight(f:Floor,x:number,z:number):number {return f.y+(x-f.x)*f.slopeX+(z-f.z)*f.slopeZ;}
export function zoneAt(level:KnockLevel,position:Vec3):string {return floorAt(level,position.x,position.z)?.zoneId??level.safeZoneId;}
export function validLevel(level:KnockLevel):string[] {
 const issues:string[]=[];const visited=new Set([level.safeZoneId]);for(let i=0;i<level.zones.length;i++)for(const p of level.portals.filter(p=>!p.channel)){if(visited.has(p.a))visited.add(p.b);if(visited.has(p.b))visited.add(p.a);}
 if(visited.size!==level.zones.length)issues.push('Disconnected movement graph');
 for(const p of level.portals.filter(p=>!p.channel)){if(p.width<1.9)issues.push(`Narrow portal ${p.id}`);const length=Math.hypot(p.bPoint.x-p.aPoint.x,p.bPoint.z-p.aPoint.z);const dy=Math.abs(p.aPoint.y-p.bPoint.y);if(dy>0&&(length<7.5||Math.atan2(dy,length)>28*Math.PI/180))issues.push(`Invalid ramp ${p.id}`);for(const t of [0,0.25,0.5,0.75,1])if(!floorAt(level,p.aPoint.x+(p.bPoint.x-p.aPoint.x)*t,p.aPoint.z+(p.bPoint.z-p.aPoint.z)*t))issues.push(`Missing passage floor ${p.id}`);}
 for(let i=1;i<level.patrol.length;i++)if(!level.portals.some(p=>!p.channel&&pairKey(p.a,p.b)===pairKey(level.patrol[i-1],level.patrol[i])))issues.push('Broken patrol');
 return issues;
}
