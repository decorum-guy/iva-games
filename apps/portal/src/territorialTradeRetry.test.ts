import {describe,expect,it} from 'vitest';
import {createTerritory,viewTerritory,territoryMaps,emptyStock} from '@iva-games/district/territorial';
import {retryTradeCommand} from './territorialTradeRetry';

function fixture() {
 const s=createTerritory({matchId:'retry',roomId:'retry',map:territoryMaps[0],preset:'medium',seed:'retry',now:1000,
 participants:['a','b','c'].map((id,seatIndex)=>({participantId:id,playerId:id,displayName:id,seatIndex,controller:{kind:'human',playerId:id}}))});
 s.phase='play';
 const before=viewTerritory(s,'a',1000);
 before.offers=[{id:'one',groupId:'group',authorId:'a',targetId:'b',give:{...emptyStock(),wood:1},receive:{...emptyStock(),brick:1},agreedAt:1000,canAccept:true}];
 const next=structuredClone(before);next.revision++;
 const command={actionId:'same-command',expectedRevision:before.revision,payload:{type:'accept' as const,offerId:'one',phaseId:before.phaseId}};
 return{before,next,command};
}
describe('author trade retry after explicit stale rejection',()=>{
 it('preserves command identity and exact chosen consent',()=>{const{before,next,command}=fixture();expect(retryTradeCommand(before,command,next)).toEqual({...command,expectedRevision:next.revision});});
 it('can cancel surviving members when the original first recipient just declined',()=>{const{before,next,command}=fixture();next.offers=[{...next.offers[0],id:'sibling',targetId:'c',agreedAt:undefined}];expect(retryTradeCommand(before,{...command,payload:{...command.payload,type:'cancel'}},next)?.payload).toEqual({...command.payload,type:'cancel',offerId:'sibling'});});
 it('never substitutes a different recipient for selection',()=>{const{before,next,command}=fixture();next.offers[0].id='sibling';next.offers[0].targetId='c';expect(retryTradeCommand(before,command,next)).toBeNull();});
 it('stops for changed terms, withdrawn consent, unavailable selection or removed group',()=>{
  for(const change of [(v:ReturnType<typeof fixture>['next'])=>{v.offers[0].give.wood=2;},(v:ReturnType<typeof fixture>['next'])=>{delete v.offers[0].agreedAt;},(v:ReturnType<typeof fixture>['next'])=>{v.offers[0].canAccept=false;},(v:ReturnType<typeof fixture>['next'])=>{v.offers=[];}]){const{before,next,command}=fixture();change(next);expect(retryTradeCommand(before,command,next)).toBeNull();}
 });
 it('stops at phase/turn boundary, deadline, result or identity change',()=>{
  for(const change of [(v:ReturnType<typeof fixture>['next'])=>{v.phaseId+='changed';},(v:ReturnType<typeof fixture>['next'])=>{v.serverNow=v.deadlineAt!;},(v:ReturnType<typeof fixture>['next'])=>{v.outcome={winnerParticipantIds:['a'],reason:'points'};},(v:ReturnType<typeof fixture>['next'])=>{v.you.participantId='b';}]){const{before,next,command}=fixture();change(next);expect(retryTradeCommand(before,command,next)).toBeNull();}
 });
 it('does not retry recipient consent or legacy addressed exchange',()=>{const{before,next,command}=fixture();before.offers[0].authorId='b';expect(retryTradeCommand(before,command,next)).toBeNull();before.offers[0].authorId='a';delete before.offers[0].groupId;expect(retryTradeCommand(before,command,next)).toBeNull();});
});
