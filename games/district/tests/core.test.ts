import { describe, expect, it } from 'vitest';
import type { Participant } from '@iva-games/session-kit';
import { advanceDistrictTime, applyDistrictAction, assertDistrictInvariants, availableResources, buildingValue, calculateIncome, createDistrictState, emptyBundle, goalSatisfied, parseDistrictAction, reservedAssets, roundOrder } from '../src/core';
import { getDistrictMap } from '../src/maps';
import { sha256Words } from '../src/random';
import { viewDistrict } from '../src/view';
import type { BuildingKind, Bundle, DistrictAction, DistrictState, GoalId, Resources } from '../src/types';

const person=(i:number,bot=false):Participant=>({participantId:`p${i}`,playerId:bot?null:`u${i}`,displayName:`Player ${i}`,seatIndex:i,
  controller:bot?{kind:'bot',difficulty:'normal',botProfileId:'district:normal',botVersion:'1'}:{kind:'human',playerId:`u${i}`}});
const fresh=(count=3)=>createDistrictState({matchId:'match',roomId:'room',participants:Array.from({length:count},(_,i)=>person(i)),map:getDistrictMap('crossroads'),now:1000,seed:'test-seed'});
const action=(s:DistrictState,pid:string,a:DistrictAction,now=1001)=>applyDistrictAction(s,pid,a,now);
function negotiate(count=3):DistrictState {
  let s=fresh(count); for(const p of s.players) s=action(s,p.participant.participantId,{type:'choose-goal',goal:p.goalOptions[0]}); return s;
}
const resources=(coins=0,materials=0,crews=0):Resources=>({coins,materials,crews});
const bundle=(coins=0,materials=0,crews=0,lots:string[]=[]):Bundle=>({coins,materials,crews,lots});
const openTrade=(s:DistrictState,author='p0',target='p1',give=bundle(1),receive=bundle(0,1))=>action(s,author,{type:'offer-trade',targetId:target,give,receive});
const lastOffer=(s:DistrictState)=>s.offers.at(-1)!;
const ref=(s:DistrictState)=>({offerId:lastOffer(s).id,version:lastOffer(s).version});
function own(s:DistrictState,lotId:string,pid:string,kind?:BuildingKind,level:1|2=1):void {
  const cell=s.cells.find(c=>c.id===lotId)!; cell.ownerId=pid; cell.building=kind?{kind,level}:null;
}
function auction(s=negotiate()):DistrictState { for(const p of s.players) if(!p.left) s=action(s,p.participant.participantId,{type:'ready',ready:true}); return s; }
function development(s=auction()):DistrictState { for(const p of s.players) if(s.phase==='auction' && !p.bidConfirmed) s=action(s,p.participant.participantId,{type:'confirm-bid'}); return s; }

