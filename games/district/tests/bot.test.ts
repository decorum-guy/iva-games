import { describe, expect, it } from 'vitest';
import type { BotDifficulty, Participant } from '@iva-games/session-kit';
import { chooseDistrictBotAction, safeDistrictBotAction } from '../src/bot';
import { advanceDistrictTime, applyDistrictAction, assertDistrictInvariants, createDistrictState, emptyBundle, reservedAssets } from '../src/core';
import { DISTRICT_MAPS, getDistrictMap } from '../src/maps';
import { viewDistrict } from '../src/view';
import type { DistrictAction, DistrictState, Resources } from '../src/types';

const human:Participant={participantId:'human',playerId:'user',displayName:'Human',seatIndex:0,controller:{kind:'human',playerId:'user'}};
const bot=(n:number,difficulty:BotDifficulty='normal'):Participant=>({participantId:`bot${n}`,playerId:null,displayName:`Bot ${n}`,seatIndex:n,controller:{kind:'bot',botProfileId:`district:${difficulty}`,botVersion:'1',difficulty}});
const initial=(count=3,mapId='crossroads',difficulty:BotDifficulty='normal')=>createDistrictState({matchId:'m',roomId:'r',participants:[human,...Array.from({length:count-1},(_,n)=>bot(n+1,difficulty))],map:getDistrictMap(mapId),now:1000,seed:'bot-test-seed'});
function negotiation():DistrictState { let s=initial();for(const p of s.players) s=applyDistrictAction(s,p.participant.participantId,{type:'choose-goal',goal:p.goalOptions[0]},1001);return s; }
const resources=(coins=0,materials=0,crews=0):Resources=>({coins,materials,crews});
const act=(s:DistrictState,pid:string,action:DistrictAction,now=1002)=>applyDistrictAction(s,pid,action,now);

