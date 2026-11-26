import type { Participant } from '@iva-games/session-kit';
import { DISTRICT_CONTENT_VERSION, parseDistrictMap } from './map-schema';
import type { DistrictMap } from './maps';
import { randomStream, sha256Words, shuffled } from './random';
import { DistrictError, DISTRICT_RULES_VERSION, DISTRICT_TIMERS, GOALS } from './types';
import type { BotNegotiationMemory, BuildingKind, Bundle, CityEvent, DistrictAction, DistrictCell, DistrictHistoryEntry, DistrictOffer, DistrictPlayer, DistrictResult, DistrictState, EventId, GoalId, IncomeLine, ParkOffer, Resources, TradeOffer } from './types';

export const RESOURCE_KEYS = ['coins', 'materials', 'crews'] as const;
export const BUILD_COSTS: Record<BuildingKind, Resources> = {
  house: { coins: 2, materials: 1, crews: 1 }, cafe: { coins: 3, materials: 1, crews: 1 }, workshop: { coins: 3, materials: 2, crews: 1 },
};
export const UPGRADE_COST: Resources = { coins: 3, materials: 1, crews: 1 };
export const PARK_COST: Resources = { coins: 4, materials: 1, crews: 1 };
export const EVENT_DECK: EventId[] = ['ordinary','ordinary','ordinary','ordinary','filming','filming','fair','fair','boom','boom','traffic','roadworks'];
export const zeroResources = (): Resources => ({ coins: 0, materials: 0, crews: 0 });
export const emptyBundle = (): Bundle => ({ ...zeroResources(), lots: [] });
function canonical(value: unknown): string {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function tradeIntentSignature(targetId:string,give:Bundle,receive:Bundle,historyLength:number,available:Resources):string {
  return canonical(['trade',targetId,{...give,lots:[...give.lots].sort()},{...receive,lots:[...receive.lots].sort()},historyLength,available]);
}
export function parkIntentSignature(parkId:string,contributions:ParkOffer['contributions'],historyLength:number,available:Resources):string {
  return canonical(['park',parkId,[...contributions].sort((a,b)=>a.participantId.localeCompare(b.participantId)),historyLength,available]);
}
const fail = (code: string, message: string, status = 400): never => { throw new DistrictError(code, message, status); };
const clone = <T>(v: T): T => structuredClone(v);
const sum = (r: Resources): number => r.coins + r.materials + r.crews;
const includes = (values: readonly string[], value: unknown): value is string => typeof value === 'string' && values.includes(value);
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_ACTION', 'Выберите действие ещё раз.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) fail('INVALID_ACTION', 'Выберите действие ещё раз.');
  return value as string;
}
function resources(value: unknown): Resources {
  const v = object(value, [...RESOURCE_KEYS]);
  if (RESOURCE_KEYS.some(k => !integer(v[k]))) fail('INVALID_ACTION', 'Укажите целое количество ресурсов.');
  return { coins: v.coins as number, materials: v.materials as number, crews: v.crews as number };
}
function bundle(value: unknown): Bundle {
  const v = object(value, [...RESOURCE_KEYS, 'lots']);
  const r = resources({ coins: v.coins, materials: v.materials, crews: v.crews });
  if (!Array.isArray(v.lots) || v.lots.length > 16) fail('INVALID_ACTION', 'Проверьте участки.');
  const lots = (v.lots as unknown[]).map(id);
  if (new Set(lots).size !== lots.length) fail('INVALID_ACTION', 'Участок указан дважды.');
  return { ...r, lots };
}
/** Strict parser, shared by human and bot commands; unsupported fields never reach rules. */
export function parseDistrictAction(value: unknown): DistrictAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ACTION', 'Выберите действие ещё раз.');
  const v = value as Record<string, unknown>;
  const basic = (keys: string[]) => object(value, ['type', ...keys]);
  const offerRef = () => { if (!integer(v.version, 1)) fail('INVALID_ACTION', 'Предложение изменилось.'); return { offerId: id(v.offerId), version: v.version as number }; };
  switch (v.type) {
    case 'choose-goal': basic(['goal']); if (!includes(GOALS, v.goal)) fail('INVALID_ACTION','Выберите цель.'); return { type: v.type, goal: v.goal as GoalId };
    case 'ready': basic(['ready']); if (typeof v.ready !== 'boolean') fail('INVALID_ACTION','Подтвердите готовность.'); return { type: v.type, ready: v.ready as boolean };
    case 'bank': basic(['resource','direction','quantity']); if (!includes(['materials','crews'],v.resource) || !includes(['buy','sell'],v.direction) || !integer(v.quantity,1)) fail('INVALID_ACTION','Проверьте обмен.'); return { type:v.type, resource:v.resource as 'materials'|'crews', direction:v.direction as 'buy'|'sell', quantity:v.quantity as number };
    case 'offer-trade': basic(['targetId','give','receive']); return { type:v.type, targetId:id(v.targetId), give:bundle(v.give), receive:bundle(v.receive) };
    case 'replace-trade': basic(['offerId','version','targetId','give','receive']); return { type:v.type,...offerRef(),targetId:id(v.targetId),give:bundle(v.give),receive:bundle(v.receive) };
    case 'counter-trade': basic(['offerId','version','give','receive']); return { type:v.type,...offerRef(),give:bundle(v.give),receive:bundle(v.receive) };
    case 'accept-trade': case 'decline-offer': case 'cancel-offer': case 'sign-park': basic(['offerId','version']); return { type:v.type,...offerRef() };
    case 'offer-park': case 'replace-park': {
      basic(v.type === 'offer-park' ? ['parkId','contributions'] : ['parkId','contributions','offerId','version']);
      if (!Array.isArray(v.contributions) || v.contributions.length < 1 || v.contributions.length > 4) fail('INVALID_ACTION','Выберите участников парка.');
      const contributions = (v.contributions as unknown[]).map(item => { const c = object(item,['participantId','resources']); return { participantId:id(c.participantId), resources:resources(c.resources) }; });
      return v.type === 'offer-park' ? { type:v.type,parkId:id(v.parkId),contributions } : { type:v.type,...offerRef(),parkId:id(v.parkId),contributions };
    }
    case 'bid': {
      basic(['bid']); if (v.bid === null) return { type:v.type,bid:null };
      const b = object(v.bid,['lotId','amount']); if (!integer(b.amount,1)) fail('INVALID_ACTION','Укажите ставку.'); return { type:v.type,bid:{ lotId:id(b.lotId), amount:b.amount as number } };
    }
    case 'build': basic(['lotId','building']); if (!includes(['house','cafe','workshop'],v.building)) fail('INVALID_ACTION','Выберите здание.'); return { type:v.type,lotId:id(v.lotId),building:v.building as BuildingKind };
    case 'upgrade': basic(['lotId']); return { type:v.type,lotId:id(v.lotId) };
    case 'confirm-bid': case 'work': case 'leave': case 'return': basic([]); return { type:v.type };
    default: return fail('INVALID_ACTION','Выберите действие ещё раз.');
  }
}
export function playerById(state: DistrictState, participantId: string): DistrictPlayer {
  return state.players.find(p => p.participant.participantId === participantId) ?? fail('FORBIDDEN','Вы не участник этой партии.',403);
}
const cellById = (state: DistrictState, cellId: string): DistrictCell => state.cells.find(c => c.id === cellId) ?? fail('INVALID_LOT','Выберите участок.');
export function adjacentCells(cells: readonly DistrictCell[], cell: DistrictCell): DistrictCell[] {
  return cells.filter(c => Math.abs(c.x-cell.x)+Math.abs(c.y-cell.y) === 1);
}
export function roundOrder(state: DistrictState): string[] {
  const shift = Math.max(0,state.round-1) % state.initialOrder.length;
  return [...state.initialOrder.slice(shift),...state.initialOrder.slice(0,shift)];
}
const memory = (round: number): BotNegotiationMemory => ({ round,created:0,lastInitiativeAt:null,counteredOfferIds:[],rejectedSignatures:[],bankActions:0 });
function refreshPhase(state: DistrictState): void { state.phaseId = `${state.round}:${state.phase}:${state.developmentIndex}`; }
function record(state: DistrictState, type: DistrictHistoryEntry['type'], data: Record<string,unknown>, actorId?: string): void {
  state.history.push({ id:state.history.length+1,round:state.round,type,...(actorId ? {actorId} : {}),data:clone(data) });
}
function addResource(target: Resources, key: keyof Resources, delta: number): void {
  const next = target[key]+delta;
  if (!integer(next)) fail('INVALID_RESOURCES','Проверьте количество ресурсов.');
  target[key] = next;
}
function addResources(target: Resources, delta: Resources, sign = 1): void { for (const key of RESOURCE_KEYS) addResource(target,key,delta[key]*sign); }
function atLeast(stock: Resources, cost: Resources): boolean { return RESOURCE_KEYS.every(key => stock[key]>=cost[key]); }
function members(offer: DistrictOffer): string[] { return offer.kind === 'trade' ? [offer.authorId,offer.targetId] : offer.contributions.map(c=>c.participantId); }
export function reservedAssets(state: DistrictState, participantId: string): Bundle {
  const total = emptyBundle();
  for (const offer of state.offers) {
    if (offer.status !== 'open') continue;
    if (offer.kind === 'trade' && offer.authorId === participantId) { addResources(total,offer.give); total.lots.push(...offer.give.lots); }
    if (offer.kind === 'park' && offer.signedBy.includes(participantId)) addResources(total,offer.contributions.find(c=>c.participantId===participantId)!.resources);
  }
  return total;
}
export function availableResources(state: DistrictState, participantId: string): Resources {
  const total = clone(playerById(state,participantId).resources); addResources(total,reservedAssets(state,participantId),-1); return total;
}
function requireResources(state: DistrictState, participantId: string, cost: Resources): void {
  if (!atLeast(availableResources(state,participantId),cost)) fail('INSUFFICIENT_RESOURCES','Не хватает свободных ресурсов.');
}
function requireBundle(state: DistrictState, participantId: string, wanted: Bundle): void {
  requireResources(state,participantId,wanted);
  const reserved = reservedAssets(state,participantId);
  if (wanted.lots.some(lotId=>{ const c=cellById(state,lotId); return c.kind!=='lot' || c.ownerId!==participantId || reserved.lots.includes(lotId); })) fail('ASSET_UNAVAILABLE','Это имущество сейчас недоступно.');
}
function resetReady(state: DistrictState, ids?: string[]): void {
  for (const p of state.players) if (!p.left && (!ids || ids.includes(p.participant.participantId))) p.ready=false;
}
function closeAllOffers(state: DistrictState, status: DistrictOffer['status'] = 'expired'): void {
  for (const offer of state.offers) if (offer.status==='open') offer.status=status;
}
function nextOfferId(state: DistrictState): string {
  return 'offer-'+sha256Words(JSON.stringify([state.seed,'offer',state.nextOfferId++])).slice(0,4).map(n=>n.toString(16).padStart(8,'0')).join('');
}
function newOfferAllowed(state: DistrictState, authorId: string, now: number, counter = false): void {
  if (state.offers.filter(o=>o.status==='open' && o.authorId===authorId).length>=3) fail('OFFER_LIMIT','Сначала закройте одно предложение.');
  const p=playerById(state,authorId);
  if (p.participant.controller.kind === 'bot') {
    if (p.botMemory.created>=4) fail('BOT_CARD_LIMIT','Бот закончил предложения.');
    if (!counter && p.botMemory.lastInitiativeAt!==null && now-p.botMemory.lastInitiativeAt<10_000) fail('BOT_COOLDOWN','Нужно немного подождать.');
    p.botMemory.created++;
    if (!counter) p.botMemory.lastInitiativeAt=now;
  }
}
export function createDistrictState(input: { matchId: string; roomId: string; participants: Participant[]; map: DistrictMap; now: number; seed: string }): DistrictState {
  const { participants,now,seed }=input;
  const map=(()=>{try{return parseDistrictMap(input.map);}catch{return fail('INVALID_MAP','Выберите другую карту.');}})();
  if (!Number.isFinite(now) || !seed || !input.matchId || !input.roomId || participants.length<2 || participants.length>4 || !map.supportedPlayers.includes(participants.length)) fail('INVALID_ROSTER','Нужно от двух до четырёх участников.');
  const ids=new Set<string>(), seats=new Set<number>(), humans=new Set<string>();
  for (const p of participants) {
    if (!p.participantId || ids.has(p.participantId) || !integer(p.seatIndex) || p.seatIndex>3 || seats.has(p.seatIndex) || !p.displayName?.trim()) fail('INVALID_ROSTER','Проверьте участников.');
    ids.add(p.participantId); seats.add(p.seatIndex);
    if (p.controller.kind==='human') {
      if (!p.playerId || p.playerId!==p.controller.playerId || humans.has(p.playerId)) fail('INVALID_ROSTER','Учётная запись занимает одно место.');
      humans.add(p.controller.playerId);
    } else if (p.controller.kind==='bot') {
      if (p.playerId!==null || !['easy','normal','hard'].includes(p.controller.difficulty) || p.controller.botVersion!=='1' || p.controller.botProfileId!==`district:${p.controller.difficulty}`) fail('INCOMPATIBLE_VERSION','Добавьте бота заново.',409);
    } else fail('INVALID_ROSTER','Проверьте участников.');
  }
  if (!humans.size) fail('INVALID_ROSTER','В комнате нужен хотя бы один человек.');
  const cells: DistrictCell[]=map.rows.flatMap((row,y)=>[...row].map((symbol,x)=>({ id:String.fromCharCode(65+x)+(y+1),x,y,kind:({'.':'lot',H:'neutral-house',P:'park',S:'square'} as const)[symbol as '.'|'H'|'P'|'S'],ownerId:null,building:null,completed:false,sponsors:[] })));
  const sorted=[...participants].sort((a,b)=>a.seatIndex-b.seatIndex);
  const state: DistrictState={ schemaVersion:1,gameId:'district',rulesVersion:DISTRICT_RULES_VERSION,contentVersion:DISTRICT_CONTENT_VERSION,
    matchId:input.matchId,roomId:input.roomId,revision:0,round:0,totalRounds:participants.length===4?8:6,
    phase:'goals',phaseId:'0:goals:0',deadlineAt:now+DISTRICT_TIMERS.goals,updatedAt:now,developmentIndex:0,
    map:clone(map),cells,participants:clone(sorted),players:sorted.map(p=>({participant:clone(p),resources:{coins:12,materials:2,crews:2},left:false,ready:false,
      goalOptions:shuffled(GOALS,randomStream(seed,`goals:${p.participantId}`)).slice(0,2) as [GoalId,GoalId],goal:null,bid:null,bidConfirmed:false,lastIncome:0,botMemory:memory(0)})),
    initialOrder:shuffled(sorted.map(p=>p.participantId),randomStream(seed,'priority')),seed,eventDeck:shuffled(EVENT_DECK,randomStream(seed,'events')),
    event:null,offers:[],nextOfferId:1,history:[],outcome:null };
  assertDistrictInvariants(state); return state;
}