describe('District initialization and parsing',()=>{
  it('pins a deep map/roster snapshot and deterministic independent randomness',()=>{
    const map=getDistrictMap('crossroads'),participants=[person(0),person(1,true)];
    const input={matchId:'m',roomId:'r',participants,map,now:0,seed:'0123456789abcdef'.repeat(4)};
    const s=createDistrictState(input); expect(createDistrictState(input)).toEqual(s);
    map.rows[0]='.....'; participants[0].displayName='changed';
    expect(s.map.rows[0]).toBe('..P..'); expect(s.participants[0].displayName).toBe('Player 0');
    expect(s.players.every(p=>p.resources.coins===12 && new Set(p.goalOptions).size===2)).toBe(true);
    expect(s.eventDeck).toHaveLength(12); expect(s.totalRounds).toBe(6); expect(fresh(4).totalRounds).toBe(8);
    expect(s.players[0].goalOptions).not.toBe(s.players[1].goalOptions);
  });
  it('SHA-256 matches the public known-answer vector',()=>{
    expect(sha256Words('abc').map(n=>n.toString(16).padStart(8,'0')).join('')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('rejects all-bot public games, duplicate seats/accounts and unsupported roster',()=>{
    const create=(participants:Participant[])=>createDistrictState({matchId:'m',roomId:'r',participants,map:getDistrictMap('crossroads'),now:0,seed:'x'});
    expect(()=>create([person(0,true),person(1,true)])).toThrow();
    expect(()=>create([person(0),person(0)])).toThrow();
    expect(()=>create([person(0)])).toThrow();
    const duplicate=person(1); duplicate.playerId='u0'; duplicate.controller={kind:'human',playerId:'u0'};
    expect(()=>create([person(0),duplicate])).toThrow();
  });
  it.each([-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects invalid quantity %s',(quantity)=>{
    expect(()=>parseDistrictAction({type:'bank',resource:'materials',direction:'buy',quantity})).toThrow();
  });
  it('rejects unknown fields, fake resources, duplicated lots and zero bank counts',()=>{
    expect(()=>parseDistrictAction({type:'work',coins:99})).toThrow();
    expect(()=>parseDistrictAction({type:'bank',resource:'coins',direction:'buy',quantity:1})).toThrow();
    expect(()=>parseDistrictAction({type:'bank',resource:'crews',direction:'buy',quantity:0})).toThrow();
    expect(()=>parseDistrictAction({type:'offer-trade',targetId:'p1',give:bundle(0,0,0,['A1','A1']),receive:bundle(2)})).toThrow();
  });
});

describe('resources, deals and reservations',()=>{
  it('reserves the author only; failed bank and failed replacement preserve the original card exactly',()=>{
    let s=openTrade(negotiate(),'p0','p1',bundle(11),bundle(0,1));
    expect(availableResources(s,'p0').coins).toBe(1); expect(s.players[0].resources.coins).toBe(12);
    expect(reservedAssets(s,'p1')).toEqual(emptyBundle());
    const before=structuredClone(s);
    expect(()=>action(s,'p0',{type:'bank',resource:'materials',direction:'buy',quantity:1})).toThrow();
    expect(()=>action(s,'p0',{type:'replace-trade',...ref(s),targetId:'p1',give:bundle(13),receive:bundle(0,1)})).toThrow();
    expect(s).toEqual(before);
    s=action(s,'p0',{type:'replace-trade',...ref(s),targetId:'p1',give:bundle(12),receive:bundle(0,1)});
    expect(availableResources(s,'p0').coins).toBe(0); expect(s.offers[0].status).toBe('replaced');
  });
  it('executes the normative two-party exchange atomically and conserves all resources',()=>{
    let s=negotiate(); s.players[0].resources=resources(4,0,2); s.players[1].resources=resources(2,2,0);
    s=openTrade(s,'p0','p1',bundle(1,0,1),bundle(0,1)); s=action(s,'p1',{type:'accept-trade',...ref(s)});
    expect(s.players.slice(0,2).map(p=>p.resources)).toEqual([resources(3,1,1),resources(3,1,1)]);
    expect(reservedAssets(s,'p0')).toEqual(emptyBundle()); expect(s.history.at(-1)?.type).toBe('trade');
  });
  it('never borrows incoming payment to afford a trade, and competing acceptances cannot overspend',()=>{
    let s=negotiate(); s.players[1].resources=resources(0,1,0);
    s=openTrade(s,'p0','p1',bundle(1),bundle(0,1)); const first=ref(s);
    s=openTrade(s,'p2','p1',bundle(1),bundle(0,1)); const second=ref(s);
    s=action(s,'p1',{type:'accept-trade',...first}); const snapshot=structuredClone(s);
    expect(()=>action(s,'p1',{type:'accept-trade',...second})).toThrow(); expect(s).toEqual(snapshot);
    expect(lastOffer(s).status).toBe('open'); expect(s.players[1].resources).toEqual(resources(1,0,0));
  });
  it('permits an empty-lot swap but refuses a second empty lot after final combined ownership',()=>{
    let s=negotiate(); own(s,'A1','p0'); own(s,'E5','p1');
    s=openTrade(s,'p0','p1',bundle(0,0,0,['A1']),bundle(0,0,0,['E5'])); s=action(s,'p1',{type:'accept-trade',...ref(s)});
    expect(s.cells.find(c=>c.id==='A1')?.ownerId).toBe('p1'); expect(s.cells.find(c=>c.id==='E5')?.ownerId).toBe('p0');
    s=openTrade(s,'p0','p1',bundle(1),bundle(0,0,0,['A1'])); const before=structuredClone(s);
    expect(()=>action(s,'p1',{type:'accept-trade',...ref(s)})).toThrow('одним пустым'); expect(s).toEqual(before);
  });
  it('counteroffers require a fresh acceptance and do not retain prior reservations',()=>{
    let s=openTrade(negotiate()); const original=ref(s);
    s=action(s,'p1',{type:'counter-trade',...original,give:bundle(0,1),receive:bundle(2)});
    expect(availableResources(s,'p0').coins).toBe(12); expect(availableResources(s,'p1').materials).toBe(1);
    expect(()=>action(s,'p1',{type:'accept-trade',...original})).toThrow('изменилось');
    s=action(s,'p0',{type:'accept-trade',...ref(s)}); expect(s.players[0].resources.coins).toBe(10);
  });
  it('rejects gifts, same-resource round trips, reserved properties and a fourth open initiation',()=>{
    let s=negotiate(); own(s,'A1','p0');
    expect(()=>openTrade(s,'p0','p1',bundle(),bundle(1))).toThrow();
    expect(()=>openTrade(s,'p0','p1',bundle(1),bundle(2))).toThrow();
    s=openTrade(s,'p0','p1',bundle(0,0,0,['A1']),bundle(3));
    expect(()=>openTrade(s,'p0','p2',bundle(0,0,0,['A1']),bundle(3))).toThrow();
    s=openTrade(s); s=openTrade(s,'p0','p2'); expect(()=>openTrade(s)).toThrow('закройте');
  });
  it('bank buy/sell prices are 3/1 and publicly change all readiness',()=>{
    let s=negotiate(); s=action(s,'p1',{type:'ready',ready:true}); s=action(s,'p0',{type:'bank',resource:'materials',direction:'buy',quantity:2});
    expect(s.players[0].resources).toEqual(resources(6,4,2)); expect(s.players.every(p=>!p.ready)).toBe(true);
    s=action(s,'p0',{type:'bank',resource:'materials',direction:'sell',quantity:2}); expect(s.players[0].resources).toEqual(resources(8,2,2));
  });
});

describe('joint parks and negotiation boundaries',()=>{
  const contributions=[{participantId:'p0',resources:resources(3)},{participantId:'p1',resources:resources(1,1)},{participantId:'p2',resources:resources(0,0,1)}];
  const offerPark=(s:DistrictState)=>action(s,'p0',{type:'offer-park',parkId:'A3',contributions});
  it('charges all exact signed shares once, completing only at the final signature',()=>{
    let s=offerPark(negotiate()); const parkRef=ref(s);
    s=action(s,'p1',{type:'sign-park',...parkRef}); expect(s.cells.find(c=>c.id==='A3')?.completed).toBe(false);
    expect(reservedAssets(s,'p0').coins).toBe(3); expect(s.players[0].resources.coins).toBe(12);
    s=action(s,'p2',{type:'sign-park',...parkRef}); expect(s.players.map(p=>p.resources)).toEqual([resources(9,2,2),resources(11,1,2),resources(12,2,1)]);
    expect(s.cells.find(c=>c.id==='A3')?.sponsors).toEqual(contributions); expect(s.players.every(p=>reservedAssets(s,p.participant.participantId).coins===0)).toBe(true);
  });
  it('refusal or participant exit releases every signer without payment',()=>{
    let s=offerPark(negotiate()); s=action(s,'p1',{type:'sign-park',...ref(s)});
    const balances=s.players.map(p=>structuredClone(p.resources));
    const declined=action(s,'p2',{type:'decline-offer',...ref(s)});
    expect(declined.players.map(p=>p.resources)).toEqual(balances); expect(reservedAssets(declined,'p0')).toEqual(emptyBundle());
    s=action(s,'p2',{type:'leave'}); expect(lastOffer(s).status).toBe('cancelled'); expect(reservedAssets(s,'p1')).toEqual(emptyBundle());
  });
  it('first completion cancels competing park contracts and releases their shares',()=>{
    let s=offerPark(negotiate());
    s=action(s,'p1',{type:'offer-park',parkId:'A3',contributions:[{participantId:'p1',resources:resources(4,1,1)}]});
    expect(s.offers[0].status).toBe('cancelled'); expect(s.offers[1].status).toBe('completed'); expect(s.players[0].resources.coins).toBe(12);
    expect(reservedAssets(s,'p0')).toEqual(emptyBundle()); expect(()=>action(s,'p2',{type:'sign-park',offerId:s.offers[0].id,version:1})).toThrow();
  });
  it('failed park replacement leaves old signed reservations intact',()=>{
    let s=offerPark(negotiate()); s=action(s,'p1',{type:'sign-park',...ref(s)}); const snapshot=structuredClone(s);
    expect(()=>action(s,'p0',{type:'replace-park',...ref(s),parkId:'E3',contributions:[{participantId:'p0',resources:resources(5,1,1)}]})).toThrow();
    expect(s).toEqual(snapshot);
  });
  it('everyone ready closes all offers before auction; ready is not consent',()=>{
    let s=offerPark(openTrade(negotiate()));
    s=auction(s); expect(s.phase).toBe('auction'); expect(s.offers.every(o=>o.status==='expired')).toBe(true);
    expect(s.players.every(p=>reservedAssets(s,p.participant.participantId).coins===0)).toBe(true); expect(s.cells.find(c=>c.id==='A3')?.completed).toBe(false);
  });
  it('creating a private deal resets only its parties; execution resets every active seat',()=>{
    let s=negotiate(); s=action(s,'p1',{type:'ready',ready:true}); s=action(s,'p2',{type:'ready',ready:true});
    s=openTrade(s); expect(s.players.map(p=>p.ready)).toEqual([false,false,true]); s=action(s,'p1',{type:'accept-trade',...ref(s)});
    expect(s.players.every(p=>!p.ready)).toBe(true);
  });
});

describe('auction, income and deadlines',()=>{
  it('reveals all bids together and breaks ties by rotating priority, never arrival order',()=>{
    let s=auction(); s.initialOrder=['p1','p2','p0'];
    s=action(s,'p0',{type:'bid',bid:{lotId:'B2',amount:4}}); s=action(s,'p1',{type:'bid',bid:{lotId:'B2',amount:4}}); s=action(s,'p2',{type:'bid',bid:{lotId:'D2',amount:3}});
    expect(s.players.map(p=>p.resources.coins)).toEqual([12,12,12]);
    const opponent=viewDistrict(s,'p2'); expect(JSON.stringify(opponent)).not.toContain('"lotId":"B2"');
    s=development(s); expect(s.cells.find(c=>c.id==='B2')?.ownerId).toBe('p1'); expect(s.cells.find(c=>c.id==='D2')?.ownerId).toBe('p2');
    expect(s.players.map(p=>p.resources.coins)).toEqual([12,8,9]); expect(roundOrder(s)).toEqual(['p1','p2','p0']);
    expect((s.history.find(h=>h.type==='auction')!.data.bids as unknown[])).toHaveLength(3);
  });
  it('invalid bid replacement does not erase last valid bid; timeout confirms it',()=>{
    let s=auction(); s=action(s,'p0',{type:'bid',bid:{lotId:'A1',amount:3}});
    expect(()=>action(s,'p0',{type:'bid',bid:{lotId:'A1',amount:99}})).toThrow(); expect(s.players[0].bid?.amount).toBe(3);
    s=advanceDistrictTime(s,s.deadlineAt!); expect(s.cells.find(c=>c.id==='A1')?.ownerId).toBe('p0');
  });
  it('skips ineligible auctions, then every seat still gets development',()=>{
    let s=negotiate(); own(s,'A1','p0'); own(s,'D1','p1'); own(s,'D4','p2'); s=auction(s);
    expect(s.phase).toBe('development'); const before=s.players.map(p=>p.resources.coins);
    for(let i=0;i<3;i++) s=action(s,roundOrder(s)[s.developmentIndex],{type:'work'});
    expect(s.round).toBe(2); expect(s.players.map((p,i)=>p.resources.coins-before[i])).toEqual([2,2,2]);
  });
  it('gives a newly opened decision its full time after a long outage and treats exact deadline as late',()=>{
    let s=negotiate(); const original=structuredClone(s);
    const advanced=advanceDistrictTime(s,100_000_000); expect(advanced.phase).toBe('auction'); expect(advanced.deadlineAt).toBe(100_060_000); expect(s).toEqual(original);
    expect(()=>action(s,'p0',{type:'bank',resource:'crews',direction:'buy',quantity:1},s.deadlineAt!)).toThrow('Переговоры');
    s=advanceDistrictTime(advanced,100_000_001); expect(s.revision).toBe(advanced.revision);
  });
  it('times out to first goal and work; repeated time advancement never pays again',()=>{
    let s=fresh(); s=advanceDistrictTime(s,s.deadlineAt!); expect(s.phase).toBe('negotiation'); expect(s.players.every(p=>p.goal===p.goalOptions[0])).toBe(true);
    s=development(auction(s)); const pid=roundOrder(s)[0],coins=s.players.find(p=>p.participant.participantId===pid)!.resources.coins;
    const now=s.deadlineAt!; s=advanceDistrictTime(s,now); expect(s.players.find(p=>p.participant.participantId===pid)!.resources.coins).toBe(coins+2);
    const same=advanceDistrictTime(s,now); expect(same).toEqual(s);
  });
  it('normative cafe formula gives 2/3/1 and zero-coin houses retain crew production and demand',()=>{
    const s=negotiate(); own(s,'A1','p0','house'); own(s,'A2','p0','cafe'); own(s,'B2','p1','workshop'); own(s,'B1','p1','workshop');
    s.cells.find(c=>c.id==='A3')!.completed=true;
    s.event={kind:'ordinary',row:null}; expect(calculateIncome(s).find(l=>l.lotId==='A2')?.coins).toBe(2);
    s.event={kind:'filming',row:null}; expect(calculateIncome(s).find(l=>l.lotId==='A2')?.coins).toBe(3);
    s.event={kind:'traffic',row:null}; expect(calculateIncome(s).find(l=>l.lotId==='A2')?.coins).toBe(1);
    const house=calculateIncome(s).find(l=>l.lotId==='A1')!; expect(house.coins).toBe(0); expect(house.crews).toBe(1);
  });
  it('workshop boom only increases materials and roadworks never remove production',()=>{
    const s=negotiate(); own(s,'A1','p0','workshop',2); own(s,'A2','p1','house');
    s.event={kind:'boom',row:null}; expect(calculateIncome(s).find(l=>l.lotId==='A1')).toMatchObject({coins:3,materials:2,crews:0});
    s.event={kind:'roadworks',row:1}; expect(calculateIncome(s).find(l=>l.lotId==='A1')).toMatchObject({coins:2,materials:1});
  });
  it('income goes to the current owner and simultaneous records have no traversal effects',()=>{
    let s=negotiate(); own(s,'A1','p0','house'); s=openTrade(s,'p0','p1',bundle(0,0,0,['A1']),bundle(1)); s=action(s,'p1',{type:'accept-trade',...ref(s)});
    s=development(auction(s)); const before=s.players.map(p=>structuredClone(p.resources));
    const expected=calculateIncome(s); for(let i=0;i<3;i++) s=action(s,roundOrder(s)[s.developmentIndex],{type:'work'});
    expect(s.players[0].resources.coins-before[0].coins).toBe(2); expect(s.players[1].resources.crews-before[1].crews).toBe(1);
    expect((s.history.find(h=>h.type==='income')!.data.lines)).toEqual(expected);
  });
});

describe('goals, finish and exits',()=>{
  it('checks all six goal predicates on the final board, not permanently at first achievement',()=>{
    const check=(goal:GoalId,setup:(s:DistrictState)=>void)=>{const s=fresh();setup(s);expect(goalSatisfied(s.cells,'p0',goal)).toBe(true);return s;};
    check('variety',s=>{own(s,'A1','p0','house');own(s,'A2','p0','cafe');own(s,'B1','p0','workshop');});
    check('network',s=>{own(s,'A1','p0','cafe');own(s,'D1','p0','cafe');own(s,'A2','p1','house');});
    check('green',s=>{own(s,'A2','p0','house');own(s,'A4','p0','house');s.cells.find(c=>c.id==='A3')!.completed=true;});
    check('industry',s=>{own(s,'A1','p0','workshop');own(s,'E5','p0','workshop');});
    check('sponsor',s=>{for(const id of ['A3','E3']){const c=s.cells.find(c=>c.id===id)!;c.completed=true;c.sponsors=[{participantId:'p0',resources:resources(0,0,1)}];}});
    const s=check('quality',s=>{own(s,'A1','p0','house',2);own(s,'A2','p0','cafe',2);}); s.cells.find(c=>c.id==='A2')!.ownerId='p1'; expect(goalSatisfied(s.cells,'p0','quality')).toBe(false);
    expect(buildingValue('house',2)).toBe(7);expect(buildingValue('cafe',1)).toBe(5);
  });
  it('finishes with shared ranks, no random tiebreak and no rejected objectives revealed',()=>{
    let s=development(auction(negotiate())); s.round=s.totalRounds; s.phaseId=`${s.round}:${s.phase}:${s.developmentIndex}`;
    for(const p of s.players){p.resources=resources(7,2,1);p.goal='quality';}
    for(let i=0;i<3;i++) s=action(s,roundOrder(s)[s.developmentIndex],{type:'work'});
    expect(s.phase).toBe('finished'); expect(s.outcome?.results.map(r=>r.rank)).toEqual([1,1,1]); expect(s.outcome?.winnerParticipantIds).toHaveLength(3);
    expect(s.outcome?.results.every(r=>r.capital===12)).toBe(true);
    expect(JSON.stringify(s.outcome)).not.toContain('goalOptions');
  });
  it('explicit last-human exit abandons before pending auto-work/income/final',()=>{
    let s=createDistrictState({matchId:'m',roomId:'r',participants:[person(0),person(1,true)],map:getDistrictMap('crossroads'),now:1000,seed:'z'});
    for(const p of s.players) s=action(s,p.participant.participantId,{type:'choose-goal',goal:p.goalOptions[0]});
    s=development(auction(s));s.round=6;s.initialOrder=['p1','p0'];s.developmentIndex=1;s.phaseId='6:development:1';
    const before=s.players[0].resources.coins;s=action(s,'p0',{type:'leave'});
    expect(s.outcome).toEqual({reason:'abandoned',winnerParticipantIds:[],results:[]});expect(s.players[0].resources.coins).toBe(before);
    expect(s.history.some(h=>h.type==='income')).toBe(false);expect(()=>action(s,'p0',{type:'return'})).toThrow('закончилась');
  });
  it('leave/return cancels open obligations but does not reopen confirmed bids',()=>{
    let s=openTrade(negotiate());s=action(s,'p1',{type:'leave'});expect(s.offers[0].status).toBe('cancelled');expect(s.outcome).toBeNull();
    expect(()=>openTrade(s)).toThrow();s=action(s,'p1',{type:'return'});s=auction(s);s=action(s,'p1',{type:'bid',bid:{lotId:'A1',amount:2}});
    s=action(s,'p1',{type:'leave'});expect(s.players[1].bidConfirmed).toBe(true);s=action(s,'p1',{type:'return'});expect(s.players[1].bidConfirmed).toBe(true);
  });
  it('mere absence times out normally; no automatic strategic takeover or abandonment',()=>{
    let s=fresh(2);let steps=0;
    while(s.phase!=='finished' && steps++<100){s=advanceDistrictTime(s,s.deadlineAt!);assertDistrictInvariants(s);}
    expect(s.phase).toBe('finished');expect(s.outcome?.reason).toBe('completed');expect(steps).toBeLessThan(100);
    expect(s.players.every(p=>!p.left && p.resources.coins===24)).toBe(true);
  });
});

describe('private observations',()=>{
  it('does not change for another goal, unrevealed deck, other reserves or private offers',()=>{
    let s=negotiate();const before=viewDistrict(s,'p2');
    s=openTrade(s);s.players[0].goal='sponsor';s.players[0].goalOptions=['sponsor','industry'];s.eventDeck.reverse();
    const after=viewDistrict(s,'p2');after.revision=before.revision;
    expect(after).toEqual(before);expect(JSON.stringify(after)).not.toContain('test-seed');expect(after.you.offers).toEqual([]);
  });
  it('returns independent copies with no authority or private account ids',()=>{
    const s=negotiate(),v=viewDistrict(s,'p0');v.cells[0].ownerId='fake';v.you.resources.coins=999;v.map.rows[0]='.....';
    expect(s.players[0].resources.coins).toBe(12);expect(s.cells[0].ownerId).toBeNull();expect(s.map.rows[0]).toBe('..P..');
    expect(JSON.stringify(viewDistrict(s,'p1'))).not.toContain('"playerId"');expect(()=>viewDistrict(s,'intruder')).toThrow();
  });
});
