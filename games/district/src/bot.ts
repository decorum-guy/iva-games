import type { BotDifficulty } from '@iva-games/session-kit';
import { adjacentCells, BUILD_COSTS, buildingValue, emptyBundle, goalSatisfied, incomeForCell, parkIntentSignature, PARK_COST, RESOURCE_KEYS, tradeIntentSignature, UPGRADE_COST } from './core';
import { randomStream } from './random';
import type { BuildingKind, Bundle, DistrictAction, DistrictCell, DistrictView, GoalId, ParkOffer, Resources, TradeOffer } from './types';

const remaining = (view:DistrictView):number => Math.max(1,view.totalRounds-view.round+1);
const me = (view:DistrictView):string => view.you.participantId;
const own = (view:DistrictView):DistrictCell[] => view.cells.filter(c=>c.ownerId===me(view));
const affordable = (stock:Resources,cost:Resources):boolean => RESOURCE_KEYS.every(k=>stock[k]>=cost[k]);
const resourceCost = (r:Resources):number => r.coins+1.65*r.materials+1.55*r.crews;
function unitValue(view:DistrictView,kind:'materials'|'crews'):number {
  const stock=view.you.available[kind],R=remaining(view);
  return R===1?1:stock<1?2.8:stock<2?2.2:stock<=R?1.45:1;
}
function bundleValue(view:DistrictView,b:Bundle,ownerId:string):number {
  let value=b.coins+b.materials*unitValue(view,'materials')+b.crews*unitValue(view,'crews');
  for(const lot of b.lots) {
    const cell=view.cells.find(c=>c.id===lot);
    if(!cell) return Number.POSITIVE_INFINITY;
    if(cell.building) {
      const income=incomeForCell(view.cells,cell,null)!;
      value+=buildingValue(cell.building.kind,cell.building.level)+remaining(view)*(income.coins+income.materials*1.3+income.crews*1.25);
      if(ownerId===me(view) && goalSatisfied(view.cells,me(view),view.you.goal)) value+=2;
    } else value+=Math.max(1,remaining(view)*1.6);
  }
  return value;
}
function canPay(view:DistrictView,b:Bundle):boolean {
  return affordable(view.you.available,b) && b.lots.every(id=>view.cells.some(c=>c.id===id && c.ownerId===me(view)) && !view.you.reservedLots.includes(id));
}
function landCapAfter(view:DistrictView,give:Bundle,receive:Bundle):boolean {
  const current=own(view).filter(c=>!c.building).map(c=>c.id);
  return current.filter(id=>!give.lots.includes(id)).length+receive.lots.filter(id=>!view.cells.find(c=>c.id===id)?.building).length<=1;
}
function goalProgress(view:DistrictView,cells:DistrictCell[]):number {
  const mine=cells.filter(c=>c.ownerId===me(view) && c.building);
  if(goalSatisfied(cells,me(view),view.you.goal)) return 5;
  switch(view.you.goal) {
    case 'variety': return new Set(mine.map(c=>c.building!.kind)).size*1.1;
    case 'network': return Math.min(2,mine.filter(c=>c.building!.kind==='cafe').length)*1.1;
    case 'green': return Math.min(2,mine.filter(c=>c.building!.kind==='house' && adjacentCells(cells,c).some(n=>n.kind==='park')).length);
    case 'industry': return Math.min(2,mine.filter(c=>c.building!.kind==='workshop' && !adjacentCells(cells,c).some(n=>n.kind==='neutral-house'||n.building?.kind==='house')).length)*1.6;
    case 'quality': return new Set(mine.filter(c=>c.building!.level===2).map(c=>c.building!.kind)).size*1.5;
    default: return 0;
  }
}
function buildingScore(view:DistrictView,cell:DistrictCell,kind:BuildingKind,level:1|2,difficulty:BotDifficulty):number {
  const cells=structuredClone(view.cells),changed=cells.find(c=>c.id===cell.id)!;
  const before=cell.building?incomeForCell(view.cells,cell,null):null;
  changed.ownerId=me(view); changed.building={kind,level};
  const after=incomeForCell(cells,changed,null)!;
  const R=remaining(view),cost=level===2?UPGRADE_COST:BUILD_COSTS[kind];
  const rates={coins:1,materials:unitValue(view,'materials'),crews:unitValue(view,'crews')};
  let value=RESOURCE_KEYS.reduce((n,key)=>n+(after[key]-(before?.[key]??0))*rates[key]*R,0)
    +(level===2?3:buildingValue(kind,level))-RESOURCE_KEYS.reduce((n,key)=>n+cost[key]*rates[key],0);
  if(difficulty!=='easy') value+=goalProgress(view,cells)-goalProgress(view,view.cells);
  if(difficulty==='hard') {
    // Count our adjacent buildings' changed income too, without reading another player's hidden objective.
    for(const neighbor of adjacentCells(view.cells,cell).filter(c=>c.ownerId===me(view) && c.building)) {
      const newNeighbor=cells.find(c=>c.id===neighbor.id)!;
      value+=((incomeForCell(cells,newNeighbor,null)?.coins??0)-(incomeForCell(view.cells,neighbor,null)?.coins??0))*R;
    }
  }
  return value;
}
function chooseGoal(view:DistrictView,difficulty:BotDifficulty,random:(n:number)=>number):GoalId {
  const score=(goal:GoalId):number=> {
    const lots=view.cells.filter(c=>c.kind==='lot');
    switch(goal) {
      case 'variety': return 4;
      case 'quality': return 4.3;
      case 'green': return lots.filter(c=>adjacentCells(view.cells,c).some(n=>n.kind==='park')).length/3;
      case 'industry': return lots.filter(c=>!adjacentCells(view.cells,c).some(n=>n.kind==='neutral-house')).length/2.5;
      case 'network': return 3.5;
      case 'sponsor': return 3.2;
    }
  };
  return difficulty==='easy'?view.you.goalOptions[random(view.you.goalOptions.length)]:[...view.you.goalOptions].sort((a,b)=>score(b)-score(a) || a.localeCompare(b))[0];
}
function assessIncomingTrade(view:DistrictView,offer:TradeOffer,difficulty:BotDifficulty):DistrictAction {
  const ref={offerId:offer.id,version:offer.version};
  const outgoing=offer.receive,incoming=offer.give;
  if(!canPay(view,outgoing) || !landCapAfter(view,outgoing,incoming)) return {type:'decline-offer',...ref};
  const gain=bundleValue(view,incoming,offer.authorId),cost=bundleValue(view,outgoing,me(view));
  // All levels value complete packages, including income-producing property; no free-property exploitable exception.
  const margin=difficulty==='easy'?0:0.15;
  if(gain>=cost+margin) return {type:'accept-trade',...ref};
  if(difficulty!=='easy' && view.you.botMemory.created<4 && !view.you.botMemory.counteredOfferIds.includes(offer.id)
    && view.you.offers.filter(o=>o.status==='open' && o.authorId===me(view)).length<3) {
    const give=structuredClone(outgoing),receive=structuredClone(incoming);
    const difference=Math.max(1,Math.ceil(cost+0.3-gain));
    if(give.coins>0) give.coins=Math.max(0,give.coins-difference);
    else receive.coins+=difference;
    if(RESOURCE_KEYS.reduce((n,k)=>n+give[k],give.lots.length)>0 && RESOURCE_KEYS.reduce((n,k)=>n+receive[k],receive.lots.length)>0
      && !RESOURCE_KEYS.some(k=>give[k]>0 && receive[k]>0) && canPay(view,give)) return {type:'counter-trade',...ref,give,receive};
  }
  return {type:'decline-offer',...ref};
}
function parkBenefit(view:DistrictView,parkId:string,participantId:string):number {
  const park=view.cells.find(c=>c.id===parkId)!;
  const neighbors=adjacentCells(view.cells,park).filter(c=>c.ownerId===participantId && (c.building?.kind==='house'||c.building?.kind==='cafe'));
  let value=neighbors.length*remaining(view);
  if(participantId===me(view)) {
    if(view.you.goal==='sponsor') {
      const count=view.cells.filter(c=>c.completed && c.sponsors.some(s=>s.participantId===participantId)).length;
      if(count<2) value+=2.5;
    }
    if(view.you.goal==='green' && neighbors.some(c=>c.building?.kind==='house')) value+=1.5;
  }
  return value;
}
function assessPark(view:DistrictView,offer:ParkOffer):DistrictAction {
  const ref={offerId:offer.id,version:offer.version},cost=offer.contributions.find(c=>c.participantId===me(view))!.resources;
  return affordable(view.you.available,cost) && parkBenefit(view,offer.parkId,me(view))>=resourceCost(cost)
    ?{type:'sign-park',...ref}:{type:'decline-offer',...ref};
}
function proposePark(view:DistrictView):DistrictAction|null {
  const stock=view.you.available;
  const rejected=(parkId:string,contributions:ParkOffer['contributions']):boolean=>view.you.botMemory.rejectedSignatures.includes(parkIntentSignature(parkId,contributions,view.history.length,stock));
  for(const park of view.cells.filter(c=>c.kind==='park' && !c.completed).sort((a,b)=>parkBenefit(view,b.id,me(view))-parkBenefit(view,a.id,me(view)))) {
    if(view.you.offers.some(o=>o.status==='open' && o.kind==='park' && o.parkId===park.id)) continue;
    const benefit=parkBenefit(view,park.id,me(view));
    if(benefit<2) continue;
    for(const other of view.players.filter(p=>p.participantId!==me(view) && !p.left)) {
      if(parkBenefit(view,park.id,other.participantId)<3) continue;
      for(const ownMaterial of [1,0]) {
        const mine={coins:2,materials:ownMaterial,crews:1-ownMaterial},theirs={coins:2,materials:1-ownMaterial,crews:ownMaterial};
        const contributions=[{participantId:me(view),resources:mine},{participantId:other.participantId,resources:theirs}];
        if(affordable(stock,mine) && affordable(other.resources,theirs) && benefit>=resourceCost(mine)
          && parkBenefit(view,park.id,other.participantId)>=resourceCost(theirs) && !rejected(park.id,contributions)) return {type:'offer-park',parkId:park.id,contributions};
      }
    }
    const contributions=[{participantId:me(view),resources:{...PARK_COST}}];
    if(affordable(stock,PARK_COST) && benefit>=resourceCost(PARK_COST)+1 && !rejected(park.id,contributions)) return {type:'offer-park',parkId:park.id,contributions};
  }
  return null;
}
function desiredConstruction(view:DistrictView,difficulty:BotDifficulty):Resources|null {
  const vacant=own(view).find(c=>!c.building);
  if(vacant) {
    const choices=(['house','cafe','workshop'] as const).map(kind=>({kind,score:buildingScore(view,vacant,kind,1,difficulty)})).sort((a,b)=>b.score-a.score);
    return BUILD_COSTS[choices[0].kind];
  }
  if(own(view).some(c=>c.building?.level===1) && remaining(view)<=2) return UPGRADE_COST;
  if(view.cells.some(c=>c.kind==='lot' && !c.ownerId) && remaining(view)>1) return BUILD_COSTS.house;
  return null;
}
function proposeTrade(view:DistrictView,needed:Resources|null):DistrictAction|null {
  if(!needed) return null;
  for(const resource of ['materials','crews'] as const) {
    if(view.you.available[resource]>=needed[resource] || view.you.available.coins<2) continue;
    for(const other of view.players.filter(p=>p.participantId!==me(view) && !p.left && p.resources[resource]>0)) {
      const give={...emptyBundle(),coins:2},receive={...emptyBundle(),[resource]:1};
      if(view.you.offers.some(o=>o.kind==='trade' && o.authorId===me(view) && o.targetId===other.participantId && o.status==='open')) continue;
      if(view.you.botMemory.rejectedSignatures.includes(tradeIntentSignature(other.participantId,give,receive,view.history.length,view.you.available))) continue;
      return {type:'offer-trade',targetId:other.participantId,give,receive};
    }
  }
  // Exchange surplus production for a missing resource, preserving enough for the current plan.
  for(const resource of ['materials','crews'] as const) {
    const otherResource=resource==='materials'?'crews':'materials';
    if(view.you.available[resource]>=needed[resource] || view.you.available[otherResource]<=needed[otherResource]) continue;
    for(const other of view.players.filter(p=>p.participantId!==me(view) && !p.left && p.resources[resource]>0 && p.resources[otherResource]<2)) {
      const give={...emptyBundle(),[otherResource]:1},receive={...emptyBundle(),[resource]:1};
      if(view.you.offers.some(o=>o.kind==='trade' && o.authorId===me(view) && o.targetId===other.participantId && o.status==='open')) continue;
      if(!view.you.botMemory.rejectedSignatures.includes(tradeIntentSignature(other.participantId,give,receive,view.history.length,view.you.available))) return {type:'offer-trade',targetId:other.participantId,give,receive};
    }
  }
  return null;
}