export function incomeForCell(cells: readonly DistrictCell[], cell: DistrictCell, event: CityEvent | null): IncomeLine | null {
  if (cell.kind!=='lot' || !cell.ownerId || !cell.building) return null;
  const neighbors=adjacentCells(cells,cell);
  const houses=neighbors.filter(c=>c.kind==='neutral-house' || c.building?.kind==='house').length;
  const parks=neighbors.filter(c=>c.kind==='park' && c.completed).length;
  const workshops=neighbors.filter(c=>c.building?.kind==='workshop').length;
  const {kind,level}=cell.building;
  const eventCoins=(event?.kind==='filming' && kind==='cafe'?1:0)+(event?.kind==='fair' && kind==='house' && parks>0?1:0)
    -(event?.kind==='traffic' && kind==='cafe'?1:0)-(event?.kind==='roadworks' && event.row===cell.y+1?1:0);
  const base=kind==='workshop'?2:1;
  const coins=Math.max(0,base+level-1+(kind==='cafe'?houses:0)+(kind==='workshop'?0:parks)-workshops+eventCoins);
  return {lotId:cell.id,ownerId:cell.ownerId,building:clone(cell.building),coins,
    materials:kind==='workshop'?(event?.kind==='boom'?2:1):0,crews:kind==='house'?1:0,
    neighbors:{houses,parks,workshops},eventCoins};
}
export function calculateIncome(state: Pick<DistrictState,'cells'|'event'>): IncomeLine[] {
  return state.cells.map(c=>incomeForCell(state.cells,c,state.event)).filter((v):v is IncomeLine=>v!==null);
}
export function goalSatisfied(cells: readonly DistrictCell[], participantId: string, goal: GoalId | null): boolean {
  const owned=cells.filter(c=>c.ownerId===participantId && c.building);
  switch(goal) {
    case 'variety': return ['house','cafe','workshop'].every(kind=>owned.some(c=>c.building!.kind===kind));
    case 'network': return owned.filter(c=>c.building!.kind==='cafe').length>=2 && owned.some(c=>c.building!.kind==='cafe' && adjacentCells(cells,c).some(n=>n.building?.kind==='house' && n.ownerId!==participantId));
    case 'green': return owned.filter(c=>c.building!.kind==='house' && adjacentCells(cells,c).some(n=>n.kind==='park' && n.completed)).length>=2;
    case 'industry': return owned.filter(c=>c.building!.kind==='workshop' && !adjacentCells(cells,c).some(n=>n.kind==='neutral-house' || n.building?.kind==='house')).length>=2;
    case 'sponsor': return cells.filter(c=>c.kind==='park' && c.completed && c.sponsors.some(s=>s.participantId===participantId && sum(s.resources)>0)).length>=2;
    case 'quality': return new Set(owned.filter(c=>c.building!.level===2).map(c=>c.building!.kind)).size>=2;
    default: return false;
  }
}
export function buildingValue(kind: BuildingKind, level: 1|2): number { return ({house:4,cafe:5,workshop:6}[kind])+(level===2?3:0); }
function finalResults(state: DistrictState): DistrictResult[] {
  const results=state.players.map(p=>{
    const participantId=p.participant.participantId;
    const buildings=state.cells.filter(c=>c.ownerId===participantId && c.building).reduce((n,c)=>n+buildingValue(c.building!.kind,c.building!.level),0);
    const goal=p.goal ?? p.goalOptions[0]; const goalCompleted=goalSatisfied(state.cells,participantId,goal),goalBonus=goalCompleted?5:0;
    return {participantId,rank:0,capital:sum(p.resources)+buildings+goalBonus,...p.resources,buildings,goal,goalCompleted,goalBonus,lastIncome:p.lastIncome};
  });
  results.sort((a,b)=>b.capital-a.capital || b.lastIncome-a.lastIncome || state.initialOrder.indexOf(a.participantId)-state.initialOrder.indexOf(b.participantId));
  for(let i=0;i<results.length;i++) results[i].rank=i>0 && results[i].capital===results[i-1].capital && results[i].lastIncome===results[i-1].lastIncome?results[i-1].rank:i+1;
  return results;
}
function startRound(state: DistrictState, now: number): void {
  state.phase='negotiation'; state.developmentIndex=0; state.deadlineAt=now+DISTRICT_TIMERS.negotiation;
  const kind=state.eventDeck[state.round-1];
  state.event={kind,row:kind==='roadworks'?randomStream(state.seed,`roadworks:${state.round}`)(state.map.height)+1:null};
  for(const p of state.players) { p.ready=false; p.bid=null; p.bidConfirmed=false; p.botMemory=memory(state.round); }
  record(state,'event',{event:state.event}); state.revision++; refreshPhase(state);
}
function beginAuction(state: DistrictState, now: number): void {
  closeAllOffers(state);
  state.phase='auction'; state.deadlineAt=now+DISTRICT_TIMERS.auction;
  const hasLand=state.cells.some(c=>c.kind==='lot' && c.ownerId===null);
  for(const p of state.players) {
    p.bid=null;
    p.bidConfirmed=p.left || !hasLand || p.resources.coins<1 || state.cells.some(c=>c.ownerId===p.participant.participantId && !c.building);
  }
  state.revision++; refreshPhase(state);
}
function resolveAuction(state: DistrictState, now: number): void {
  const priority=roundOrder(state),bids=state.players.map(p=>({participantId:p.participant.participantId,bid:clone(p.bid)}));
  const winners: Array<{participantId:string;lotId:string;amount:number}>=[];
  for(const cell of state.cells) {
    if(cell.kind!=='lot' || cell.ownerId!==null) continue;
    const candidates=state.players.filter(p=>p.bid?.lotId===cell.id).sort((a,b)=>b.bid!.amount-a.bid!.amount || priority.indexOf(a.participant.participantId)-priority.indexOf(b.participant.participantId));
    if(!candidates.length) continue;
    const winner=candidates[0]; addResource(winner.resources,'coins',-winner.bid!.amount); cell.ownerId=winner.participant.participantId;
    winners.push({participantId:cell.ownerId,lotId:cell.id,amount:winner.bid!.amount});
  }
  record(state,'auction',{bids,winners});
  state.phase='development'; state.developmentIndex=0; state.deadlineAt=now+DISTRICT_TIMERS.development; state.revision++; refreshPhase(state);
}
function earnIncome(state: DistrictState, now: number): void {
  const lines=calculateIncome(state),totals=Object.fromEntries(state.players.map(p=>[p.participant.participantId,zeroResources()]));
  for(const line of lines) addResources(totals[line.ownerId],line);
  for(const p of state.players) { const amount=totals[p.participant.participantId]; addResources(p.resources,amount); p.lastIncome=amount.coins; }
  record(state,'income',{lines,totals}); state.revision++;
  if(state.round===state.totalRounds) {
    const results=finalResults(state); state.outcome={reason:'completed',winnerParticipantIds:results.filter(r=>r.rank===1).map(r=>r.participantId),results};
    state.phase='finished'; state.deadlineAt=null; state.event=null; record(state,'finished',{outcome:state.outcome}); state.revision++; refreshPhase(state);
  } else { state.round++; startRound(state,now); }
}
function finishDevelopment(state: DistrictState, now: number): void {
  state.developmentIndex++; state.revision++;
  if(state.developmentIndex===state.players.length) earnIncome(state,now);
  else { state.deadlineAt=now+DISTRICT_TIMERS.development; refreshPhase(state); }
}
function work(state: DistrictState, participantId: string, now: number, automatic = false): void {
  addResource(playerById(state,participantId).resources,'coins',2); record(state,'work',{coins:2,automatic},participantId); finishDevelopment(state,now);
}
/** Resolve automatic transitions only. Every new interactive phase gets its full timeout from now. */
function settle(state: DistrictState, now: number): void {
  for(let n=0;n<100;n++) {
    if(state.phase==='finished') return;
    if(state.phase==='goals' && state.players.every(p=>p.goal!==null)) { state.round=1; startRound(state,now); continue; }
    if(state.phase==='negotiation' && state.players.filter(p=>!p.left).every(p=>p.ready)) { beginAuction(state,now); continue; }
    if(state.phase==='auction' && state.players.every(p=>p.bidConfirmed)) { resolveAuction(state,now); continue; }
    if(state.phase==='development') {
      const pid=roundOrder(state)[state.developmentIndex];
      if(playerById(state,pid).left) { work(state,pid,now,true); continue; }
    }
    return;
  }
  fail('INVALID_STATE','Не удалось продолжить партию.',500);
}
export function advanceDistrictTime(original: DistrictState, now: number): DistrictState {
  if(!Number.isFinite(now)) fail('INVALID_TIME','Не удалось обновить партию.');
  const state=clone(original); state.updatedAt=now;
  if(state.phase!=='finished' && state.deadlineAt!==null && now>=state.deadlineAt) {
    switch(state.phase) {
      case 'goals': for(const p of state.players) p.goal??=p.goalOptions[0]; state.revision++; break;
      case 'negotiation': beginAuction(state,now); break;
      case 'auction': for(const p of state.players) p.bidConfirmed=true; state.revision++; break;
      case 'development': work(state,roundOrder(state)[state.developmentIndex],now,true); break;
    }
  }
  settle(state,now); assertDistrictInvariants(state); return state;
}
function checkTradeBundles(give: Bundle, receive: Bundle): void {
  if(sum(give)+give.lots.length===0 || sum(receive)+receive.lots.length===0) fail('INVALID_TRADE','Обе стороны должны что-то отдавать.');
  if(RESOURCE_KEYS.some(key=>give[key]>0 && receive[key]>0) || give.lots.some(lot=>receive.lots.includes(lot))) fail('INVALID_TRADE','Уберите одинаковое имущество с обеих сторон.');
}
function createTrade(state: DistrictState, authorId: string, targetId: string, give: Bundle, receive: Bundle, now: number, counter = false): TradeOffer {
  if(authorId===targetId || playerById(state,targetId).left) fail('INVALID_TRADE','Выберите другого участника.');
  checkTradeBundles(give,receive); requireBundle(state,authorId,give);
  if(receive.lots.some(lotId=>{const c=cellById(state,lotId);return c.kind!=='lot'||c.ownerId!==targetId;})) fail('ASSET_UNAVAILABLE','Это имущество сейчас недоступно.');
  const author=playerById(state,authorId);
  if(author.participant.controller.kind==='bot' && author.botMemory.rejectedSignatures.includes(tradeIntentSignature(targetId,give,receive,state.history.length,availableResources(state,authorId)))) fail('BOT_REPEATED_OFFER','Предложите другие условия.');
  newOfferAllowed(state,authorId,now,counter);
  const offer: TradeOffer={id:nextOfferId(state),version:1,authorId,targetId,give:clone(give),receive:clone(receive),kind:'trade',status:'open',round:state.round};
  state.offers.push(offer); resetReady(state,[authorId,targetId]); return offer;
}
function findOffer(state: DistrictState, offerId: string, version: number): DistrictOffer {
  const offer=state.offers.find(o=>o.id===offerId);
  if(!offer || offer.version!==version || offer.status!=='open' || offer.round!==state.round) fail('OFFER_CHANGED','Предложение уже изменилось.',409);
  return offer!;
}
function acceptTrade(state: DistrictState, offer: TradeOffer, actorId: string): void {
  if(offer.targetId!==actorId) fail('FORBIDDEN','Это предложение другому участнику.',403);
  // Release only this author's reservation in the transaction-local copy, then verify both sides before transferring.
  offer.status='completed'; requireBundle(state,offer.authorId,offer.give); requireBundle(state,offer.targetId,offer.receive);
  const owners=new Map(state.cells.filter(c=>c.kind==='lot').map(c=>[c.id,c.ownerId]));
  for(const lot of offer.give.lots) owners.set(lot,offer.targetId);
  for(const lot of offer.receive.lots) owners.set(lot,offer.authorId);
  for(const pid of [offer.authorId,offer.targetId]) if(state.cells.filter(c=>c.kind==='lot' && !c.building && owners.get(c.id)===pid).length>1) fail('EMPTY_LOT_LIMIT','Можно владеть только одним пустым участком.');
  const a=playerById(state,offer.authorId),b=playerById(state,offer.targetId);
  addResources(a.resources,offer.give,-1); addResources(b.resources,offer.receive,-1);
  addResources(a.resources,offer.receive); addResources(b.resources,offer.give);
  for(const lot of offer.give.lots) cellById(state,lot).ownerId=offer.targetId;
  for(const lot of offer.receive.lots) cellById(state,lot).ownerId=offer.authorId;
  record(state,'trade',{authorId:offer.authorId,targetId:offer.targetId,give:offer.give,receive:offer.receive},actorId); resetReady(state);
}
function completePark(state: DistrictState, offer: ParkOffer): void {
  if(!offer.contributions.every(c=>offer.signedBy.includes(c.participantId))) return;
  const park=cellById(state,offer.parkId);
  if(park.kind!=='park' || park.completed) fail('PARK_UNAVAILABLE','Парк уже построен.');
  offer.status='completed';
  for(const contribution of offer.contributions) requireResources(state,contribution.participantId,contribution.resources);
  for(const contribution of offer.contributions) addResources(playerById(state,contribution.participantId).resources,contribution.resources,-1);
  park.completed=true; park.sponsors=clone(offer.contributions);
  for(const other of state.offers) if(other.status==='open' && other.kind==='park' && other.parkId===park.id) other.status='cancelled';
  record(state,'park',{parkId:park.id,contributions:offer.contributions},offer.authorId); resetReady(state);
}
function createPark(state: DistrictState, authorId: string, parkId: string, contributions: ParkOffer['contributions'], now: number): void {
  const park=cellById(state,parkId),ids=contributions.map(c=>c.participantId),total=zeroResources();
  if(park.kind!=='park' || park.completed) fail('PARK_UNAVAILABLE','Выберите свободную площадку.');
  if(!ids.includes(authorId) || new Set(ids).size!==ids.length || contributions.some(c=>sum(c.resources)===0 || playerById(state,c.participantId).left)) fail('INVALID_PARK','Проверьте участников и их вклады.');
  for(const c of contributions) addResources(total,c.resources);
  if(RESOURCE_KEYS.some(key=>total[key]!==PARK_COST[key])) fail('INVALID_PARK','Парк стоит 4 монеты, материал и бригаду.');
  requireResources(state,authorId,contributions.find(c=>c.participantId===authorId)!.resources);
  const author=playerById(state,authorId);
  if(author.participant.controller.kind==='bot' && author.botMemory.rejectedSignatures.includes(parkIntentSignature(parkId,contributions,state.history.length,availableResources(state,authorId)))) fail('BOT_REPEATED_OFFER','Предложите другие условия.');
  newOfferAllowed(state,authorId,now);
  const offer:ParkOffer={id:nextOfferId(state),version:1,kind:'park',authorId,parkId,contributions:clone(contributions),signedBy:[authorId],status:'open',round:state.round};
  state.offers.push(offer); resetReady(state,ids); completePark(state,offer);
}

