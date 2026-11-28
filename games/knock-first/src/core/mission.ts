import { KNOCK_CONTENT, KNOCK_RULES, KNOCK_WIRE } from './version';
import { acousticCostLowerBound, acousticPath, cueForNoise } from './acoustics';
import { approachAngle, batteryFits, batteryHandlePositions, canOccupy, clamp, copy, distance, distanceXZ, lineOfSight, moveCapsule, navigationPath, normalize, pointInLift, snapToFloor, sweepBattery, wrapAngle } from './geometry';
import { DIFFICULTIES, floorAt, levelForMission, STEP_SECONDS, zoneAt, zoneById } from './level';
import type { ActionPrompt, Actor, Battery, CommandPayload, CommandReceipt, KnockLevel, KnockSettings, MissionCommand, MissionEvent, MissionParticipant, MissionState, NoiseType, PlayerInput, PlayerView, PublicActor, Vec3 } from './types';

const NEUTRAL=(epoch=0,seq=-1):PlayerInput=>({seq,controllerEpoch:epoch,moveX:0,moveZ:0,yaw:0,pitch:0,run:false,quiet:false,hand:false});
const eye=(p:Vec3,height=1.45):Vec3=>({...p,y:p.y+height});
const actorEye=(a:Actor):Vec3=>eye(a.position,a.status==='downed'?0.48:1.45);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const vec=(v:unknown):v is Vec3=>Boolean(v&&typeof v==='object'&&['x','y','z'].every(k=>finite((v as Record<string,unknown>)[k])));
function random(s:MissionState):number {let n=s.random|0;n^=n<<13;n^=n>>>17;n^=n<<5;s.random=n>>>0;return s.random/4294967296;}
function fingerprint(v:unknown):string {if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(fingerprint).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+fingerprint((v as Record<string,unknown>)[k])).join(',')+'}';}
export function normalizeSettings(input:unknown):KnockSettings {const value=input&&typeof input==='object'?input as Record<string,unknown>:{};return {route:value.route==='pump'||value.route==='relay'?value.route:'archive',difficulty:value.difficulty==='calm'||value.difficulty==='tense'?value.difficulty:'normal',practice:value.practice===true||value.tutorial===true,tutorial:value.tutorial===true};}
export function createMission(input:{participants:MissionParticipant[];settings?:unknown;seed?:number}):MissionState {
 if(input.participants.length<2||input.participants.length>5)throw new Error('A mission requires 2–5 seats.');if(new Set(input.participants.map(p=>p.participantId)).size!==input.participants.length)throw new Error('Duplicate participant.');
 const settings=normalizeSettings(input.settings),level=levelForMission(settings),seed=(input.seed??1)>>>0||1;
 const actors:Actor[]=input.participants.map((p,i)=>{const kind=p.controller?.kind??p.kind??'human',position=copy(level.spawns[i]);return {id:p.participantId,name:p.displayName,playerId:p.playerId??null,seatIndex:p.seatIndex??i,kind,assistant:false,position,yaw:0,pitch:0,zoneId:level.safeZoneId,status:'active',stamina:5.5,carrying:null,timer:false,connected:kind==='bot',controllerEpoch:0,input:NEUTRAL(),lastInputAt:0,disconnectedAt:kind==='bot'?null:0,lastRunAt:-1,lastStepAt:-1,lastKnockAt:-3,downedRemaining:0,protectedUntil:0,returnAt:null,ready:kind==='bot',hold:null,saves:0,knownBatteries:[],seenZones:[level.safeZoneId],botIntent:'follow',botNextAt:0.5+i*0.1,botTarget:null,botStuckAt:0,botPrevious:copy(position),botThreat:null,botRescue:null,markTimes:[],notice:null,noticedUntil:0};});
 const spawn=zoneById(level,level.patrol[0]).center;
 const state:MissionState={version:KNOCK_RULES,contentVersion:KNOCK_CONTENT,wireVersion:KNOCK_WIRE,settings,seed,random:seed,tick:0,time:0,phase:'preparation',preparationRemaining:20,remaining:840,resumeRemaining:0,paused:false,revision:0,actors,doors:level.portals.filter(p=>p.door).map(p=>({id:p.id,open:!p.initiallyClosed,moving:false,targetOpen:!p.initiallyClosed,completeAt:0,blockedUntil:null,actorId:null,revision:0})),doorRevision:0,batteries:[],sockets:[null,null],cabinetTimers:2,timers:[],listener:{position:copy(spawn),yaw:0,zoneId:level.patrol[0],mode:'patrol',target:null,targetActorId:null,path:[],pathIndex:0,patrolIndex:0,lastHeardAt:-10,lastHeardPower:0,lastSeenAt:-10,searchUntil:0,pauseUntil:0,lungeAt:null,lungeTargetId:null,cooldownUntil:0,lastStepAt:0,cause:'patrol',searchIndex:0},noises:[],echoes:[],discoveredZones:[level.safeZoneId],marks:[],events:[],charges:DIFFICULTIES[settings.difficulty].charges,evacuationSince:null,receipts:{},resonanceReady:{},outcome:null,tutorial:settings.tutorial?{step:0,completed:false,distanceQuiet:0,origin:copy(actors[0].position),hadPair:false,released:false,lastEvent:null}:null,nextEvent:1,warningFlags:[]};
 for(const group of [0,1] as const){const candidates=level.pedestals.filter(p=>p.group===group);const pedestal=candidates[Math.floor(random(state)*candidates.length)];state.batteries.push({id:`battery-${group+1}`,group,position:copy(pedestal.position),yaw:0,zoneId:pedestal.zoneId,holders:[null,null],leader:null,installed:false,socket:null,revision:0,lastStable:copy(pedestal.position),lastNoiseAt:0,moving:false,obstruction:null});}
 addEvent(state,'preparation');return state;
}
export function connectParticipant(s:MissionState,id:string):number {const a=s.actors.find(a=>a.id===id);if(!a||a.kind==='bot')throw new Error('Unknown human participant.');if(s.phase==='finished')return a.controllerEpoch;a.controllerEpoch++;a.connected=true;a.assistant=false;a.disconnectedAt=null;a.input=NEUTRAL(a.controllerEpoch);a.lastInputAt=s.time;a.hold=null;a.botIntent='';s.revision++;return a.controllerEpoch;}
export function disconnectParticipant(s:MissionState,id:string,epoch:number):void {const a=s.actors.find(a=>a.id===id);if(!a||a.controllerEpoch!==epoch||a.kind==='bot'||s.phase==='finished')return;a.connected=false;a.disconnectedAt=s.time;s.revision++;}
export function recoverMission(s:MissionState):void {if(s.phase==='finished')return;s.resumeRemaining=5;for(const a of s.actors){a.input=NEUTRAL(a.controllerEpoch,a.input.seq);a.hold=null;if(a.kind==='human'){a.connected=false;a.assistant=false;a.disconnectedAt=s.time;}}s.revision++;}
export function setInput(s:MissionState,id:string,raw:PlayerInput):boolean {
 const a=s.actors.find(a=>a.id===id);if(!a||s.phase==='finished'||!raw||raw.controllerEpoch!==a.controllerEpoch||!Number.isSafeInteger(raw.seq)||raw.seq<=a.input.seq||![raw.moveX,raw.moveZ,raw.yaw,raw.pitch].every(finite))return false;
 const length=Math.hypot(raw.moveX,raw.moveZ),scale=length>1?1/length:1;
 a.input={seq:raw.seq,controllerEpoch:raw.controllerEpoch,moveX:clamp(raw.moveX*scale,-1,1),moveZ:clamp(raw.moveZ*scale,-1,1),yaw:wrapAngle(raw.yaw),pitch:clamp(raw.pitch,-1.35,1.35),run:raw.run===true,quiet:raw.quiet===true,hand:raw.hand===true};a.lastInputAt=s.time;a.yaw=a.input.yaw;a.pitch=a.input.pitch;if(!a.input.hand)a.hold=null;return true;
}
function addEvent(s:MissionState,type:string,extra:Partial<MissionEvent>={}):MissionEvent {const event:MissionEvent={id:`event-${s.nextEvent++}`,tick:s.tick,at:s.time,type,...extra};s.events.push(event);if(s.events.length>100)s.events.splice(0,s.events.length-100);s.revision++;if(s.tutorial)s.tutorial.lastEvent=type;return event;}
function notice(s:MissionState,a:Actor,code:string):void {a.notice=code;a.noticedUntil=s.time+2.5;}
function actor(s:MissionState,id:string):Actor|undefined{return s.actors.find(a=>a.id===id);}
function heldBattery(s:MissionState,a:Actor):Battery|undefined{return s.batteries.find(b=>b.id===a.carrying&&!b.installed);}
function nearbyDoor(level:KnockLevel,s:MissionState,a:Actor,id?:string):string|null {
 for(const d of s.doors){if(id&&d.id!==id)continue;const p=level.portals.find(p=>p.id===d.id)!;const dx=a.position.x-p.position.x,dz=a.position.z-p.position.z;const along=dx*Math.cos(p.yaw)-dz*Math.sin(p.yaw),across=dx*Math.sin(p.yaw)+dz*Math.cos(p.yaw);
  if(Math.abs(across)<=1.1&&Math.abs(along)<=p.width/2&&Math.abs(a.position.y-p.position.y)<0.6&&lineOfSight(level,s.doors.filter(v=>v.id!==d.id),actorEye(a),eye(p.position)))return d.id;
 }return null;
}
function nearSocket(level:KnockLevel,b:Battery,slot?:number):number {return level.sockets.findIndex((p,i)=>(slot===undefined||slot===i)&&distanceXZ(p,b.position)<=1.8&&Math.abs(p.y-b.position.y)<0.5);}
function isVisible(s:MissionState,level:KnockLevel,observer:Actor,position:Vec3,targetHeight=0.8):boolean {
 const from=actorEye(observer),to=eye(position,targetHeight);if(!lineOfSight(level,s.doors,from,to))return false;const d=distance(observer.position,position);if(d<=2.6)return true;
 const zone=zoneById(level,zoneAt(level,position));if(distanceXZ(position,zone.center)<=zone.lightRadius&&d<=10)return true;
 return s.echoes.some(w=>w.clusters.some(c=>c.arrivalAt<=s.time&&c.expiresAt>=s.time&&level.echoClusters.find(k=>k.id===c.id)?.zoneId===observer.zoneId)&&distance(w.source,position)<=w.radius&&zoneAt(level,position)===observer.zoneId);
}
export function interactionPrompt(s:MissionState,id:string):ActionPrompt {
 const a=actor(s,id);if(!a||a.status!=='active'||s.phase==='finished')return {type:'none',targetId:null,label:'none'};const level=levelForMission(s.settings),battery=heldBattery(s,a);
 if(battery){const slot=nearSocket(level,battery);if(slot>=0&&!s.sockets[slot])return {type:'install',targetId:`socket-${slot}`,duration:0.8,label:'install'};return {type:'drop',targetId:battery.id,label:'drop'};}
 const downed=s.actors.find(other=>other.id!==a.id&&other.status==='downed'&&distance(a.position,other.position)<=1&&lineOfSight(level,s.doors,actorEye(a),actorEye(other)));if(downed)return {type:'revive',targetId:downed.id,duration:2,label:'revive'};
 for(const b of s.batteries.filter(b=>!b.installed)){const handles=batteryHandlePositions(b);for(let h=0;h<2;h++)if(!b.holders[h]&&distance(eye(a.position,0.65),handles[h])<=1.05&&lineOfSight(level,s.doors,actorEye(a),handles[h]))return {type:'takeHandle',targetId:b.id,handle:h,label:'takeHandle'};}
 const door=nearbyDoor(level,s,a);if(door){const d=s.doors.find(d=>d.id===door)!;return {type:'door',targetId:door,label:d.moving?'doorMoving':d.open?'closeDoor':'openDoor'};}
 if(!a.timer&&s.cabinetTimers>0&&distanceXZ(a.position,level.cabinet)<=1.5)return {type:'takeTimer',targetId:'cabinet',label:'takeTimer'};
 return {type:'none',targetId:null,label:'none'};
}
export function knockTarget(s:MissionState,id:string):{kind:'resonator'|'knock'|'click'|'call';id?:string;position:Vec3} {
 const a=actor(s,id)!;if(a.carrying)return {kind:'call',position:actorEye(a)};const level=levelForMission(s.settings),origin=actorEye(a),direction={x:-Math.sin(a.yaw)*Math.cos(a.pitch),y:Math.sin(a.pitch),z:-Math.cos(a.yaw)*Math.cos(a.pitch)};
 for(const r of level.resonators){const target={...r.position,y:clamp(origin.y, r.position.y-0.4,r.position.y+0.55)};const dx=target.x-origin.x,dy=target.y-origin.y,dz=target.z-origin.z;const along=dx*direction.x+dy*direction.y+dz*direction.z;const perp=Math.hypot(dx-direction.x*along,dy-direction.y*along,dz-direction.z*along);if(along>=-0.05&&along<=1&&perp<=0.3&&lineOfSight(level,s.doors,origin,target,[`prop-resonator-${r.id}`])&&(s.resonanceReady[r.id]??0)<=s.time)return {kind:'resonator',id:r.id,position:{x:r.position.x+r.normal.x*0.3,y:r.position.y,z:r.position.z+r.normal.z*0.3}};}
 let previous=origin;for(let t=0.15;t<=1.001;t+=0.05){const p={x:origin.x+direction.x*t,y:origin.y+direction.y*t,z:origin.z+direction.z*t};if(!lineOfSight(level,s.doors,origin,p))return {kind:'knock',position:previous};previous=p;}
 return {kind:'click',position:origin};
}
export function emitNoise(s:MissionState,type:NoiseType,position:Vec3,power:number,echoRadius:number,actorId?:string):void {
 const level=levelForMission(s.settings);const noise={id:`noise-${s.nextEvent++}`,tick:s.tick,at:s.time,type,zoneId:zoneAt(level,position),position:copy(position),power,echoRadius,actorId};s.noises.push(noise);
 if(echoRadius>0){const clusters=level.echoClusters.filter(c=>distance(c.center,position)<=echoRadius+1e-8).flatMap(c=>{const path=acousticPath(level,s.doors,position,noise.zoneId,c.center,c.zoneId,power,true);if(!path||path.distance>echoRadius)return [];return [{id:c.id,distance:path.distance,arrivalAt:s.time+path.distance/18,expiresAt:s.time+path.distance/18+1.15}];});if(clusters.length){s.echoes.push({id:noise.id,at:s.time,source:copy(position),zoneId:noise.zoneId,radius:echoRadius,clusters});for(const c of clusters){const zone=level.echoClusters.find(k=>k.id===c.id)!.zoneId;if(!s.discoveredZones.includes(zone))s.discoveredZones.push(zone);}}}
 if(type==='listener-step'||type==='chase'||s.phase!=='active'||s.settings.tutorial)return;
 const listener=s.listener,ear=eye(listener.position,1.6);if(power-4*acousticCostLowerBound(level,position,ear)<DIFFICULTIES[s.settings.difficulty].hearing-1e-8)return;
 const path=acousticPath(level,s.doors,position,noise.zoneId,ear,listener.zoneId,power);if(!path||path.residual<DIFFICULTIES[s.settings.difficulty].hearing)return;
 if(listener.mode==='chase'&&listener.targetActorId){const target=actor(s,listener.targetActorId);if(target&&listenerSees(s,level,target,8))return;}
 if(listener.mode==='investigate'&&path.residual<listener.lastHeardPower+8&&s.time-listener.lastHeardAt<2.5)return;
 listener.mode='investigate';listener.target=safeListenerTarget(level,position,listener.position);listener.targetActorId=null;listener.lastHeardAt=s.time;listener.lastHeardPower=path.residual;listener.path=[];listener.pauseUntil=s.time+0.25;listener.cause=noise.id;listener.yaw=Math.atan2(-(position.x-listener.position.x),-(position.z-listener.position.z));
}
function releaseHandle(s:MissionState,a:Actor):void {
 const b=heldBattery(s,a);if(!b){a.carrying=null;return;}b.holders=b.holders.map(id=>id===a.id?null:id) as Battery['holders'];if(b.leader===a.id)b.leader=b.holders.find(Boolean)??null;a.carrying=null;a.hold=null;b.revision++;b.obstruction=null;
 if(!b.leader){const level=levelForMission(s.settings);const at=snapToFloor(level,b.position);if(at&&batteryFits(level,s.doors,at,b.yaw,[null,null])){b.position=at;b.lastStable=copy(at);}else{b.position=copy(b.lastStable);addEvent(s,'batteryRecovered',{targetId:b.id});}emitNoise(s,'drop',eye(b.position,0.2),61,4,a.id);}
 addEvent(s,'handleReleased',{actorId:a.id,targetId:b.id});if(s.tutorial?.hadPair)s.tutorial.released=true;
}
function takeHandle(s:MissionState,a:Actor,id:string,handle:number,revision?:number):string {
 const level=levelForMission(s.settings),b=s.batteries.find(b=>b.id===id);if(!b||b.installed||handle!==0&&handle!==1)return 'INVALID_HANDLE';if(revision!==undefined&&revision!==b.revision)return 'STALE_ENTITY';if(a.carrying)return 'HANDS_BUSY';if(b.holders[handle])return 'HANDLE_TAKEN';const point=batteryHandlePositions(b)[handle];if(distance(eye(a.position,0.65),point)>1.05||!lineOfSight(level,s.doors,actorEye(a),point))return 'TOO_FAR';
 const feet=batteryHandlePositions(b,true)[handle];if(distanceXZ(a.position,feet)>1.3||!canOccupy(level,s.doors,feet))return 'HANDLE_BLOCKED';b.holders[handle]=a.id;b.leader??=a.id;a.carrying=b.id;a.position={...feet,y:snapToFloor(level,feet)?.y??feet.y};a.zoneId=zoneAt(level,a.position);b.revision++;addEvent(s,'handleTaken',{actorId:a.id,targetId:b.id,value:handle});if(s.tutorial&&b.holders.every(Boolean))s.tutorial.hadPair=true;return 'OK';
}
function toggleDoor(s:MissionState,a:Actor,id:string,revision?:number):string {const d=s.doors.find(d=>d.id===id),level=levelForMission(s.settings);if(!d)return 'UNKNOWN_DOOR';if(revision!==undefined&&revision!==d.revision)return 'STALE_ENTITY';if(!nearbyDoor(level,s,a,id))return 'TOO_FAR';if(d.moving)return 'DOOR_MOVING';d.targetOpen=!d.open;d.moving=true;d.completeAt=s.time+0.7;d.actorId=a.id;d.blockedUntil=null;d.revision++;s.doorRevision++;addEvent(s,'doorMoving',{actorId:a.id,targetId:id});return 'OK';}
function beginHold(s:MissionState,a:Actor,type:'install'|'revive',targetId?:string,slot?:number):string {
 const level=levelForMission(s.settings);if(type==='install'){const b=heldBattery(s,a);if(!b)return 'NO_BATTERY';let socket=nearSocket(level,b,slot);if(socket<0)return 'TOO_FAR';if(s.sockets[socket]){socket=level.sockets.findIndex((p,i)=>!s.sockets[i]&&distanceXZ(p,b.position)<=1.8);if(socket<0)return 'SOCKET_FULL';}a.hold={type,targetId:`socket-${socket}`,progress:0,duration:0.8,origin:copy(a.position)};}
 else {const target=actor(s,targetId??'');if(!target||target.status!=='downed'||distance(a.position,target.position)>1||!lineOfSight(level,s.doors,actorEye(a),actorEye(target)))return 'TOO_FAR';if(a.carrying)return 'HANDS_BUSY';a.hold={type,targetId:target.id,progress:0,duration:2,origin:copy(a.position)};}
 a.input.hand=true;a.lastInputAt=s.time;return 'OK';
}
function performCommand(s:MissionState,a:Actor,p:CommandPayload,revision?:number):string {
 const level=levelForMission(s.settings);
 if(p.type==='ready'){a.ready=true;addEvent(s,'ready',{actorId:a.id});return 'OK';}
 if(p.type==='pause'){if(!s.settings.practice)return 'NOT_PRACTICE';s.paused=p.paused===true;s.revision++;return 'OK';}
 if(p.type==='tutorial'){if(!s.tutorial)return 'NOT_TUTORIAL';if(p.action==='sound'&&s.tutorial.step===0)s.tutorial.step=1;else if(p.action==='skip'){s.tutorial.completed=true;finish(s,'full','tutorialSkipped');}else if(p.action==='restart')return 'NEW_MATCH_REQUIRED';else if(p.action!=='sound')return 'INVALID_COMMAND';s.revision++;return 'OK';}
 if(p.type==='mark'){if(a.status==='returning')return 'RETURNING';const kinds=['battery','here','danger','handle','help'];if(!kinds.includes(p.kind))return 'INVALID_MARK';a.markTimes=a.markTimes.filter(t=>s.time-t<10);if(a.markTimes.length>=3)return 'MARK_LIMIT';const position=p.position&&vec(p.position)?copy(p.position):copy(a.position);const z=zoneAt(level,position);if(!floorAt(level,position.x,position.z)||distanceXZ(a.position,position)>30||!isVisible(s,level,a,position,0.1)&&!s.discoveredZones.includes(z))return 'NOT_DISCOVERED';a.markTimes.push(s.time);s.marks.push({id:`mark-${s.nextEvent++}`,actorId:a.id,kind:p.kind,position,zoneId:z,expiresAt:s.time+10});addEvent(s,'mark',{actorId:a.id,zoneId:z});return 'OK';}
 if(a.status!=='active')return 'NOT_ACTIVE';
 if(p.type==='drop'){releaseHandle(s,a);return 'OK';}
 if(p.type==='takeHandle')return takeHandle(s,a,p.batteryId,p.handle,revision);
 if(p.type==='door')return toggleDoor(s,a,p.doorId,revision);
 if(p.type==='install')return beginHold(s,a,'install',undefined,p.socket);
 if(p.type==='revive')return beginHold(s,a,'revive',p.actorId);
 if(p.type==='hand'){a.input.hand=p.down===true;a.lastInputAt=s.time;if(!p.down){a.hold=null;return 'OK';}return performCommand(s,a,{type:'interact',targetId:p.targetId},revision);}
 if(p.type==='interact'){
  const prompt=interactionPrompt(s,a.id);if(p.targetId&&p.targetId!==prompt.targetId)return 'NOT_IN_REACH';
  if(prompt.type==='takeHandle')return takeHandle(s,a,prompt.targetId!,p.handle??prompt.handle!,revision);
  if(prompt.type==='drop'){releaseHandle(s,a);return 'OK';}
  if(prompt.type==='door')return toggleDoor(s,a,prompt.targetId!,revision);
  if(prompt.type==='install')return beginHold(s,a,'install',undefined,Number(prompt.targetId!.split('-')[1]));
  if(prompt.type==='revive')return beginHold(s,a,'revive',prompt.targetId!);
  if(prompt.type==='takeTimer')return performCommand(s,a,{type:'takeTimer'});return 'NOTHING_NEARBY';
 }
 if(p.type==='takeTimer'){if(a.timer)return 'ALREADY_HAVE_TIMER';if(a.carrying)return 'HANDS_BUSY';if(!s.cabinetTimers)return 'CABINET_EMPTY';if(distanceXZ(a.position,level.cabinet)>1.5)return 'TOO_FAR';s.cabinetTimers--;a.timer=true;addEvent(s,'timerTaken',{actorId:a.id});return 'OK';}
 if(p.type==='placeTimer'){if(!a.timer)return 'NO_TIMER';if(a.carrying)return 'HANDS_BUSY';const floor=snapToFloor(level,a.position);if(!floor)return 'INVALID_FLOOR';a.timer=false;s.timers.push({id:`timer-${s.nextEvent++}`,ownerId:a.id,position:floor,zoneId:a.zoneId,firesAt:s.time+4});addEvent(s,'timerPlaced',{actorId:a.id,zoneId:a.zoneId});return 'OK';}
 if(p.type==='knock'||p.type==='call'){
  if(s.time-a.lastKnockAt<2.5)return 'KNOCK_COOLDOWN';const target=p.type==='call'?{kind:'call' as const,position:actorEye(a)}:knockTarget(s,a.id);if(target.kind==='call'&&p.type!=='call')return 'HANDS_BUSY';a.lastKnockAt=s.time;
  if(target.kind==='resonator'&&'id'in target&&target.id)s.resonanceReady[target.id]=s.time+6;const power=target.kind==='resonator'?81:target.kind==='knock'?57:target.kind==='call'?57:27;const radius=target.kind==='resonator'?16:target.kind==='knock'?11:target.kind==='call'?0:4.5;
  emitNoise(s,target.kind,target.position,power,radius,a.id);addEvent(s,target.kind,{actorId:a.id,zoneId:a.zoneId});return 'OK';
 }return 'INVALID_COMMAND';
}
export function applyCommand(s:MissionState,id:string,command:MissionCommand):CommandReceipt {
 const a=actor(s,id),key=command?.actionId;const fail=(code:string):CommandReceipt=>({actionId:typeof key==='string'?key:'',ok:false,code,tick:s.tick,revision:s.revision});
 if(!a||!command||typeof key!=='string'||!key||key.length>160||!command.payload||typeof command.payload!=='object')return fail('INVALID_COMMAND');
 const stamp=fingerprint(command.payload),prior=s.receipts[key];if(prior)return prior.participantId===id&&prior.fingerprint===stamp?{...prior.receipt}:fail('ACTION_ID_REUSED');
 if(command.controllerEpoch!==a.controllerEpoch)return fail('STALE_CONTROLLER');if(s.phase==='finished')return fail('MISSION_FINISHED');
 const code=performCommand(s,a,command.payload,command.expectedRevision);if(code!=='OK')notice(s,a,code);const receipt:CommandReceipt={actionId:key,ok:code==='OK',code,tick:s.tick,revision:s.revision};s.receipts[key]={fingerprint:stamp,participantId:id,receipt};s.revision++;receipt.revision=s.revision;return receipt;
}