/** Bounded ordinary heuristic, no shared bot secrets, network calls or full-state reference. */
export function chooseDistrictBotAction(view:DistrictView,difficulty:BotDifficulty,decisionSeed:string):DistrictAction|null {
  if(view.phase==='finished' || view.you.left) return null;
  const random=randomStream(decisionSeed,`district-bot:${difficulty}`);
  if(view.legal.chooseGoal) return {type:'choose-goal',goal:chooseGoal(view,difficulty,random)};
  if(view.legal.negotiate) {
    const open=view.you.offers.filter(o=>o.status==='open');
    const incoming=open.find(o=>o.authorId!==me(view) && (o.kind==='trade' || !o.signedBy.includes(me(view))));
    if(incoming) return incoming.kind==='trade'?assessIncomingTrade(view,incoming,difficulty):assessPark(view,incoming);
    const budget=view.you.botMemory,needed=desiredConstruction(view,difficulty);
    const mayInitiate=budget.created<4 && open.filter(o=>o.authorId===me(view)).length<3 && (budget.lastInitiativeAt===null || view.serverNow-budget.lastInitiativeAt>=10_000);
    if(mayInitiate) {
      const park=proposePark(view); if(park) return park;
      const trade=proposeTrade(view,needed); if(trade) return trade;
    }
    if(budget.bankActions<4 && needed) {
      // Keep a pending useful trade open instead of buying the same goods twice.
      for(const resource of ['materials','crews'] as const) if(view.you.available[resource]<needed[resource]
        && !open.some(o=>o.kind==='trade' && o.authorId===me(view) && o.receive[resource]>0)
        && view.you.available.coins>=needed.coins+3) return {type:'bank',resource,direction:'buy',quantity:1};
      for(const resource of ['materials','crews'] as const) if(view.you.available[resource]>Math.max(needed[resource]+2,remaining(view)+1)
        && view.you.available.coins<needed.coins+2) return {type:'bank',resource,direction:'sell',quantity:Math.min(3,view.you.available[resource]-needed[resource])};
    }
    return view.players.find(p=>p.participantId===me(view))!.ready?null:{type:'ready',ready:true};
  }
  if(view.legal.bid) {
    if(view.you.bid!==null) return {type:'confirm-bid'};
    const stock=view.you.available;
    if(own(view).some(c=>!c.building) || stock.coins<3 || !view.cells.some(c=>c.kind==='lot' && !c.ownerId)) return {type:'confirm-bid'};
    const candidates=view.cells.filter(c=>c.kind==='lot' && c.ownerId===null).map(cell=> {
      const affordableKinds=(['house','cafe','workshop'] as const).filter(kind=>stock.materials>=BUILD_COSTS[kind].materials && stock.crews>=BUILD_COSTS[kind].crews && stock.coins>BUILD_COSTS[kind].coins);
      return {cell,score:Math.max(-100,...affordableKinds.map(kind=>buildingScore(view,cell,kind,1,difficulty))),reserve:Math.min(100,...affordableKinds.map(kind=>BUILD_COSTS[kind].coins))};
    }).filter(c=>c.score>2).sort((a,b)=>b.score-a.score || a.cell.id.localeCompare(b.cell.id));
    if(!candidates.length) return {type:'confirm-bid'};
    const selected=candidates[difficulty==='easy'?random(Math.min(4,candidates.length)):difficulty==='normal'?random(Math.min(2,candidates.length)):0];
    let amount=Math.min(stock.coins-selected.reserve,Math.max(1,Math.floor(selected.score*(difficulty==='hard'?0.25:0.18))));
    // Public previous auction prices inform hard bids, never another pending bid.
    if(difficulty==='hard') {
      const last=view.history.filter(h=>h.type==='auction').at(-1);
      const paid=last?.data.winners as Array<{amount:number}>|undefined;
      if(paid?.length) amount=Math.min(stock.coins-selected.reserve,Math.max(amount,Math.ceil(paid.reduce((n,w)=>n+w.amount,0)/paid.length)));
    }
    return amount>=1?{type:'bid',bid:{lotId:selected.cell.id,amount}}:{type:'confirm-bid'};
  }
  if(view.legal.develop) {
    const choices:Array<{action:DistrictAction;score:number}>=[{action:{type:'work'},score:2}];
    for(const cell of own(view)) {
      if(!cell.building) for(const kind of ['house','cafe','workshop'] as const) {
        if(affordable(view.you.available,BUILD_COSTS[kind])) choices.push({action:{type:'build',lotId:cell.id,building:kind},score:buildingScore(view,cell,kind,1,difficulty)});
      } else if(cell.building.level===1 && affordable(view.you.available,UPGRADE_COST)) choices.push({action:{type:'upgrade',lotId:cell.id},score:buildingScore(view,cell,cell.building.kind,2,difficulty)});
    }
    choices.sort((a,b)=>b.score-a.score);
    const competitive=choices.filter(c=>c.score>=choices[0].score-(difficulty==='easy'?3:0));
    return competitive[difficulty==='easy'?random(Math.min(3,competitive.length)):0].action;
  }
  return null;
}

/** The runtime may use this after a policy fault, through the same normal command validator. */
export function safeDistrictBotAction(view:DistrictView):DistrictAction|null {
  if(view.legal.chooseGoal) return {type:'choose-goal',goal:view.you.goalOptions[0]};
  if(view.legal.bid) return {type:'confirm-bid'};
  if(view.legal.develop) return {type:'work'};
  if(view.legal.negotiate) {
    const incoming=view.you.offers.find(o=>o.status==='open' && o.authorId!==me(view) && (o.kind==='trade'||!o.signedBy.includes(me(view))));
    if(incoming) return {type:'decline-offer',offerId:incoming.id,version:incoming.version};
    if(!view.players.find(p=>p.participantId===me(view))!.ready) return {type:'ready',ready:true};
  }
  return null;
}