/** All commands are atomic: operate on a clone, return it on success; never mutate caller state. */
export function applyDistrictAction(original: DistrictState, participantId: string, payload: unknown, now: number): DistrictState {
  const action=parseDistrictAction(payload);
  const state=advanceDistrictTime(original,now),p=playerById(state,participantId);
  if(state.phase==='finished') fail('MATCH_FINISHED','Партия закончилась.',409);
  if(action.type==='leave' || action.type==='return') {
    if(p.participant.controller.kind!=='human') fail('FORBIDDEN','Это действие доступно человеку.',403);
    if(action.type==='leave') {
      if(p.left) fail('ACTION_UNAVAILABLE','Вы уже вышли из партии.',409);
      p.left=true;
      for(const offer of state.offers) if(offer.status==='open' && members(offer).includes(participantId)) offer.status='cancelled';
      resetReady(state); record(state,'leave',{},participantId);
      if(!state.players.some(other=>other.participant.controller.kind==='human' && !other.left)) {
        closeAllOffers(state,'cancelled'); state.phase='finished'; state.deadlineAt=null;
        state.outcome={reason:'abandoned',winnerParticipantIds:[],results:[]}; record(state,'abandoned',{});
      } else {
        p.goal??=p.goalOptions[0];
        if(state.phase==='auction') p.bidConfirmed=true;
      }
    } else {
      if(!p.left) fail('ACTION_UNAVAILABLE','Вы уже в партии.',409);
      p.left=false; resetReady(state); record(state,'return',{},participantId);
    }
  } else {
    if(p.left) fail('PLAYER_LEFT','Сначала вернитесь в игру.',409);
    switch(action.type) {
      case 'choose-goal':
        if(state.phase!=='goals' || p.goal!==null || !p.goalOptions.includes(action.goal)) fail('ACTION_UNAVAILABLE','Выберите доступную цель.',409);
        p.goal=action.goal; break;
      case 'bid':
        if(state.phase!=='auction' || p.bidConfirmed) fail('ACTION_UNAVAILABLE','Ставка уже подтверждена.',409);
        if(action.bid) {
          const cell=cellById(state,action.bid.lotId);
          if(cell.kind!=='lot' || cell.ownerId!==null || action.bid.amount>p.resources.coins || state.cells.some(c=>c.ownerId===participantId && !c.building)) fail('INVALID_BID','Проверьте участок и сумму ставки.');
        }
        p.bid=clone(action.bid); break;
      case 'confirm-bid':
        if(state.phase!=='auction' || p.bidConfirmed) fail('ACTION_UNAVAILABLE','Ставка уже подтверждена.',409);
        p.bidConfirmed=true; break;
      case 'build': case 'upgrade': case 'work': {
        if(state.phase!=='development' || roundOrder(state)[state.developmentIndex]!==participantId) fail('NOT_YOUR_TURN','Сейчас ход другого участника.',409);
        if(action.type==='work') work(state,participantId,now);
        else {
          const cell=cellById(state,action.lotId);
          if(cell.kind!=='lot' || cell.ownerId!==participantId) fail('INVALID_LOT','Выберите свой участок.');
          if(action.type==='build') {
            if(cell.building) fail('ACTION_UNAVAILABLE','На участке уже есть здание.');
            requireResources(state,participantId,BUILD_COSTS[action.building]); addResources(p.resources,BUILD_COSTS[action.building],-1);
            cell.building={kind:action.building,level:1}; record(state,'build',{lotId:cell.id,building:cell.building,cost:BUILD_COSTS[action.building]},participantId);
          } else {
            if(!cell.building || cell.building.level!==1) fail('ACTION_UNAVAILABLE','Это здание нельзя улучшить.');
            requireResources(state,participantId,UPGRADE_COST); addResources(p.resources,UPGRADE_COST,-1); cell.building!.level=2;
            record(state,'upgrade',{lotId:cell.id,building:cell.building,cost:UPGRADE_COST},participantId);
          }
          finishDevelopment(state,now);
        }
        break;
      }
      default: {
        if(state.phase!=='negotiation') fail('WRONG_PHASE','Переговоры уже закончились.',409);
        switch(action.type) {
          case 'ready': p.ready=action.ready; break;
          case 'bank': {
            const amount=action.quantity,coins=amount*(action.direction==='buy'?3:1);
            if(!integer(coins,1)) fail('INVALID_ACTION','Проверьте количество.');
            const cost=zeroResources(); cost[action.direction==='buy'?'coins':action.resource]=action.direction==='buy'?coins:amount;
            requireResources(state,participantId,cost); addResources(p.resources,cost,-1);
            addResource(p.resources,action.direction==='buy'?action.resource:'coins',action.direction==='buy'?amount:coins);
            if(p.participant.controller.kind==='bot') p.botMemory.bankActions++;
            record(state,'bank',{resource:action.resource,direction:action.direction,quantity:amount,coins},participantId); resetReady(state); break;
          }
          case 'offer-trade': createTrade(state,participantId,action.targetId,action.give,action.receive,now); break;
          case 'replace-trade': case 'counter-trade': {
            const offer=findOffer(state,action.offerId,action.version);
            if(offer.kind!=='trade') fail('INVALID_TRADE','Выберите предложение обмена.');
            const trade=offer as TradeOffer;
            if(action.type==='replace-trade' ? trade.authorId!==participantId : trade.targetId!==participantId) fail('FORBIDDEN','Нельзя изменить чужое предложение.',403);
            const target=action.type==='replace-trade'?action.targetId:trade.authorId;
            if(action.type==='counter-trade' && p.participant.controller.kind==='bot') {
              if(p.botMemory.counteredOfferIds.includes(trade.id)) fail('BOT_REPEATED_COUNTER','Нужны новые условия.');
              p.botMemory.counteredOfferIds.push(trade.id);
            }
            trade.status='replaced'; createTrade(state,participantId,target,action.give,action.receive,now,action.type==='counter-trade'); resetReady(state,members(trade)); break;
          }
          case 'accept-trade': {
            const offer=findOffer(state,action.offerId,action.version);
            if(offer.kind!=='trade') fail('INVALID_TRADE','Выберите предложение обмена.');
            acceptTrade(state,offer as TradeOffer,participantId); break;
          }
          case 'offer-park': createPark(state,participantId,action.parkId,action.contributions,now); break;
          case 'replace-park': {
            const offer=findOffer(state,action.offerId,action.version);
            if(offer.kind!=='park' || offer.authorId!==participantId) fail('FORBIDDEN','Нельзя изменить чужой договор.',403);
            offer.status='replaced'; createPark(state,participantId,action.parkId,action.contributions,now); resetReady(state,members(offer)); break;
          }
          case 'sign-park': {
            const offer=findOffer(state,action.offerId,action.version);
            if(offer.kind!=='park' || !offer.contributions.some(c=>c.participantId===participantId)) fail('FORBIDDEN','Этот договор для других участников.',403);
            const park=offer as ParkOffer;
            if(park.signedBy.includes(participantId)) fail('ACTION_UNAVAILABLE','Вы уже подписали договор.',409);
            requireResources(state,participantId,park.contributions.find(c=>c.participantId===participantId)!.resources);
            park.signedBy.push(participantId); resetReady(state,members(park)); completePark(state,park); break;
          }
          case 'decline-offer': case 'cancel-offer': {
            const offer=findOffer(state,action.offerId,action.version);
            const allowed=action.type==='cancel-offer'?offer.authorId===participantId:offer.kind==='trade'?offer.targetId===participantId:members(offer).includes(participantId);
            if(!allowed) fail('FORBIDDEN','Это предложение другим участникам.',403);
            offer.status=action.type==='decline-offer'?'declined':'cancelled';
            if(action.type==='decline-offer') {
              const author=playerById(state,offer.authorId);
              if(author.participant.controller.kind==='bot') {
                const available=availableResources(state,offer.authorId);
                author.botMemory.rejectedSignatures.push(offer.kind==='trade'
                  ?tradeIntentSignature(offer.targetId,offer.give,offer.receive,state.history.length,available)
                  :parkIntentSignature(offer.parkId,offer.contributions,state.history.length,available));
              }
            }
            resetReady(state,members(offer)); break;
          }
        }
      }
    }
  }
  state.revision++; state.updatedAt=now; refreshPhase(state); settle(state,now); assertDistrictInvariants(state); return state;
}