function moveActors(s:MissionState,level:KnockLevel,dt:number):void {
 for(const a of s.actors){
  if(a.kind==='human'&&!a.assistant&&s.time-a.lastInputAt>0.3){a.input={...a.input,moveX:0,moveZ:0,run:false,hand:false};a.hold=null;}
  if(a.status==='returning'||a.carrying)continue;
  const input=a.input,magnitude=Math.min(1,Math.hypot(input.moveX,input.moveZ));const dir=normalize(input.moveX,input.moveZ);const running=input.run&&!input.quiet&&a.stamina>0&&a.status==='active'&&magnitude>0.05;
  if(running){a.stamina=Math.max(0,a.stamina-dt);a.lastRunAt=s.time;}else if(s.time-a.lastRunAt>=0.8)a.stamina=Math.min(5.5,a.stamina+0.9*dt);
  let speed=a.status==='downed'?0.65:input.quiet?1.55:running?4.45:2.9;
  if(dir.x*(-Math.sin(a.yaw))+dir.z*(-Math.cos(a.yaw))< -0.1)speed*=0.78;
  const floor=floorAt(level,a.position.x,a.position.z);if(floor?.material==='water')speed*=0.9;
  if(magnitude<=0.01)continue;const old=copy(a.position);const next=moveCapsule(level,s.doors,a.position,dir.x*speed*magnitude*dt,dir.z*speed*magnitude*dt);
  if(s.phase==='preparation'&&!pointInLift(level,next))continue;
  const other=s.actors.some(b=>b.id!==a.id&&b.status!=='returning'&&Math.abs(b.position.y-next.y)<1&&distanceXZ(b.position,next)<0.54&&distanceXZ(b.position,old)>=distanceXZ(b.position,next));if(other)continue;
  a.position=next;a.zoneId=zoneAt(level,next);if(!a.seenZones.includes(a.zoneId))a.seenZones.push(a.zoneId);if(!s.discoveredZones.includes(a.zoneId))s.discoveredZones.push(a.zoneId);
  const moved=distanceXZ(old,next);if(s.tutorial&&a.kind==='human'&&input.quiet)s.tutorial.distanceQuiet+=moved;
  const interval=input.quiet?0.75:running?0.34:0.48;if(moved>0.002&&s.time-a.lastStepAt>=interval){a.lastStepAt=s.time;const water=floor?.material==='water';emitNoise(s,water?'water-step':input.quiet?'quiet-step':running?'run':'step',eye(next,0.05),(input.quiet?12:running?38:22)+(water?8:0),water?1.3:0,a.id);}
 }
 for(const b of s.batteries.filter(b=>!b.installed&&b.leader)){
  const lead=actor(s,b.leader!);if(!lead||lead.status!=='active'){if(lead)releaseHandle(s,lead);continue;}const followerId=b.holders.find(id=>id&&id!==lead.id);const follower=followerId?actor(s,followerId):undefined;const leading=normalize(lead.input.moveX,lead.input.moveZ);const lm=Math.min(1,Math.hypot(lead.input.moveX,lead.input.moveZ));let speed=1;b.obstruction=null;
  if(follower){const fm=Math.hypot(follower.input.moveX,follower.input.moveZ),f=normalize(follower.input.moveX,follower.input.moveZ),dot=leading.x*f.x+leading.z*f.z;if(lm>0.01&&fm>0.01&&dot< -0.25){speed=0;b.obstruction='opposed';}else if(fm>0.01&&dot>=0.25)speed=2.05;else{speed=0.75;b.obstruction='angle';}}
  const wasMoving=b.moving;b.moving=lm>0.01&&speed>0;for(const id of b.holders){const member=id?actor(s,id):undefined;if(member&&s.time-member.lastRunAt>=0.8)member.stamina=Math.min(5.5,member.stamina+dt*0.9);}
  if(!b.moving){if(wasMoving)emitNoise(s,'stop',eye(b.position,0.4),48,4,lead.id);continue;}
  if(floorAt(level,b.position.x,b.position.z)?.material==='water')speed*=0.9;
  const sign=b.holders[0]===lead.id?-1:1;const desiredYaw=Math.atan2(-leading.z*sign,leading.x*sign),yaw=approachAngle(b.yaw,desiredYaw,85*Math.PI/180*dt);const to={x:b.position.x+leading.x*speed*lm*dt,y:b.position.y,z:b.position.z+leading.z*speed*lm*dt};const result=sweepBattery(level,s.doors,b,to,yaw);
  const feet=batteryHandlePositions(result,true);const occupied=s.actors.some(a=>!b.holders.includes(a.id)&&a.status!=='returning'&&Math.abs(a.position.y-result.position.y)<1&&(distanceXZ(a.position,result.position)<0.75||feet.some((p,i)=>b.holders[i]&&distanceXZ(a.position,p)<0.55)));
  if(occupied){b.obstruction='blocked';continue;}const moved=distanceXZ(b.position,result.position);b.position=result.position;b.yaw=result.yaw;b.zoneId=zoneAt(level,b.position);if(result.blocked)b.obstruction='blocked';if(batteryFits(level,s.doors,b.position,b.yaw,[null,null]))b.lastStable=copy(b.position);
  for(let i=0;i<2;i++){const a=b.holders[i]?actor(s,b.holders[i]!):undefined;if(a){a.position=snapToFloor(level,feet[i])??feet[i];a.zoneId=zoneAt(level,a.position);if(!a.seenZones.includes(a.zoneId))a.seenZones.push(a.zoneId);if(!s.discoveredZones.includes(a.zoneId))s.discoveredZones.push(a.zoneId);}}
  if(moved>0.001&&s.time-b.lastNoiseAt>=1){b.lastNoiseAt=s.time;emitNoise(s,follower?'carry':'drag',eye(b.position,0.2),follower?24:39,1.7,lead.id);}
 }
}
function doorwayOccupied(s:MissionState,level:KnockLevel,id:string):boolean {const p=level.portals.find(p=>p.id===id)!;const overlap=(position:Vec3,radius:number)=>{const dx=position.x-p.position.x,dz=position.z-p.position.z;return Math.abs(dx*Math.cos(p.yaw)-dz*Math.sin(p.yaw))<p.width/2+radius&&Math.abs(dx*Math.sin(p.yaw)+dz*Math.cos(p.yaw))<0.22+radius&&Math.abs(position.y-p.position.y)<1;};return s.actors.some(a=>a.status!=='returning'&&overlap(a.position,0.28))||s.batteries.some(b=>!b.installed&&overlap(b.position,0.55))||overlap(s.listener.position,0.45);}
function advanceDoorsAndHolds(s:MissionState,level:KnockLevel,dt:number):void {
 for(const door of s.doors){if(!door.moving||s.time<door.completeAt)continue;if(!door.targetOpen&&doorwayOccupied(s,level,door.id)){door.blockedUntil??=s.time+1;if(s.time<door.blockedUntil)continue;door.moving=false;door.targetOpen=door.open;door.blockedUntil=null;door.revision++;s.doorRevision++;if(door.actorId){const a=actor(s,door.actorId);if(a)notice(s,a,'DOOR_BLOCKED');}addEvent(s,'doorBlocked',{targetId:door.id});continue;}
  door.open=door.targetOpen;door.moving=false;door.blockedUntil=null;door.revision++;s.doorRevision++;const p=level.portals.find(p=>p.id===door.id)!;emitNoise(s,door.actorId==='listener'?'door-push':'door',eye(p.position,0.8),door.actorId==='listener'?53:32,2,door.actorId??undefined);addEvent(s,door.open?'doorOpened':'doorClosed',{targetId:door.id});
 }
 for(const a of s.actors){const hold=a.hold;if(!hold)continue;if(!a.input.hand||a.status!=='active'||distanceXZ(a.position,hold.origin)>0.4){a.hold=null;continue;}
  if(hold.type==='install'){const b=heldBattery(s,a),slot=Number(hold.targetId.split('-')[1]);if(!b||!Number.isInteger(slot)||slot<0||slot>1||s.sockets[slot]||nearSocket(level,b,slot)<0){a.hold=null;continue;}hold.progress+=dt;if(hold.progress+1e-8<0.8)continue;
   s.sockets[slot]=b.id;b.installed=true;b.socket=slot;b.position=copy(level.sockets[slot]);b.zoneId=level.safeZoneId;b.revision++;for(const id of b.holders){const carrier=id?actor(s,id):undefined;if(carrier){carrier.carrying=null;carrier.hold=null;}}b.holders=[null,null];b.leader=null;b.moving=false;addEvent(s,'batteryInstalled',{actorId:a.id,targetId:b.id,value:slot});
  }else{const target=actor(s,hold.targetId);if(!target||target.status!=='downed'||distance(a.position,target.position)>1||!lineOfSight(level,s.doors,actorEye(a),actorEye(target))){a.hold=null;continue;}hold.progress+=dt;if(hold.progress+1e-8<2)continue;target.status='active';target.downedRemaining=0;target.protectedUntil=s.time+4;target.input={...target.input,moveX:0,moveZ:0};a.saves++;a.hold=null;addEvent(s,'revived',{actorId:a.id,targetId:target.id});}
 }
}
function safeListenerTarget(level:KnockLevel,position:Vec3,from:Vec3):Vec3 {
 const floor=snapToFloor(level,position);if(!floor||!pointInLift(level,floor))return copy(position);
 const portals=level.portals.filter(p=>!p.channel&&(p.a===level.safeZoneId||p.b===level.safeZoneId));
 const p=portals.sort((a,b)=>distanceXZ(a.position,from)-distanceXZ(b.position,from))[0];
 const edge=p.a===level.safeZoneId?p.aPoint:p.bPoint;const other=zoneById(level,p.a===level.safeZoneId?p.b:p.a).center;const dir=normalize(other.x-edge.x,other.z-edge.z);
 return {x:edge.x+dir.x*0.5,y:edge.y,z:edge.z+dir.z*0.5};
}
function listenerSees(s:MissionState,level:KnockLevel,a:Actor,range?:number):boolean {
 if(a.status!=='active'||pointInLift(level,a.position))return false;const l=s.listener,d=distance(l.position,a.position);if(d>(range??6))return false;const angle=wrapAngle(Math.atan2(-(a.position.x-l.position.x),-(a.position.z-l.position.z))-l.yaw);if(d>1.35&&l.mode!=='chase'&&Math.abs(angle)>40*Math.PI/180)return false;return lineOfSight(level,s.doors,eye(l.position,1.65),actorEye(a));
}
function nextWaypoint(level:KnockLevel,from:Vec3,to:Vec3,doors:MissionState['doors'],avoidLift=false,knownZones?:string[]):Vec3|null {
 const path=navigationPath(level,from,to,{allowClosed:true,doors,avoidLift,knownZones});while(path.length>1&&(distanceXZ(from,path[0])<0.6||distanceXZ(from,path[1])+0.03<distanceXZ(path[0],path[1])))path.shift();return path[0]??null;
}
function downActor(s:MissionState,a:Actor):void {if(a.status!=='active'||a.protectedUntil>s.time)return;releaseHandle(s,a);a.status='downed';a.downedRemaining=DIFFICULTIES[s.settings.difficulty].downedSeconds;a.hold=null;a.input={...a.input,run:false,hand:false};addEvent(s,'downed',{actorId:a.id,zoneId:a.zoneId});}
function advanceListener(s:MissionState,level:KnockLevel,dt:number):void {
 if(s.settings.tutorial)return;const l=s.listener;const visible=s.actors.filter(a=>listenerSees(s,level,a,l.mode==='chase'?8:6)).sort((a,b)=>distance(l.position,a.position)-distance(l.position,b.position));
 if(visible.length){const target=visible[0];if(l.mode!=='chase'){emitNoise(s,'chase',eye(l.position,1.2),54,2);addEvent(s,'chase',{zoneId:l.zoneId});}l.mode='chase';l.targetActorId=target.id;l.target=copy(target.position);l.lastSeenAt=s.time;l.cause='sight';}
 else if(l.mode==='chase'&&s.time-l.lastSeenAt>=2){l.mode='search';l.searchUntil=s.time+5;l.targetActorId=null;l.path=[];l.searchIndex=0;}
 if(l.lungeAt!==null&&s.time>=l.lungeAt){const target=l.lungeTargetId?actor(s,l.lungeTargetId):undefined;let hit=false;if(target&&target.status==='active'&&target.protectedUntil<=s.time&&!pointInLift(level,target.position)&&distance(l.position,target.position)<=0.85&&lineOfSight(level,s.doors,eye(l.position,1.65),actorEye(target))){downActor(s,target);hit=true;}l.lungeAt=null;l.lungeTargetId=null;l.cooldownUntil=s.time+(hit?2:0.5);if(hit){l.mode='search';l.searchUntil=s.time+5;l.targetActorId=null;}}
 if(l.lungeAt!==null||s.time<l.cooldownUntil)return;
 if(l.mode==='chase'&&l.targetActorId){const target=actor(s,l.targetActorId);if(target&&distance(l.position,target.position)<=0.85&&target.protectedUntil<=s.time){l.lungeAt=s.time+0.4;l.lungeTargetId=target.id;return;}}
 if(l.mode==='patrol'||l.mode==='return'){
  if(l.mode==='return'){const candidates=level.patrol.map((id,i)=>({i,p:zoneById(level,id).center})).sort((a,b)=>distanceXZ(a.p,l.position)-distanceXZ(b.p,l.position));l.patrolIndex=candidates[0].i;}
  const target=zoneById(level,level.patrol[l.patrolIndex]).center;if(distanceXZ(l.position,target)<0.5){if(l.mode==='return')l.mode='patrol';l.patrolIndex=(l.patrolIndex+1)%level.patrol.length;if(l.patrolIndex===0||l.patrolIndex===3)l.pauseUntil=s.time+0.65;}l.target=copy(zoneById(level,level.patrol[l.patrolIndex]).center);
 }
 if(l.mode==='investigate'&&l.target&&distanceXZ(l.position,l.target)<0.7){l.mode='search';l.searchUntil=s.time+5;l.searchIndex=0;l.path=[];}
 if(l.mode==='search'){
  if(s.time>=l.searchUntil){l.mode='return';l.target=null;l.path=[];return;}
  if(!l.target||distanceXZ(l.position,l.target)<0.6){const neighbors=level.portals.filter(p=>!p.channel&&(p.a===l.zoneId||p.b===l.zoneId)).map(p=>p.a===l.zoneId?p.b:p.a).filter(id=>id!==level.safeZoneId);const target=neighbors[(s.seed+l.searchIndex++)%Math.max(1,neighbors.length)];const center=target?zoneById(level,target).center:zoneById(level,l.zoneId).center;l.target={x:(center.x+l.position.x)/2,y:(center.y+l.position.y)/2,z:(center.z+l.position.z)/2};if(!snapToFloor(level,l.target))l.target=copy(center);}
 }
 if(!l.target||s.time<l.pauseUntil)return;const target=safeListenerTarget(level,l.target,l.position);
 const approachBoundary=zoneAt(level,target)===level.safeZoneId&&!pointInLift(level,target);
 const waypoint=nextWaypoint(level,l.position,target,s.doors,!approachBoundary);if(!waypoint)return;const dir=normalize(waypoint.x-l.position.x,waypoint.z-l.position.z);l.yaw=approachAngle(l.yaw,Math.atan2(-dir.x,-dir.z),3.8*dt);
 for(const d of s.doors){const p=level.portals.find(p=>p.id===d.id)!;if(!d.open&&!d.moving&&distanceXZ(l.position,p.position)<1.05){d.moving=true;d.targetOpen=true;d.completeAt=s.time+0.8;d.actorId='listener';d.revision++;s.doorRevision++;addEvent(s,'doorPushed',{targetId:d.id});return;}}
 const speed=l.mode==='patrol'?1.55:l.mode==='investigate'?2.45:l.mode==='chase'?DIFFICULTIES[s.settings.difficulty].chaseSpeed:1.85;const old=copy(l.position),next=moveCapsule(level,s.doors,l.position,dir.x*speed*dt,dir.z*speed*dt,0.36);if(!pointInLift(level,next)){l.position=next;l.zoneId=zoneAt(level,next);}if(distanceXZ(old,next)>0.002&&s.time-l.lastStepAt>0.62){l.lastStepAt=s.time;emitNoise(s,'listener-step',eye(l.position,0.1),26,0.8);}
}
function requestReturn(s:MissionState,targets:Actor[]):void {if(!targets.length)return;if(s.charges<=0){finish(s,'defeat','noCharges');return;}s.charges--;for(const a of targets){a.status='returning';a.returnAt=s.time+4;a.hold=null;a.input={...a.input,moveX:0,moveZ:0,hand:false};}addEvent(s,targets.length>1?'teamReturn':'emergencyReturn',{actorId:targets[0].id,value:targets.length});}
function advanceReturns(s:MissionState,level:KnockLevel,dt:number):void {
 if(s.settings.tutorial)return;
 const active=s.actors.filter(a=>a.status==='active'),down=s.actors.filter(a=>a.status==='downed');if(!active.length&&down.length){const ongoing=s.actors.filter(a=>a.status==='returning');if(ongoing.length){const at=Math.min(...ongoing.map(a=>a.returnAt??s.time+4));for(const a of down){a.status='returning';a.returnAt=at;a.hold=null;}addEvent(s,'teamReturnJoined',{value:down.length});}else requestReturn(s,down);}
 if(s.phase==='finished')return;
 for(const a of s.actors){if(a.status==='downed'){a.downedRemaining=Math.max(0,a.downedRemaining-dt);if(a.downedRemaining<=0){requestReturn(s,[a]);if(s.outcome)return;}}else if(a.status==='returning'&&a.returnAt!==null&&s.time>=a.returnAt){a.status='active';a.position=copy(level.spawns[a.seatIndex]??level.spawns[0]);a.zoneId=level.safeZoneId;a.returnAt=null;a.downedRemaining=0;a.protectedUntil=s.time+4;a.input={...a.input,moveX:0,moveZ:0,hand:false};a.botTarget=null;addEvent(s,'returned',{actorId:a.id});}}
}
function finish(s:MissionState,kind:'full'|'partial'|'defeat',reason:string):void {if(s.phase==='finished')return;const level=levelForMission(s.settings);s.outcome={kind,reason,batteries:s.sockets.filter(Boolean).length,evacuated:s.actors.filter(a=>a.status==='active'&&pointInLift(level,a.position)).map(a=>a.id),remaining:Math.max(0,s.remaining),saves:s.actors.reduce((n,a)=>n+a.saves,0),echoes:s.events.filter(e=>['knock','resonator','timerPlaced','downed','revived','batteryInstalled'].includes(e.type)).slice(-3),tick:s.tick};s.phase='finished';for(const a of s.actors){a.hold=null;a.input={...a.input,moveX:0,moveZ:0,run:false,hand:false};}addEvent(s,'finished',{value:kind==='full'?2:kind==='partial'?1:0});}

