import { availableResources, calculateIncome, EVENT_DECK, goalSatisfied, playerById, reservedAssets, roundOrder } from './core';
import type { DistrictState, DistrictView, EventId } from './types';

/** Construct a new DTO, never pass the authoritative state or future RNG to callers. */
export function viewDistrict(state: DistrictState, participantId: string, now = state.updatedAt): DistrictView {
  const p=playerById(state,participantId),reserved=reservedAssets(state,participantId),active=state.phase==='development'?roundOrder(state)[state.developmentIndex]:null;
  const remainingEvents=Object.fromEntries([...new Set(EVENT_DECK)].map(kind=>[kind,EVENT_DECK.filter(k=>k===kind).length])) as Record<EventId,number>;
  // Derive from public reveals, not a serialized slice of the private deck.
  for(const entry of state.history) if(entry.type==='event') {
    const revealed=(entry.data.event as {kind:EventId}).kind; remainingEvents[revealed]--;
  }
  return structuredClone({
    gameId:'district',matchId:state.matchId,roomId:state.roomId,revision:state.revision,rulesVersion:state.rulesVersion,contentVersion:state.contentVersion,
    map:state.map,cells:state.cells,phase:state.phase,phaseId:state.phaseId,round:state.round,totalRounds:state.totalRounds,deadlineAt:state.deadlineAt,serverNow:now,
    priority:roundOrder(state),activeParticipantId:active,event:state.event,remainingEvents,
    players:state.players.map(other=>({participantId:other.participant.participantId,displayName:other.participant.displayName,seatIndex:other.participant.seatIndex,
      isBot:other.participant.controller.kind==='bot',difficulty:other.participant.controller.kind==='bot'?other.participant.controller.difficulty:null,
      resources:other.resources,ready:other.ready,left:other.left,submitted:state.phase==='goals'?other.goal!==null:state.phase==='auction'?other.bidConfirmed:other.ready,lastIncome:other.lastIncome})),
    you:{participantId,resources:p.resources,available:availableResources(state,participantId),reserved:{coins:reserved.coins,materials:reserved.materials,crews:reserved.crews},reservedLots:reserved.lots,
      goalOptions:p.goalOptions,goal:p.goal,goalCompleted:goalSatisfied(state.cells,participantId,p.goal),bid:p.bid,bidConfirmed:p.bidConfirmed,
      offers:state.offers.filter(offer=>offer.round===state.round && (offer.kind==='trade'?[offer.authorId,offer.targetId].includes(participantId):offer.contributions.some(c=>c.participantId===participantId))),
      left:p.left,botMemory:p.botMemory},
    legal:{chooseGoal:state.phase==='goals' && p.goal===null && !p.left,negotiate:state.phase==='negotiation' && !p.left,
      bid:state.phase==='auction' && !p.bidConfirmed && !p.left,confirmBid:state.phase==='auction' && !p.bidConfirmed && !p.left,
      develop:state.phase==='development' && active===participantId && !p.left,leave:state.phase!=='finished' && p.participant.controller.kind==='human' && !p.left,
      return:state.phase!=='finished' && p.participant.controller.kind==='human' && p.left},
    incomePreview:calculateIncome(state),history:state.history,outcome:state.outcome,
  });
}