/** Runtime/tests can validate loaded snapshots without changing them. */
export function assertDistrictInvariants(state: DistrictState): void {
  if(state.schemaVersion!==1 || state.rulesVersion!==DISTRICT_RULES_VERSION || state.contentVersion!==DISTRICT_CONTENT_VERSION) fail('INCOMPATIBLE_VERSION','Эта версия партии пока недоступна.',409);
  if(!integer(state.revision) || !integer(state.round) || state.round>state.totalRounds || state.phaseId!==`${state.round}:${state.phase}:${state.developmentIndex}`) fail('INVALID_STATE','Не удалось прочитать партию.',500);
  if(state.phase==='finished' ? (!state.outcome || state.deadlineAt!==null) : (!Number.isFinite(state.deadlineAt) || state.outcome!==null)) fail('INVALID_STATE','Не удалось прочитать партию.',500);
  for(const p of state.players) {
    if(RESOURCE_KEYS.some(k=>!integer(p.resources[k]))) fail('INVALID_STATE','Некорректный запас ресурсов.',500);
    const pid=p.participant.participantId,reserved=reservedAssets(state,pid);
    if(!atLeast(p.resources,reserved) || new Set(reserved.lots).size!==reserved.lots.length) fail('INVALID_STATE','Некорректный резерв.',500);
    if(reserved.lots.some(lot=>cellById(state,lot).ownerId!==pid)) fail('INVALID_STATE','Некорректный резерв земли.',500);
    if(state.cells.filter(c=>c.ownerId===pid && !c.building).length>1) fail('INVALID_STATE','Превышен запас пустой земли.',500);
    if(state.offers.filter(o=>o.status==='open' && o.authorId===pid).length>3) fail('INVALID_STATE','Превышен лимит предложений.',500);
    if(p.participant.controller.kind==='bot' && p.botMemory.created>4) fail('INVALID_STATE','Превышен лимит предложений бота.',500);
  }
  for(const c of state.cells) {
    if(c.ownerId!==null && !state.players.some(p=>p.participant.participantId===c.ownerId)) fail('INVALID_STATE','Не найден владелец участка.',500);
    if(c.kind!=='lot' && (c.ownerId!==null || c.building!==null)) fail('INVALID_STATE','Общественную клетку нельзя купить.',500);
    if(c.building && (c.ownerId===null || ![1,2].includes(c.building.level))) fail('INVALID_STATE','Некорректное здание.',500);
  }
  if(state.phase!=='negotiation' && state.offers.some(o=>o.status==='open')) fail('INVALID_STATE','Резерв не освобождён.',500);
}