function botInput(s:MissionState,a:Actor,move:{x:number;z:number},options:{run?:boolean;quiet?:boolean;hand?:boolean;yaw?:number}={}):void {setInput(s,a.id,{seq:a.input.seq+1,controllerEpoch:a.controllerEpoch,moveX:move.x,moveZ:move.z,yaw:options.yaw??(Math.hypot(move.x,move.z)>0.05?Math.atan2(-move.x,-move.z):a.yaw),pitch:0,run:options.run??false,quiet:options.quiet??false,hand:options.hand??false});}
function botCommand(s:MissionState,a:Actor,payload:CommandPayload):CommandReceipt {return applyCommand(s,a.id,{actionId:`bot-${a.id}-${s.tick}-${s.nextEvent}`,controllerEpoch:a.controllerEpoch,payload});}
/** An idle follower gives a nearby visible learner room to step back. No pushing or teleporting. */
function yieldToHuman(s:MissionState,level:KnockLevel,a:Actor):boolean {
 if(a.carrying||a.hold||a.botThreat||a.botRescue||!['follow','yield'].includes(a.botIntent))return false;
 const radius=a.botIntent==='yield'?1.4:0.95;
 const human=s.actors.filter(other=>other.kind==='human'&&other.connected&&!other.assistant&&other.status==='active'
   &&Math.abs(other.position.y-a.position.y)<0.9&&distanceXZ(other.position,a.position)<radius
   &&isVisible(s,level,a,other.position,1.2)).sort((left,right)=>distanceXZ(left.position,a.position)-distanceXZ(right.position,a.position))[0];
 if(!human){
  if(a.botIntent!=='yield')return false;
  a.botIntent='follow';a.botTarget=null;botInput(s,a,{x:0,z:0});return true;
 }
 if(a.botIntent!=='yield'||!a.botTarget){
  const away=normalize(a.position.x-human.position.x,a.position.z-human.position.z);
  const directions=[1,-1].map(sign=>normalize(away.x*0.45+away.z*sign,away.z*0.45-away.x*sign));
  directions.push(away);
  const target=directions.map(dir=>moveCapsule(level,s.doors,a.position,dir.x*0.85,dir.z*0.85)).find(point=>
    distanceXZ(point,a.position)>0.35&&distanceXZ(point,human.position)>distanceXZ(a.position,human.position)+0.2
    &&!s.actors.some(other=>other.id!==a.id&&other.id!==human.id&&other.status!=='returning'
      &&Math.abs(other.position.y-point.y)<0.9&&isVisible(s,level,a,other.position,1.2)&&distanceXZ(point,other.position)<0.6));
  if(!target)return false;
  a.botTarget=target;a.botIntent='yield';
 }
 if(distanceXZ(a.position,a.botTarget)<0.12){a.botTarget=null;a.botIntent='follow';botInput(s,a,{x:0,z:0});return true;}
 const direction=normalize(a.botTarget.x-a.position.x,a.botTarget.z-a.position.z);
 botInput(s,a,direction,{quiet:true,yaw:a.yaw});return true;
}
function steerBot(s:MissionState,level:KnockLevel,a:Actor,target:Vec3,run=false):void {
 const next=nextWaypoint(level,a.position,target,s.doors,false,s.discoveredZones);
 if(!next){botInput(s,a,{x:0,z:0});a.botIntent='blocked';a.botTarget=null;return;}
 const door=nearbyDoor(level,s,a);
 if(door){
  const d=s.doors.find(d=>d.id===door)!;
  if(!d.open&&!d.moving){botCommand(s,a,{type:'door',doorId:door});botInput(s,a,{x:0,z:0});return;}
  if(d.moving){botInput(s,a,{x:0,z:0});return;}
  if(a.botIntent==='avoid'&&a.botThreat){
   const p=level.portals.find(p=>p.id===door)!;const signed=(q:Vec3)=>(q.x-p.position.x)*Math.sin(p.yaw)+(q.z-p.position.z)*Math.cos(p.yaw);
   if(signed(a.position)*signed(a.botThreat.position)<0&&Math.abs(signed(a.position))>0.55)botCommand(s,a,{type:'door',doorId:door});
  }
 }
 let dir=normalize(next.x-a.position.x,next.z-a.position.z);
 // Local capsule avoidance uses only nearby observed teammates and a consistent right-hand lane.
 const obstacle=s.actors.find(b=>b.id!==a.id&&b.status!=='returning'&&Math.abs(a.position.y-b.position.y)<0.9&&distanceXZ(a.position,b.position)<1.15&&(b.position.x-a.position.x)*dir.x+(b.position.z-a.position.z)*dir.z>0.08&&lineOfSight(level,s.doors,actorEye(a),actorEye(b)));
 if(obstacle){
  for(const sign of [1,-1]){const candidate=normalize(dir.x-dir.z*0.95*sign,dir.z+dir.x*0.95*sign);const probe=moveCapsule(level,s.doors,a.position,candidate.x*0.45,candidate.z*0.45);if(distanceXZ(probe,a.position)>0.25){dir=candidate;break;}}
 }
 botInput(s,a,dir,{run,quiet:!run&&!a.carrying&&a.botIntent==='avoid'});
 if(distanceXZ(a.position,a.botPrevious)<0.08){
  if(s.time-a.botStuckAt>2){a.botIntent='blocked';a.botTarget=null;const sign=a.seatIndex%2?1:-1;botInput(s,a,{x:-dir.z*sign,z:dir.x*sign},{run});a.botStuckAt=s.time;}
 }else{a.botStuckAt=s.time;a.botPrevious=copy(a.position);}
}
function escapePosition(s:MissionState,level:KnockLevel,a:Actor,hazard:Vec3):Vec3 {
 const candidates:Vec3[]=[level.spawns[a.seatIndex]??level.spawns[0]];
 for(const z of level.zones.filter(z=>s.discoveredZones.includes(z.id)))candidates.push(z.center);
 const z=zoneById(level,a.zoneId);
 for(const dx of [-3,3])for(const dz of [-3,3])candidates.push({x:z.center.x+dx,y:z.center.y,z:z.center.z+dz});
 const toward=normalize(hazard.x-a.position.x,hazard.z-a.position.z);const current=distanceXZ(a.position,hazard);
 const ranked=candidates.flatMap(target=>{
  const next=nextWaypoint(level,a.position,target,s.doors,false,s.discoveredZones);if(!next||distanceXZ(a.position,target)<1)return [];
  const dir=normalize(next.x-a.position.x,next.z-a.position.z);const approach=dir.x*toward.x+dir.z*toward.z;if(approach>0.25&&current<6)return [];
  const probe=moveCapsule(level,s.doors,a.position,dir.x*0.8,dir.z*0.8);if(distanceXZ(probe,a.position)<0.4)return [];
  const score=distanceXZ(hazard,target)*0.5-approach*5-distanceXZ(a.position,target)*0.08+(pointInLift(level,target)?7:0);
  return [{target,score}];
 }).sort((x,y)=>y.score-x.score);
 if(ranked.length)return copy(ranked[0].target);
 const away=normalize(a.position.x-hazard.x,a.position.z-hazard.z);return moveCapsule(level,s.doors,a.position,away.x*2.5,away.z*2.5);
}
function advanceBots(s:MissionState,level:KnockLevel):void {
 for(const a of s.actors){
  // A lesson waits for its learner; an autonomous substitute must not consume
  // the object they are currently learning to release. Ordinary missions keep assistants.
  if(s.settings.tutorial&&a.kind==='human'){
   if(a.assistant){a.assistant=false;a.input=NEUTRAL(a.controllerEpoch,a.input.seq);a.hold=null;a.botIntent='';}
   continue;
  }
  if(a.kind==='human'&&!a.connected&&!a.assistant&&a.disconnectedAt!==null&&s.time-a.disconnectedAt>=10){a.assistant=true;a.input=NEUTRAL(a.controllerEpoch,a.input.seq);a.botNextAt=s.time+0.6;addEvent(s,'assistantJoined',{actorId:a.id});}
  if(a.kind!=='bot'&&!a.assistant)continue;
  if(a.status!=='active'){botInput(s,a,{x:0,z:0});continue;}
  if(s.phase==='preparation'){a.ready=true;botInput(s,a,{x:0,z:0});continue;}
  if(yieldToHuman(s,level,a))continue;
  if(s.time<a.botNextAt){if(a.hold)botInput(s,a,{x:0,z:0},{hand:true});continue;}
  a.botNextAt=s.time+(s.settings.difficulty==='calm'?0.8:s.settings.difficulty==='tense'?0.45:0.65);
  const battery=heldBattery(s,a);
  const visibleThreat=!s.settings.tutorial&&isVisible(s,level,a,s.listener.position,1.6);
  const heard=!s.settings.tutorial?s.noises.filter(n=>(n.type==='listener-step'||n.type==='chase')&&s.time-n.at<1.4).flatMap(n=>{const cue=cueForNoise(level,s.doors,n,a);return cue?[cue]:[];}).at(-1):undefined;
  if(visibleThreat)a.botThreat={position:copy(s.listener.position),until:s.time+4,observed:true};
  else if(heard)a.botThreat={position:copy(heard.position),until:s.time+3,observed:false};
  else if(a.botThreat&&a.botThreat.until<=s.time)a.botThreat=null;
  const hazard=a.botThreat,threatDistance=hazard?distanceXZ(a.position,hazard.position):Infinity;
  const down=s.actors.filter(b=>b.id!==a.id&&b.status==='downed'&&isVisible(s,level,a,b.position,0.5)).sort((b,c)=>distance(a.position,b.position)-distance(a.position,c.position))[0];
  if(down)a.botRescue={id:down.id,position:copy(down.position),until:s.time+Math.min(down.downedRemaining,20)};
  if(a.botRescue&&(a.botRescue.until<=s.time||actor(s,a.botRescue.id)?.status!=='downed'))a.botRescue=null;
  const rescueUnsafe=Boolean(hazard&&a.botRescue&&distanceXZ(hazard.position,a.botRescue.position)<5.5);
  // A held rescue must be interrupted if the actual permitted threat arrives.
  if(hazard&&(visibleThreat&&threatDistance<6||heard?.type==='chase'&&threatDistance<8||rescueUnsafe&&threatDistance<7)){
   a.hold=null;
   if(pointInLift(level,a.position)){a.botIntent='avoid';botInput(s,a,{x:0,z:0},{quiet:true});continue;}
   if(battery)botCommand(s,a,{type:'drop'});
   a.botIntent='avoid';const target=escapePosition(s,level,a,hazard.position);
   const facingUs=visibleThreat&&Math.abs(wrapAngle(Math.atan2(-(a.position.x-s.listener.position.x),-(a.position.z-s.listener.position.z))-s.listener.yaw))<=40*Math.PI/180;
   steerBot(s,level,a,target,threatDistance<3.5||facingUs||heard?.type==='chase');continue;
  }
  if(a.hold){botInput(s,a,{x:0,z:0},{hand:true});continue;}
  if(battery&&battery.leader!==a.id){const leader=actor(s,battery.leader!);if(leader){a.botIntent='carry';botInput(s,a,{x:leader.input.moveX,z:leader.input.moveZ});a.botNextAt=s.time+0.4;}continue;}
  if(battery){
   a.botIntent='deliver';const slot=level.sockets.findIndex((_,i)=>!s.sockets[i]);if(slot<0){botCommand(s,a,{type:'drop'});continue;}
   if(nearSocket(level,battery,slot)>=0){botCommand(s,a,{type:'install',socket:slot});continue;}
   steerBot(s,level,a,level.sockets[slot]);continue;
  }
  if(s.sockets.every(Boolean)){const target=level.spawns[a.seatIndex]??level.spawns[0];a.botIntent='return';if(distanceXZ(a.position,target)>0.5)steerBot(s,level,a,target);else botInput(s,a,{x:0,z:0});continue;}
  if(a.botRescue&&!rescueUnsafe){
   a.botIntent='help';if(down&&down.id===a.botRescue.id&&distance(a.position,down.position)<=1){botCommand(s,a,{type:'revive',actorId:down.id});continue;}
   if(distanceXZ(a.position,a.botRescue.position)>0.7){steerBot(s,level,a,a.botRescue.position,true);continue;}
   if(!down)a.botRescue=null;
  }
  if(hazard&&heard&&threatDistance<8){a.botIntent='avoid';botInput(s,a,{x:0,z:0},{quiet:true});continue;}
  const visibleBatteries=s.batteries.filter(b=>!b.installed&&isVisible(s,level,a,b.position,0.65));for(const b of visibleBatteries)if(!a.knownBatteries.includes(b.id))a.knownBatteries.push(b.id);
  const carried=visibleBatteries.find(b=>b.holders.some(Boolean)&&b.holders.some(id=>!id));const free=visibleBatteries.find(b=>b.holders.every(id=>!id));const human=s.actors.find(b=>b.kind==='human'&&!b.assistant&&b.status==='active');
  const desired=carried??(!s.settings.tutorial?free:undefined);
  if(desired){const h=desired.holders[0]===null?0:1;const point=batteryHandlePositions(desired,true)[h];a.botIntent='takeHandle';if(distance(eye(a.position,0.65),batteryHandlePositions(desired)[h])<=1.05){botCommand(s,a,{type:'takeHandle',batteryId:desired.id,handle:h});continue;}steerBot(s,level,a,point);continue;}
  const mark=s.marks.filter(m=>m.kind==='handle'&&m.expiresAt>s.time).at(-1);if(mark&&distanceXZ(a.position,mark.position)>1){a.botIntent='takeHandle';steerBot(s,level,a,mark.position);continue;}
  if(human&&isVisible(s,level,a,human.position,1.2)&&(s.settings.tutorial||human.carrying||Math.hypot(human.input.moveX,human.input.moveZ)>0.1)){
   a.botIntent='follow';if(distanceXZ(human.position,a.position)>2.4)steerBot(s,level,a,human.position);else botInput(s,a,{x:0,z:0});continue;
  }
  if(s.settings.tutorial){botInput(s,a,{x:0,z:0});continue;}
  a.botIntent='explore';if(a.botTarget&&distanceXZ(a.position,a.botTarget)<0.8)a.botTarget=null;
  if(!a.botTarget){const neighbors=level.portals.filter(p=>!p.channel&&(p.a===a.zoneId||p.b===a.zoneId)).map(p=>p.a===a.zoneId?p.b:p.a);const unvisited=neighbors.filter(id=>!a.seenZones.includes(id));const options=unvisited.length?unvisited:neighbors.filter(id=>id!==level.safeZoneId);const next=options[Math.floor(random(s)*options.length)];if(next)a.botTarget=copy(zoneById(level,next).center);}
  if(a.botTarget)steerBot(s,level,a,a.botTarget);else botInput(s,a,{x:0,z:0});
  // No exploratory knock in a heard danger sector or while a remembered rescue is pending.
  if(!hazard&&!a.botRescue&&s.time-a.lastKnockAt>=7&&a.zoneId!==level.safeZoneId){const nearby=level.resonators.find(r=>r.zoneId===a.zoneId&&distanceXZ(a.position,r.position)<1);if(nearby){a.yaw=Math.atan2(-(nearby.position.x-a.position.x),-(nearby.position.z-a.position.z));a.input.yaw=a.yaw;}botCommand(s,a,{type:'knock'});}
 }
}
function advanceTutorial(s:MissionState,level:KnockLevel):void {
 const t=s.tutorial;if(!t||t.completed)return;const human=s.actors.find(a=>a.kind==='human')!,bot=s.actors.find(a=>a.kind==='bot');
 if(t.step===1&&t.distanceQuiet>=1.5)t.step=2;
 else if(t.step===2&&s.events.some(e=>e.type==='resonator'&&e.actorId===human.id))t.step=3;
 else if(t.step===3&&s.events.some(e=>e.type==='doorOpened'))t.step=4;
 else if(t.step===4&&human.zoneId==='T')t.step=5;
 else if(t.step===5&&t.hadPair)t.step=6;
 // Recover a course saved by the older auto-helper after it installed the
 // held battery. Retry the remaining real carry exercise; never award release.
 else if(t.step===6&&!human.carrying&&!t.released&&s.batteries.some(b=>!b.installed)){t.step=5;t.hadPair=false;}
 else if(t.step===6&&t.released){t.step=7;if(bot){releaseHandle(s,bot);const nearby=snapToFloor(level,{x:human.position.x+0.65,y:human.position.y,z:human.position.z});if(nearby&&canOccupy(level,s.doors,nearby))bot.position=nearby;bot.zoneId=zoneAt(level,bot.position);downActor(s,bot);bot.downedRemaining=90;}}
 else if(t.step===7&&s.events.some(e=>e.type==='revived'&&e.actorId===human.id)){t.step=8;t.lastEvent=null;}
 else if(t.step===8&&t.lastEvent==='knock'){t.step=9;t.lastEvent=null;}
 else if(t.step===9&&t.lastEvent==='resonator'){t.step=10;t.completed=true;finish(s,'full','tutorialComplete');}
}
export function stepMission(s:MissionState,dt=STEP_SECONDS):MissionState {
 if(s.phase==='finished'||s.paused)return s;if(!finite(dt)||dt<=0||dt>0.101)throw new Error('Fixed mission step must be at most 100 ms.');
 s.tick++;if(s.resumeRemaining>0){s.resumeRemaining=Math.max(0,s.resumeRemaining-dt);if(s.resumeRemaining<1e-8)s.resumeRemaining=0;return s;}s.time+=dt;const level=levelForMission(s.settings);
 s.noises=s.noises.filter(n=>s.time-n.at<3);s.echoes=s.echoes.filter(w=>w.clusters.some(c=>c.expiresAt>s.time));s.marks=s.marks.filter(m=>m.expiresAt>s.time);
 if(s.phase==='preparation'){s.preparationRemaining=Math.max(0,s.preparationRemaining-dt);if(s.preparationRemaining<=0||s.actors.every(a=>a.ready)){s.phase='active';s.preparationRemaining=0;addEvent(s,'missionStarted');}}
 advanceBots(s,level);moveActors(s,level,dt);advanceDoorsAndHolds(s,level,dt);
 const fired=s.timers.filter(t=>t.firesAt<=s.time);s.timers=s.timers.filter(t=>t.firesAt>s.time);for(const timer of fired){emitNoise(s,'timer',eye(timer.position,0.15),78,13,timer.ownerId);addEvent(s,'timerFired',{actorId:timer.ownerId,zoneId:timer.zoneId});}
 if(s.phase==='active'){
  advanceListener(s,level,dt);advanceReturns(s,level,dt);if(s.phase!=='active')return s;advanceTutorial(s,level);if(s.phase!=='active')return s;
  if(!s.settings.tutorial)s.remaining=Math.max(0,s.remaining-dt);
  for(const seconds of [240,60,15])if(s.remaining<=seconds&&!s.warningFlags.includes(seconds)){s.warningFlags.push(seconds);addEvent(s,'reserveWarning',{value:seconds});}
  if(s.sockets.every(Boolean)&&s.actors.every(a=>a.status==='active'&&pointInLift(level,a.position))){s.evacuationSince??=s.time;if(s.time-s.evacuationSince+1e-8>=2)finish(s,'full','allEvacuated');}else s.evacuationSince=null;
  if(s.phase==='active'&&s.remaining<=0){const human=s.actors.some(a=>a.kind==='human'&&a.connected&&!a.assistant&&a.status==='active'&&pointInLift(level,a.position));finish(s,s.sockets.every(Boolean)&&human?'partial':'defeat',s.sockets.every(Boolean)&&human?'reservePartial':'reserveExpired');}
 }
 return s;
}
export function advanceMission(s:MissionState,seconds:number):MissionState {let left=Math.max(0,seconds);while(left>1e-8&&s.phase!=='finished'){const dt=Math.min(STEP_SECONDS,left);stepMission(s,dt);left-=dt;}return s;}
function publicActor(a:Actor):PublicActor{return {pose:a.status==='downed'||a.status==='returning'?'down':a.carrying?'carry':a.hold?.type==='revive'?'revive':Math.hypot(a.input.moveX,a.input.moveZ)>0.05?(a.input.quiet?'quiet':a.input.run&&a.stamina>0?'run':'walk'):'idle',id:a.id,name:a.name,seatIndex:a.seatIndex,kind:a.kind,assistant:a.assistant,position:copy(a.position),yaw:a.yaw,pitch:a.pitch,zoneId:a.zoneId,status:a.status,carrying:a.carrying,downedRemaining:a.downedRemaining,protectedUntil:a.protectedUntil,botIntent:a.kind==='bot'||a.assistant?a.botIntent:'',connected:a.connected};}
export function viewForParticipant(s:MissionState,id:string):PlayerView {
 const a=actor(s,id);if(!a)throw new Error('Participant is not in this mission.');const level=levelForMission(s.settings);
 const cues=s.noises.flatMap(n=>{const cue=cueForNoise(level,s.doors,n,{position:a.position,zoneId:a.zoneId,yaw:a.yaw});return cue?[cue]:[];});
 const listenerVisible=isVisible(s,level,a,s.listener.position,1.6)&&!pointInLift(level,s.listener.position);
 const echoes=s.echoes.map(w=>{const noise=s.noises.find(n=>n.id===w.id),friendly=noise?.actorId===a.id||Boolean(noise?.actorId&&['knock','resonator','click','call'].includes(noise.type));if(friendly||isVisible(s,level,a,w.source,0))return {...w,source:copy(w.source),clusters:w.clusters.map(c=>({...c}))};const cue=cues.find(c=>c.id===w.id),fallback=level.echoClusters.find(c=>c.id===w.clusters[0]?.id)?.center??a.position;const source=cue?.position??fallback;return {...w,source:copy(source),zoneId:zoneAt(level,source),clusters:w.clusters.map(c=>({...c}))};});
 const events=s.events.filter(e=>{if(e.type==='chase')return listenerVisible||cues.some(c=>c.type==='chase'&&Math.abs(c.at-e.at)<0.1);if(e.type.startsWith('door')){const p=level.portals.find(p=>p.id===e.targetId);return Boolean(p&&distanceXZ(p.position,a.position)<8);}return true;}).slice(-30);
 return {version:s.version,wireVersion:s.wireVersion,levelId:level.id,settings:{...s.settings},tick:s.tick,time:s.time,revision:s.revision,phase:s.phase,preparationRemaining:s.preparationRemaining,remaining:s.remaining,resumeRemaining:s.resumeRemaining,paused:s.paused,self:{...publicActor(a),stamina:a.stamina,timer:a.timer,controllerEpoch:a.controllerEpoch,acknowledgedSeq:a.input.seq,knockReadyIn:Math.max(0,2.5-(s.time-a.lastKnockAt)),hold:a.hold?{...a.hold,origin:copy(a.hold.origin)}:null,notice:a.noticedUntil>s.time?a.notice:null},team:s.actors.map(p=>({id:p.id,name:p.name,seatIndex:p.seatIndex,kind:p.kind,assistant:p.assistant,status:p.status,connected:p.connected,carrying:Boolean(p.carrying),inLift:pointInLift(level,p.position),downedRemaining:p.downedRemaining,ready:p.ready,saves:p.saves})),actors:s.actors.filter(p=>p.id!==id&&isVisible(s,level,a,p.position,p.status==='downed'?0.45:1.3)).map(publicActor),batteries:s.batteries.filter(b=>b.installed||b.holders.includes(id)||isVisible(s,level,a,b.position,0.65)).map(b=>({id:b.id,position:copy(b.position),yaw:b.yaw,zoneId:b.zoneId,holders:[...b.holders],installed:b.installed,socket:b.socket,revision:b.revision,obstruction:b.obstruction})),doors:s.doors.map(d=>({...d,actorId:d.actorId==='listener'?null:d.actorId})),sockets:[...s.sockets],cabinetTimers:s.cabinetTimers,charges:s.charges,listener:listenerVisible?{position:copy(s.listener.position),yaw:s.listener.yaw,lunging:s.listener.lungeAt!==null,visibleUntil:s.time+0.7}:null,cues,echoes,marks:s.marks.map(m=>({...m,position:copy(m.position)})),timers:s.timers.filter(t=>t.ownerId===id||isVisible(s,level,a,t.position,0.2)).map(t=>({...t,position:copy(t.position)})),discoveredZones:[...s.discoveredZones],objectiveSectors:[level.pedestals.filter(p=>p.group===0).map(p=>p.zoneId),level.pedestals.filter(p=>p.group===1).map(p=>p.zoneId)],prompt:interactionPrompt(s,id),knockKind:knockTarget(s,id).kind,events:events.map(e=>({...e})),outcome:s.outcome?{...s.outcome,evacuated:[...s.outcome.evacuated],echoes:s.outcome.echoes.map(e=>({...e}))}:null,tutorial:s.tutorial?{...s.tutorial,origin:copy(s.tutorial.origin)}:null};
}
