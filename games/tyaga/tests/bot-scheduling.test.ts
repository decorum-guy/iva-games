import { expect,it } from 'vitest';
import { NEUTRAL_INPUT } from '../src/core/config';
import { TyagaWorld } from '../src/server-world/world';
import { evidence } from './evidence';

const participants=Array.from({length:6},(_,seatIndex)=>({participantId:`p${seatIndex}`,displayName:`P${seatIndex}`,seatIndex,bot:seatIndex>0}));
const create=()=>TyagaWorld.create({matchId:'bot-scheduling',mapId:'ridge',mode:'practice',participants});
function observeDecisions(w:TyagaWorld){
 const events:{tick:number;participantId:string}[]=[],view=w.view.bind(w);
 w.view=pid=>{events.push({tick:w.state.tick,participantId:pid});return view(pid);};return events;
}

it('keeps every bot at ten decisions per second without simultaneous decision bursts',async()=>{
 const w=await create();try{
  const events=observeDecisions(w);for(let i=0;i<120;i++)w.step({p0:{...NEUTRAL_INPUT}});
  const counts=Array.from({length:120},(_,tick)=>events.filter(e=>e.tick===tick).length);
  evidence('R05-bot-decision-cadence',{fixedSteps:120,maxDecisionsInOneStep:Math.max(...counts),counts,events});
  expect(Math.max(...counts)).toBeLessThanOrEqual(1);
  for(const p of participants.filter(p=>p.bot)){
   const ticks=events.filter(e=>e.participantId===p.participantId).map(e=>e.tick);expect(ticks).toHaveLength(20);
   for(let i=1;i<ticks.length;i++)expect(ticks[i]-ticks[i-1]).toBe(6);
  }
 }finally{w.dispose();}
});

it('restores a snapshot between decision phases and repeats the same decisions and physics',async()=>{
 const w=await create();let restored:TyagaWorld|undefined;try{
  for(let i=0;i<67;i++)w.step({p0:{...NEUTRAL_INPUT,moveX:.4,moveZ:.2}});
  restored=await TyagaWorld.restore(w.serialize());expect(restored.serialize()).toBe(w.serialize());
  const originalEvents=observeDecisions(w),restoredEvents=observeDecisions(restored);
  for(let i=0;i<90;i++){const input={p0:{...NEUTRAL_INPUT,moveX:i<45?.5:-.3,moveZ:.2}};w.step(input);restored.step(input);}
  expect(restoredEvents).toEqual(originalEvents);expect(restored.serialize()).toBe(w.serialize());
  evidence('R05-bot-phased-recovery',{startTick:67,endTick:w.state.tick,decisions:originalEvents,exactSnapshotReplay:true});
 }finally{restored?.dispose();w.dispose();}
});

it('waits neutrally for a returned bot seat instead of replaying an old cached command',async()=>{
 const w=await create();try{
  for(let i=0;i<8;i++)w.step();expect(w.state.characters.p1.botMemory.input).toBeDefined();
  w.setControllers([{participantId:'p1',kind:'human',connected:true,controllerGeneration:1}]);
  for(let i=0;i<2;i++)w.step({p1:{...NEUTRAL_INPUT,moveX:-1}});
  w.setControllers([{participantId:'p1',kind:'bot',connected:false,controllerGeneration:2}]);
  const events=observeDecisions(w);
  for(let i=0;i<3;i++){w.step();expect(w.inputs.p1).toEqual(NEUTRAL_INPUT);}
  expect(events.filter(e=>e.participantId==='p1')).toHaveLength(0);
  w.step();expect(events.filter(e=>e.participantId==='p1')).toEqual([{tick:13,participantId:'p1'}]);
  expect(w.state.characters.p1.botMemory.input).toBeDefined();
  evidence('R05-bot-controller-phase',{neutralTicks:[10,11,12],firstDecisionTick:13,controllerGeneration:w.state.characters.p1.controller.controllerGeneration});
 }finally{w.dispose();}
});
