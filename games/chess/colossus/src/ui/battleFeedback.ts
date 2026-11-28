import { bossCells } from '../core';
import type { GameState, PromotionType } from '../core';

export interface UnitFeedback {
 key:number;attack:boolean;damage:number;absorbed:number;invulnerable:boolean;
 /** Cosmetic direction toward the body; collision/damage always comes from the core. */
 direction:[number,number];
 square:number|null;promotion?:PromotionType;killed:boolean;
}
export interface BattleFeedback {
 key:number;units:Record<string,UnitFeedback>;bossDamage:number;bossArmor:number;
 bossStrike:boolean;bossArmorBroken:boolean;rays:number[][];fire:number[];
}
/** Relates committed events to the intent that actually resolved, never the newly announced one. */
export function battleFeedback(before:GameState,after:GameState):BattleFeedback|null{
 if(before===after||before.revision>=after.revision)return null;
 const events=after.events;
 if(!events.some(e=>['attack','damage','fire','shield','round','blocked','promote','death'].includes(e.type)))return null;
 const center=bossCells(before.boss).reduce((v,s)=>[v[0]+s%8,v[1]+Math.floor(s/8)] as [number,number],[0,0] as [number,number]).map(x=>x/bossCells(before.boss).length);
 const units:Record<string,UnitFeedback>={};
 for(const event of events){
  if(!event.unitId||!['attack','damage','shield','promote','death'].includes(event.type))continue;
  const unit=before.units.find(u=>u.id===event.unitId);
  if(!unit)continue;
  const sq=event.to??unit.square,dx=sq===null?0:center[0]-sq%8,dz=sq===null?0:Math.floor(sq/8)-center[1],length=Math.hypot(dx,dz)||1;
  const reaction:UnitFeedback=units[unit.id]??{key:after.revision,attack:false,damage:0,absorbed:0,invulnerable:false,direction:[dx/length,dz/length],square:sq,killed:false};
  if(event.type==='attack')reaction.attack=true;
  if(event.type==='death')reaction.killed=true;
  if(event.type==='promote'&&['Q','R','B','N'].includes(event.key??''))reaction.promotion=event.key as PromotionType;
  if(event.type==='damage'){reaction.damage+=event.amount??0;reaction.absorbed+=event.absorbed??0;reaction.invulnerable||=event.key==='invulnerable';}
  if(event.type==='shield')reaction.invulnerable||=event.key==='invulnerable';
  units[unit.id]=reaction;
 }
 const response=events.some(e=>e.type==='damage'||e.type==='fire'||e.type==='round'||e.type==='blocked'||e.type==='move'&&e.unitId==='boss');
 const blocked=new Set(events.filter(e=>e.type==='blocked').map(e=>e.step));
 const rays:number[][]=[];
 if(response&&!before.intent.rest)before.intent.steps.forEach((step,index)=>{
  if(step.kind!=='rays'||before.intent.cancelledStep===index||blocked.has(index))return;
  for(const ray of step.rays??[]){
   const hits=events.filter(e=>e.type==='damage'&&e.step===index&&e.to!==undefined&&ray.includes(e.to)).map(e=>ray.indexOf(e.to!));
   rays.push(hits.length?ray.slice(0,Math.min(...hits)+1):ray);
  }
 });
 return{
  key:after.revision,units,
  bossArmorBroken:before.boss.armor>0&&after.boss.armor===0,
  bossDamage:events.filter(e=>e.type==='attack').reduce((n,e)=>n+(e.hp??0),0),
  bossArmor:events.filter(e=>e.type==='attack').reduce((n,e)=>n+(e.armor??0),0),
  bossStrike:response&&!before.intent.rest&&before.intent.steps.some((step,index)=>step.kind!=='move'&&before.intent.cancelledStep!==index&&!blocked.has(index)),
  rays:rays.filter(r=>r.length>0),
  fire:[...new Set(events.filter(e=>e.type==='fire').flatMap(e=>e.cells??[]))],
 };
}
