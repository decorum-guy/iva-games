import { expect, it } from 'vitest';
import { applyCommand, connectParticipant, createMission, stepMission } from '../src';

it('runs actual permitted bot policies through full mixed missions on all three routes',()=>{
 const results=[];
 for(const route of ['archive','pump','relay'] as const){
  const s=createMission({seed:31,settings:{route,difficulty:'calm'},participants:Array.from({length:5},(_,i)=>({participantId:`p${i}`,displayName:i===0?'Idle test human':`BOT ${i}`,kind:i===0?'human' as const:'bot' as const}))});connectParticipant(s,'p0');applyCommand(s,'p0',{actionId:'ready',controllerEpoch:s.actors[0].controllerEpoch,payload:{type:'ready'}});
  let ticks=0;while(s.phase!=='finished'&&ticks++<26_000)stepMission(s);
  expect(s.phase).toBe('finished');expect(s.batteries).toHaveLength(2);expect(new Set(s.batteries.map(b=>b.id)).size).toBe(2);
  results.push({route,seed:s.seed,seconds:s.time,outcome:s.outcome?.kind,reason:s.outcome?.reason,sockets:s.sockets,charges:s.charges,downs:s.events.filter(e=>e.type==='downed').length,actors:s.actors.map(a=>({id:a.id,zone:a.zoneId,status:a.status,intent:a.botIntent,position:a.position,carrying:a.carrying})),batteries:s.batteries.map(b=>({id:b.id,zone:b.zoneId,position:b.position,holders:b.holders,obstruction:b.obstruction}))});
 }
 console.log(JSON.stringify({simulation:'three full calm missions; human remains idle in lift, four real bot policies',results}));
},90_000);