describe('District bot information and safety',()=>{
  it('has deterministic decisions from a permitted view; changing private opponent state does not affect them',()=>{
    const s=negotiation(),v=viewDistrict(s,'bot1',2000),before=structuredClone(v);
    const chosen=chooseDistrictBotAction(v,'hard','independent-policy-seed');expect(v).toEqual(before);
    const changed=structuredClone(s);changed.seed='different-game-secret';changed.eventDeck.reverse();changed.players[0].goal='industry';changed.players[0].goalOptions=['industry','quality'];
    expect(viewDistrict(changed,'bot1',2000)).toEqual(v);
    expect(chooseDistrictBotAction(viewDistrict(changed,'bot1',2000),'hard','independent-policy-seed')).toEqual(chosen);
  });
  it('evaluates complete packages and refuses an asset strip disguised as a cheap exchange',()=>{
    let s=negotiation();const cell=s.cells.find(c=>c.id==='A1')!;cell.ownerId='bot1';cell.building={kind:'workshop',level:2};
    s=act(s,'human',{type:'offer-trade',targetId:'bot1',give:{...emptyBundle(),coins:1},receive:{...emptyBundle(),lots:['A1']}});
    for(const difficulty of ['easy','normal','hard'] as const) expect(chooseDistrictBotAction(viewDistrict(s,'bot1'),difficulty,'trade')?.type).not.toBe('accept-trade');
  });
  it('accepts a useful incoming offer and proposes fresh counter terms for an overpriced one',()=>{
    let s=negotiation();s.players[1].resources=resources(12,0,2);
    s=act(s,'human',{type:'offer-trade',targetId:'bot1',give:{...emptyBundle(),materials:1},receive:{...emptyBundle(),coins:1}});
    const accepted=chooseDistrictBotAction(viewDistrict(s,'bot1'),'hard','trade')!;expect(accepted.type).toBe('accept-trade');s=act(s,'bot1',accepted);
    s=act(s,'human',{type:'offer-trade',targetId:'bot1',give:{...emptyBundle(),materials:1},receive:{...emptyBundle(),coins:4}});
    const counter=chooseDistrictBotAction(viewDistrict(s,'bot1'),'normal','counter')!;expect(counter.type).toBe('counter-trade');
    const previous=s.offers.at(-1)!.id;s=act(s,'bot1',counter);expect(s.offers.at(-1)?.authorId).toBe('bot1');expect(s.offers.find(o=>o.id===previous)?.status).toBe('replaced');
  });
  it('initiates a trade for missing construction resources',()=>{
    const s=negotiation();s.players[1].resources=resources(8,0,2);s.cells.find(c=>c.id==='A1')!.ownerId='bot1';
    const proposal=chooseDistrictBotAction(viewDistrict(s,'bot1'),'normal','propose')!;expect(proposal.type).toBe('offer-trade');expect(()=>act(s,'bot1',proposal)).not.toThrow();
  });
  it('uses a legal bank fallback with a bounded phase-local budget',()=>{
    const s=negotiation();s.players[1].resources=resources(12,0,2);s.players[0].resources.materials=0;s.players[2].resources.materials=0;
    s.cells.find(c=>c.id==='A1')!.ownerId='bot1';
    const decision=chooseDistrictBotAction(viewDistrict(s,'bot1'),'normal','bank')!;expect(decision.type).toBe('bank');
    const next=act(s,'bot1',decision);expect(next.players[1].botMemory.bankActions).toBe(1);expect(reservedAssets(next,'bot1').materials).toBe(0);
  });
  it('proposes a shared park and a second policy signs a worthwhile exact share',()=>{
    let s=negotiation();
    for(const [id,pid] of [['A2','bot1'],['A4','bot2']]) { const c=s.cells.find(c=>c.id===id)!;c.ownerId=pid;c.building={kind:'house',level:1}; }
    const proposal=chooseDistrictBotAction(viewDistrict(s,'bot1'),'normal','park')!;expect(proposal.type).toBe('offer-park');
    s=act(s,'bot1',proposal);const signed=chooseDistrictBotAction(viewDistrict(s,'bot2'),'normal','sign')!;expect(signed.type).toBe('sign-park');
    s=act(s,'bot2',signed);expect(s.cells.find(c=>c.id==='A3')?.completed).toBe(true);
  });
  it('limits four new cards, spaces initiatives and rejects unchanged refused conditions',()=>{
    let s=negotiation();const give={...emptyBundle(),coins:1},receive={...emptyBundle(),materials:1};
    const proposal:DistrictAction={type:'offer-trade',targetId:'human',give,receive};
    s=act(s,'bot1',proposal,2000);let offer=s.offers.at(-1)!;
    expect(()=>act(s,'bot1',{type:'offer-trade',targetId:'bot2',give,receive},2001)).toThrow('подождать');
    s=act(s,'human',{type:'decline-offer',offerId:offer.id,version:offer.version},2002);
    expect(()=>act(s,'bot1',proposal,12000)).toThrow('другие условия');
    for(let i=1;i<4;i++) {s=act(s,'bot1',{type:'offer-trade',targetId:'human',give:{...give,coins:i+1},receive},2000+10000*i);offer=s.offers.at(-1)!;s=act(s,'bot1',{type:'cancel-offer',offerId:offer.id,version:offer.version},2001+10000*i);}
    expect(s.players[1].botMemory.created).toBe(4);expect(()=>act(s,'bot1',{type:'offer-trade',targetId:'human',give:{...give,coins:5},receive},42000)).toThrow('закончил предложения');
  });
  it('safe fallback is ready without changing any human seat',()=>{
    const s=negotiation();expect(safeDistrictBotAction(viewDistrict(s,'bot1'))).toEqual({type:'ready',ready:true});expect(s.players[0].ready).toBe(false);
  });
});

describe('complete deterministic policy games',()=>{
  // Explicit internal harness; public initialization/API still requires a human.
  it.each(DISTRICT_MAPS.flatMap(map=>[2,3,4].map(count=>({mapId:map.id,count}))))('finishes $mapId with $count seats through real validators',({mapId,count})=>{
    let s=initial(count,mapId,'normal');const first=bot(0,'hard');first.participantId='human';
    s.participants[0]=structuredClone(first);s.players[0].participant=structuredClone(first);
    let now=1001,decisions=0,iterations=0;
    while(s.phase!=='finished' && iterations++<2500) {
      let progressed=false;
      for(const p of s.players) {
        const difficulty=p.participant.controller.kind==='bot'?p.participant.controller.difficulty:'normal';
        const a=chooseDistrictBotAction(viewDistrict(s,p.participant.participantId,now),difficulty,`${iterations}:${p.participant.participantId}`);
        if(!a) continue;
        s=applyDistrictAction(s,p.participant.participantId,a,now);decisions++;progressed=true;
        assertDistrictInvariants(s);if(s.phase==='finished')break;
      }
      if(!progressed) {now=s.deadlineAt!;s=advanceDistrictTime(s,now);} else now+=100;
    }
    expect(s.phase).toBe('finished');expect(s.outcome?.reason).toBe('completed');expect(decisions).toBeGreaterThan(count*6);
    expect(s.history.filter(h=>h.type==='income')).toHaveLength(s.totalRounds);
    expect(s.players.every(p=>Object.values(p.resources).every(v=>Number.isSafeInteger(v)&&v>=0))).toBe(true);
  });
});
